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
    baseWord?: string;
  }[];
  remaining?: number;
  error?: string;
}

function normalizeSource(s: string): Pronunciation['source'] {
  return s === 'learners' || s === 'collegiate' ? s : 'none';
}

interface PronunciationRow {
  en: string;
  ipa: string | null;
  audio_url: string | null;
  source: string;
  base_word: string | null;
}

/**
 * 이미 서버(pronunciations 테이블)에 캐시된 발음을 직접 조회한다.
 * 이 테이블은 RLS로 누구나 읽을 수 있게 열려 있어 로그인 여부와 무관하게 동작한다 —
 * 브라우저 로컬 캐시가 비어 있어도(다른 기기, 새로고침, 브라우저 데이터 정리 등)
 * 이미 누군가 한 번이라도 조회한 단어라면 매번 다시 불러올 필요가 없다.
 */
async function fetchFromSharedCache(words: string[]): Promise<Pronunciation[]> {
  if (!supabase || words.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('pronunciations')
      .select('en, ipa, audio_url, source, base_word')
      .in('en', words);
    if (error || !data) return [];
    const now = Date.now();
    return (data as PronunciationRow[]).map((r) => ({
      en: r.en,
      ipa: r.ipa ?? undefined,
      audioUrl: r.audio_url ?? undefined,
      source: normalizeSource(r.source),
      fetchedAt: now,
      baseWord: r.base_word ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * 발음을 받아온다. 먼저 서버 공유 캐시를 확인하고(로그인 불필요, 즉시), 거기에도
 * 없는 단어만 로그인 상태에서 Edge Function을 통해 MW를 새로 조회한다(할당량 보호).
 *
 * 실패해도 지금까지 구한 것만 돌려준다 — 호출부는 나머지를 "아직 모름"으로 취급하면 된다.
 */
export async function fetchPronunciations(words: string[]): Promise<Pronunciation[]> {
  if (!supabase || words.length === 0) return [];

  const cached = await fetchFromSharedCache(words);
  const cachedKeys = new Set(cached.map((c) => c.en));
  const stillMissing = words.filter((w) => !cachedKeys.has(w.trim().toLowerCase()));
  if (stillMissing.length === 0) return cached;

  // 서버에도 없는, 진짜 처음 조회하는 단어만 로그인이 필요하다.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return cached;

  try {
    const { data, error } = await supabase.functions.invoke<PronounceResponse>('pronounce', {
      body: { words: stillMissing },
    });
    if (error || !data?.pronunciations) {
      if (error) console.warn('발음 조회 실패 (기능만 비활성화됩니다)', error);
      return cached;
    }
    const now = Date.now();
    const fetched = data.pronunciations.map((p) => ({
      en: p.en,
      ipa: p.ipa,
      audioUrl: p.audioUrl,
      source: normalizeSource(p.source),
      fetchedAt: now,
      baseWord: p.baseWord,
    }));
    return [...cached, ...fetched];
  } catch (e) {
    console.warn('발음 조회 실패 (기능만 비활성화됩니다)', e);
    return cached;
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
