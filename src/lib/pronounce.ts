import { supabase } from './supabase';
import type { Pronunciation } from '../types';

/**
 * 발음 조회 클라이언트.
 *
 * 발음은 "있으면 좋은" 기능이지 핵심 기능이 아니다. Supabase 미설정, 미로그인,
 * 오프라인, MW 키 없음 — 어떤 경우에도 조용히 비활성될 뿐 퀴즈를 막지 않는다.
 * 그래서 이 파일의 함수는 throw하지 않고 항상 배열/맵을 돌려준다.
 */

interface PronounceResponse {
  pronunciations?: {
    en: string;
    ipa?: string;
    audioUrl?: string;
    source: string;
  }[];
  remaining?: number;
  error?: string;
}

function normalizeSource(s: string): Pronunciation['source'] {
  return s === 'learners' || s === 'collegiate' ? s : 'none';
}

/**
 * 서버(Edge Function)에서 발음을 받아온다. 이미 캐시된 단어는 서버가 즉시 돌려주고,
 * 새 단어만 MW를 실제로 조회한다.
 *
 * 실패하면 빈 배열 — 호출부는 "아직 모름"으로 취급하면 된다.
 */
export async function fetchPronunciations(words: string[]): Promise<Pronunciation[]> {
  if (!supabase || words.length === 0) return [];

  // 로그인하지 않았으면 서버가 401을 줄 것이므로 미리 걸러 불필요한 요청을 아낀다.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  try {
    const { data, error } = await supabase.functions.invoke<PronounceResponse>('pronounce', {
      body: { words },
    });
    if (error || !data?.pronunciations) {
      if (error) console.warn('발음 조회 실패 (기능만 비활성화됩니다)', error);
      return [];
    }
    const now = Date.now();
    return data.pronunciations.map((p) => ({
      en: p.en,
      ipa: p.ipa,
      audioUrl: p.audioUrl,
      source: normalizeSource(p.source),
      fetchedAt: now,
    }));
  } catch (e) {
    console.warn('발음 조회 실패 (기능만 비활성화됩니다)', e);
    return [];
  }
}

/** 아직 로컬 캐시에 없는 단어만 골라낸다. 소문자로 정규화해서 돌려준다. */
export function missingFromCache(
  words: string[],
  cache: Record<string, Pronunciation>,
): string[] {
  const out = new Set<string>();
  for (const w of words) {
    const key = w.trim().toLowerCase();
    if (key && !cache[key]) out.add(key);
  }
  return [...out];
}

export function lookupCache(
  en: string,
  cache: Record<string, Pronunciation>,
): Pronunciation | undefined {
  return cache[en.trim().toLowerCase()];
}

/**
 * 발음 재생. 같은 소리가 겹쳐 나지 않도록 직전 재생을 멈추고 시작한다.
 * 자동 재생이 브라우저 정책에 막히는 경우(사용자 상호작용 전)는 조용히 무시한다.
 */
let current: HTMLAudioElement | null = null;

export function playAudio(url: string): void {
  try {
    current?.pause();
    const audio = new Audio(url);
    current = audio;
    void audio.play().catch(() => {
      /* 자동재생 차단 등 — 사용자가 버튼을 누르면 그때 재생된다 */
    });
  } catch {
    /* 재생 실패가 학습을 막아서는 안 된다 */
  }
}
