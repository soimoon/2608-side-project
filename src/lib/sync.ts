import { supabase } from './supabase';
import { isTheme } from './storage';
import { claimKey } from './attendance';
import type { ClaimKind, Theme, Word } from '../types';

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
  /** Postgres text[] 컬럼. postgrest가 JS 배열로 그대로 주고받는다. */
  ko: string[];
  deck: string;
  seen: number;
  correct: number;
  wrong: number;
  streak: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /**
   * 사용자가 직접 매긴 정렬 키(Word.order). "order"는 SQL 예약어라 컬럼명은
   * sort_order로 둔다. 순서를 바꾼 적 없는 단어는 null이고, 그때는 created_at이
   * 정렬 키가 된다. 컬럼이 아직 없는 프로젝트에서도 깨지지 않도록 읽을 때는
   * 없으면 undefined로 흘려보낸다.
   */
  sort_order: number | null;
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
    sort_order: w.order ?? null,
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
    order: typeof r.sort_order === 'number' ? r.sort_order : undefined,
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

    // 로컬 쪽 뜻 순서를 유지하고, 클라우드에만 있던 뜻(똑같은 문자열이 아닌 것)만 뒤에 덧붙인다.
    const ko = [...l.ko];
    for (const meaning of r.ko) if (!ko.includes(meaning)) ko.push(meaning);
    const lastSeenAt = Math.max(l.stats.lastSeenAt ?? 0, r.stats.lastSeenAt ?? 0) || undefined;

    merged.push({
      ...l,
      ko,
      // 뜻 순서와 같은 원칙으로 로컬이 우선이되, 로컬에서 순서를 만진 적이 없으면
      // 다른 기기에서 매겨 둔 순서라도 살린다.
      order: l.order ?? r.order,
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

/**
 * 계정에 저장된 마지막 테마를 가져온다. 로그인할 때 한 번만 부른다 — 그 이후로는
 * 로컬 값을 정본으로 쓰고, 사용자가 테마를 바꿀 때마다 pushTheme로 계정에 반영한다.
 * 값이 없거나(신규 계정) 실패하면 null — 호출부는 로컬 테마를 그대로 유지하면 된다.
 */
export async function pullTheme(userId: string): Promise<Theme | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('theme')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const theme = (data as { theme: string | null }).theme;
    return isTheme(theme) ? theme : null;
  } catch {
    return null;
  }
}

/** 테마는 취향 설정이라 실패해도 조용히 넘어간다(재시도하지 않음). */
export async function pushTheme(userId: string, theme: Theme): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('profiles').update({ theme }).eq('id', userId);
  } catch {
    /* no-op */
  }
}

interface DailyClaimRow {
  date: string;
  kind: string;
}

/**
 * 계정에 저장된 출석·미션 보상 수령 기록을 전부 가져온다. 로그인 직후 한 번 불러
 * 로컬 dailyClaims와 합집합으로 합친다(둘 다 append-only라 병합이 단순하다).
 * 실패하면 빈 배열 — 로컬 기록은 그대로 유지된다.
 */
export async function pullDailyClaims(userId: string): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('daily_claims')
      .select('date, kind')
      .eq('user_id', userId);
    if (error || !data) return [];
    return (data as DailyClaimRow[]).map((r) => claimKey(r.date, r.kind as ClaimKind));
  } catch {
    return [];
  }
}

/**
 * 출석·미션 보상을 받았다고 계정에 기록한다. (user_id, date, kind)가 기본키라
 * 같은 걸 두 번 보내도 안전하다(중복 삽입 대신 그냥 실패하고 무시된다).
 * 실패해도 조용히 넘어간다 — 로컬에는 이미 반영돼 있으므로 다음 로그인 때 다시 시도된다.
 */
export async function pushDailyClaim(userId: string, date: string, kind: ClaimKind): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('daily_claims').upsert(
      { user_id: userId, date, kind },
      { onConflict: 'user_id,date,kind', ignoreDuplicates: true },
    );
  } catch {
    /* no-op */
  }
}

interface RevivalEventRow {
  word_id: string;
}

/**
 * 특정 날짜(KST)에 이 계정이 되살린 단어 id 목록을 가져온다. 오늘의 미션 진행률을
 * 다른 기기와 맞추는 데 쓴다 — daily_claims와 같은 append-only 패턴이라 로컬
 * revivedWordIds와 합집합으로 합치기만 하면 된다. 실패하면 빈 배열(로컬 유지).
 */
export async function pullRevivalEvents(userId: string, dateKey: string): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('revival_events')
      .select('word_id')
      .eq('user_id', userId)
      .eq('date', dateKey);
    if (error || !data) return [];
    return (data as RevivalEventRow[]).map((r) => r.word_id);
  } catch {
    return [];
  }
}

/**
 * 오늘 새로 되살린 단어들을 계정에 기록한다. (user_id, date, word_id)가 기본키라
 * 같은 단어를 같은 날 두 번 보내도 안전하다. 실패해도 조용히 넘어간다 — 로컬에는
 * 이미 반영돼 있으므로 다음 로그인/포커스 때 다시 pull하면 자연히 맞춰진다.
 */
export async function pushRevivalEvents(
  userId: string,
  dateKey: string,
  wordIds: string[],
): Promise<void> {
  if (!supabase || wordIds.length === 0) return;
  try {
    await supabase.from('revival_events').upsert(
      wordIds.map((word_id) => ({ user_id: userId, date: dateKey, word_id })),
      { onConflict: 'user_id,date,word_id', ignoreDuplicates: true },
    );
  } catch {
    /* no-op */
  }
}
