import { supabase } from './supabase';
import type { Word } from '../types';

/**
 * localStorage가 항상 정본이고, 이 파일은 그 위에 얹는 동기화 계층이다.
 * 여기 있는 모든 함수는 실패해도 절대 throw하지 않는다 — 실패 시 로컬 데이터는
 * 그대로 두고 다음 트리거(포커스 복귀, 다음 변경)에서 재시도하면 되기 때문이다.
 *
 * 이번 단계는 단어(words) 동기화만 다룬다. 세션 기록(sessions) 테이블은
 * schema.sql에 이미 있지만, 클라우드로 올리는 건 이후 단계로 미뤘다 — 학습 기록을
 * 잃는 것보다 단어장을 잃는 쪽이 훨씬 치명적이라 그쪽을 먼저 단단히 하는 게 맞다.
 */

interface RemoteWordRow {
  id: string;
  user_id: string;
  en: string;
  ko: string;
  deck: string;
  seen: number;
  correct: number;
  wrong: number;
  streak: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toRemote(w: Word, userId: string): RemoteWordRow {
  return {
    id: w.id,
    user_id: userId,
    en: w.en,
    ko: w.ko,
    deck: w.deck,
    seen: w.stats.seen,
    correct: w.stats.correct,
    wrong: w.stats.wrong,
    streak: w.stats.streak,
    last_seen_at: w.stats.lastSeenAt ? new Date(w.stats.lastSeenAt).toISOString() : null,
    created_at: new Date(w.createdAt).toISOString(),
    updated_at: new Date(w.updatedAt).toISOString(),
    deleted_at: w.deletedAt ? new Date(w.deletedAt).toISOString() : null,
  };
}

function fromRemote(r: RemoteWordRow): Word {
  return {
    id: r.id,
    en: r.en,
    ko: r.ko,
    deck: r.deck,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).getTime() : undefined,
    stats: {
      seen: r.seen,
      correct: r.correct,
      wrong: r.wrong,
      streak: r.streak,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : undefined,
    },
  };
}

export interface PullResult {
  ok: boolean;
  words: Word[];
  error?: string;
}

/** sinceMs 이후로 바뀐(생성·수정·소프트삭제) 단어만 받아온다. */
export async function pullWords(userId: string, sinceMs: number): Promise<PullResult> {
  if (!supabase) return { ok: false, words: [], error: '클라우드 설정 없음' };
  try {
    const { data, error } = await supabase
      .from('words')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', new Date(sinceMs).toISOString())
      .order('updated_at', { ascending: true });
    if (error) return { ok: false, words: [], error: error.message };
    return { ok: true, words: (data as RemoteWordRow[]).map(fromRemote) };
  } catch (e) {
    return { ok: false, words: [], error: String(e) };
  }
}

/** 전체 단어를 받아온다. 최초 로그인 병합 때만 쓴다. */
export function pullAllWords(userId: string): Promise<PullResult> {
  return pullWords(userId, 0);
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  error?: string;
}

/**
 * updatedAt > sinceMs인 단어만 올린다. force가 true면 커서를 무시하고 전부 올린다
 * — 최초 로그인 병합 직후처럼 로컬이 통째로 바뀌어 커서를 믿을 수 없을 때 쓴다.
 */
export async function pushWords(
  userId: string,
  words: Word[],
  sinceMs: number,
  force = false,
): Promise<PushResult> {
  if (!supabase) return { ok: false, pushed: 0, error: '클라우드 설정 없음' };
  const dirty = force ? words : words.filter((w) => w.updatedAt > sinceMs);
  if (dirty.length === 0) return { ok: true, pushed: 0 };

  try {
    const { error } = await supabase
      .from('words')
      .upsert(dirty.map((w) => toRemote(w, userId)), { onConflict: 'id' });
    if (error) return { ok: false, pushed: 0, error: error.message };
    return { ok: true, pushed: dirty.length };
  } catch (e) {
    return { ok: false, pushed: 0, error: String(e) };
  }
}

export interface MergeOutcome {
  words: Word[];
  summary: string;
}

/**
 * 최초 로그인 때 한 번만 쓴다. 게스트로 쌓아 둔 로컬 단어와 클라우드에 이미 있던
 * 단어를 철자(대소문자 무시) 기준으로 합친다.
 *
 * 같은 철자가 양쪽에 있으면 로컬 쪽 id를 유지한다 — 이번 세션 기록(Attempt.wordId)이
 * 이미 그 id를 참조하고 있으므로, id가 바뀌면 방금 푼 퀴즈 결과와 단어가 끊어진다.
 * 통계는 두 기기에서 각각 연습한 결과이므로 더해서 합친다. 뜻이 다르면 이어붙인다.
 */
export function mergeGuestWithCloud(local: Word[], remote: Word[]): MergeOutcome {
  const remoteByEn = new Map(
    remote.filter((w) => !w.deletedAt).map((w) => [w.en.toLowerCase(), w] as const),
  );
  const merged: Word[] = [];
  let combinedCount = 0;

  for (const l of local) {
    if (l.deletedAt) continue;
    const key = l.en.toLowerCase();
    const r = remoteByEn.get(key);
    if (!r) {
      merged.push(l);
      continue;
    }
    remoteByEn.delete(key);
    combinedCount++;

    const koParts = [...new Set([l.ko.trim(), r.ko.trim()].filter(Boolean))];
    const lastSeenAt = Math.max(l.stats.lastSeenAt ?? 0, r.stats.lastSeenAt ?? 0) || undefined;

    merged.push({
      ...l,
      ko: koParts.join(', '),
      stats: {
        seen: l.stats.seen + r.stats.seen,
        correct: l.stats.correct + r.stats.correct,
        wrong: l.stats.wrong + r.stats.wrong,
        streak: Math.max(l.stats.streak, r.stats.streak),
        lastSeenAt,
      },
      updatedAt: Date.now(),
    });
  }

  // 로컬에 없던, 클라우드에만 있던 단어(다른 기기에서 등록한 것)는 그대로 가져온다.
  merged.push(...remoteByEn.values());

  const summary =
    combinedCount > 0
      ? `로컬 ${local.length}개 + 클라우드 ${remote.length}개 → ${merged.length}개 (중복 ${combinedCount}개 병합)`
      : `로컬 ${local.length}개 + 클라우드 ${remote.length}개 → ${merged.length}개`;

  return { words: merged, summary };
}
