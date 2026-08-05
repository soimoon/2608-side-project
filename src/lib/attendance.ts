import type { ClaimKind, Word } from '../types';
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
