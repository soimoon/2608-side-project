import type { ClaimKind, SessionResult, Word } from '../types';
import type { IconName } from '../components/Icon';

/** 오답 부활전 미션의 목표 개수. */
export const MISSION_TARGET = 5;

/**
 * 틀렸던 단어를 "부활했다"고 인정하는 연속 정답 수. 부활 배지(달성)와 오답 부활전
 * 출제 대상(미달성)이 이 값 하나를 기준으로 정확히 갈리므로, 두 곳이 어긋나지
 * 않도록 상수를 공유한다.
 */
export const REVIVAL_STREAK_GOAL = 5;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 주어진 시각의 "한국 날짜"를 YYYY-MM-DD로 돌려준다. 기기 타임존과 무관하게
 * 항상 같은 값을 준다 — `toLocaleDateString`은 기기 로컬 타임존을 쓰므로
 * 해외에서 접속하면 날짜가 어긋날 수 있어, 여기서는 UTC+9 고정 계산을 쓴다.
 */
export function kstDateKey(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function claimKey(dateKey: string, kind: ClaimKind): string {
  return `${dateKey}:${kind}`;
}

export function hasClaimed(claims: string[], dateKey: string, kind: ClaimKind): boolean {
  return claims.includes(claimKey(dateKey, kind));
}

/**
 * 특정 kind로 출석(보상 수령)한 날짜들이, 오늘(또는 아직 오늘 몫을 안 받았다면
 * 어제)부터 거꾸로 며칠 연속인지. Home.tsx의 기존 studyStreak()와 같은 방식이되
 * 날짜 판정만 KST 고정이다.
 */
export function attendanceStreak(claims: string[], kind: ClaimKind, nowMs: number): number {
  const dates = new Set(
    claims.filter((c) => c.endsWith(`:${kind}`)).map((c) => c.slice(0, c.lastIndexOf(':'))),
  );
  const today = kstDateKey(nowMs);
  let cursor = nowMs;
  if (!dates.has(today)) cursor -= 24 * 60 * 60 * 1000; // 오늘 아직이면 어제부터

  let streak = 0;
  for (;;) {
    const key = kstDateKey(cursor);
    if (!dates.has(key)) break;
    streak++;
    cursor -= 24 * 60 * 60 * 1000;
  }
  return streak;
}

/** 한 번이라도 틀렸다가(wrong>0) 다시 연속 정답을 목표만큼 쌓은, 즉 "부활시킨" 단어 수. */
export function revivedWordCount(words: Word[]): number {
  return words.filter((w) => w.stats.wrong > 0 && w.stats.streak >= REVIVAL_STREAK_GOAL).length;
}

/** 누적 정답 문제 수. 학습량 배지 산정 기준. */
export function totalCorrect(words: Word[]): number {
  return words.reduce((sum, w) => sum + w.stats.correct, 0);
}

/** tiers는 오름차순이어야 한다. 도달한 가장 높은 티어(없으면 0)와 다음 티어까지 남은 양. */
export function currentTier(
  value: number,
  tiers: readonly number[],
): { tier: number; next: number | null; remaining: number } {
  let tier = 0;
  for (const t of tiers) {
    if (value >= t) tier = t;
  }
  const next = tiers.find((t) => t > tier) ?? null;
  return { tier, next, remaining: next === null ? 0 : next - value };
}

export interface BadgeDef {
  key: string;
  label: string;
  icon: IconName;
  tiers: readonly number[];
  /** 배지 값 계산에 필요한 최소 재료. 프로필 화면에서 골라 넘긴다. */
}

export const BADGES = {
  attendance: { key: 'attendance', label: '연속 출석', icon: 'fire', tiers: [7, 30, 100] },
  revival: { key: 'revival', label: '부활시킨 단어', icon: 'seedling', tiers: [1, 5, 20] },
  volume: { key: 'volume', label: '누적 정답', icon: 'books', tiers: [100, 500, 1000] },
} as const satisfies Record<string, BadgeDef>;

export interface MissionDef {
  key: ClaimKind;
  label: string;
  description: string;
  icon: IconName;
  target: number;
  /**
   * 화면 표시용 참고치일 뿐, 실제 지급액은 supabase/schema.sql의 mission_rewards
   * 표가 최종 권한이다("보상은 서버가 준다" 원칙 — decorItems.ts의 price가
   * decor_items 표를 따라야 하는 것과 같은 이유). 새 미션을 추가하거나 보상을
   * 바꿀 땐 이 값과 mission_rewards insert 문을 같이 고칠 것.
   */
  reward: number;
}

/**
 * 프로필 화면의 "오늘의 미션" 카드를 이 레지스트리 하나로 렌더링한다(배지와 같은
 * 패턴). 다만 진행률 계산 방식은 미션마다 다르다 — mission_revive는 되살린 단어
 * id 집합(dailyMission, 같은 단어 중복 집계 방지가 필요해 특별 취급), 나머지는
 * 아래 순수 함수들로 그때그때 계산한다. ProfileScreen이 key별로 알맞은 값을
 * 골라 넣는다.
 */
export const MISSIONS = {
  mission_revive: {
    key: 'mission_revive',
    label: '오답 부활전',
    description: '예전에 틀렸던 단어를 오늘 다시 맞혀 보세요.',
    icon: 'seedling',
    target: MISSION_TARGET,
    reward: 10,
  },
  mission_volume: {
    key: 'mission_volume',
    label: '오늘 문제 풀기',
    description: '퀴즈에서 오늘 문제를 풀어 보세요.',
    icon: 'pencil',
    target: 30,
    reward: 10,
  },
  mission_add: {
    key: 'mission_add',
    label: '새 단어 등록',
    description: '오늘 새 단어를 등록해 보세요.',
    icon: 'book',
    target: 5,
    reward: 10,
  },
  mission_accuracy: {
    key: 'mission_accuracy',
    label: '정답률 80% 완주',
    description: '한 세션을 정답률 80% 이상으로 끝내 보세요.',
    icon: 'fire',
    target: 80,
    reward: 15,
  },
  mission_group: {
    key: 'mission_group',
    label: '단체게임 1판 완주',
    description: '친구들과 단체게임을 한 판 끝까지 해보세요.',
    icon: 'people',
    target: 1,
    reward: 15,
  },
} as const satisfies Record<string, MissionDef>;

/** 오늘(KST) 채점된 시도(attempt) 수. 재출제(requeue)도 포함한다 — "오늘 얼마나
 *  풀었는지"는 다시 도전한 것도 노력으로 쳐준다(부활 인정과는 성격이 다른 카운트). */
export function todaySolvedCount(history: SessionResult[], nowMs: number): number {
  const today = kstDateKey(nowMs);
  return history
    .filter((h) => kstDateKey(h.finishedAt) === today)
    .reduce((sum, h) => sum + h.attempts.length, 0);
}

/** 오늘(KST) 새로 등록한 단어 수. */
export function todayAddedWordCount(words: Word[], nowMs: number): number {
  const today = kstDateKey(nowMs);
  return words.filter((w) => kstDateKey(w.createdAt) === today).length;
}

/** 오늘(KST) 세션 중 가장 높은 정답률(%, 0~100 정수). 세션이 없으면 0.
 *  재출제 시도는 뺀다 — word.stats 갱신(App.tsx finishQuiz)이 이미 재출제를
 *  "처음 시도만 반영"하는 것과 같은 이유로, 재도전 기회가 정답률을 부풀리면
 *  "80% 완주"가 원래 의도(실력)와 다른 걸 재는 미션이 된다. */
export function todayBestAccuracy(history: SessionResult[], nowMs: number): number {
  const today = kstDateKey(nowMs);
  let best = 0;
  for (const h of history) {
    if (kstDateKey(h.finishedAt) !== today) continue;
    const counted = h.attempts.filter((a) => !a.requeued);
    if (counted.length === 0) continue;
    const correct = counted.filter((a) => a.verdict === 'correct').length;
    best = Math.max(best, Math.round((correct / counted.length) * 100));
  }
  return best;
}
