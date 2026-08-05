import type { Verdict } from '../types';

/**
 * 카훗식 점수 계산 — 절대시간 감점 + 최속 소액 보너스.
 *
 * 힌트 단계(groupMask.ts)와 점수 곡선을 한 몸으로 묶었다: 곡선이 완만하면 누구나
 * 마지막 힌트까지 기다리는 게 최적 전략이 되어 긴장이 사라진다. 그래서 단계 경계에서
 * 한 번 더 뚝 떨어지게 했다 — 그 낙차가 힌트의 값이다.
 *
 * 서버(submit_answer RPC)가 정본 계산을 하고, 여기 scoreOf()는 그 공식의 거울이다
 * (제출 즉시 "+842점" 같은 낙관적 표시용). 정본 값이 오면 항상 그걸로 덮어쓴다.
 * 두 구현이 어긋나면 "화면엔 정답인데 점수가 다른" 최악의 UX가 나오므로, 이 파일의
 * STAGES를 고치면 supabase/schema.sql의 submit_answer도 반드시 같이 고쳐야 한다.
 */

interface StageBand {
  from: number;
  to: number;
  hi: number;
  lo: number;
}

const STAGES: StageBand[] = [
  { from: 0, to: 0.5, hi: 1000, lo: 700 },
  { from: 0.5, to: 0.75, hi: 650, lo: 450 },
  { from: 0.75, to: 1, hi: 400, lo: 250 },
];

/** near(아깝다)는 고정값 — 어떤 정답도 어떤 니어미스보다 항상 높다(최저 정답 250 > 150). */
export const NEAR_POINTS = 150;
/** 그 라운드 정답자 중 가장 빨랐던 1명에게만 붙는 소액 보너스. */
export const FASTEST_BONUS = 50;

/** 정답일 때 절대시간 감점 점수. 단계 경계에서 한 번 더 뚝 떨어진다(힌트의 값). */
export function correctScore(elapsedMs: number, answerMs: number): number {
  const p = answerMs > 0 ? Math.min(1, Math.max(0, elapsedMs / answerMs)) : 1;
  const band = STAGES.find((s) => p < s.to) ?? STAGES[STAGES.length - 1];
  const local = (p - band.from) / (band.to - band.from);
  return Math.round(band.hi - (band.hi - band.lo) * local);
}

/** verdict 하나의 기본 점수(최속 보너스 제외). wrong/timeout/미제출은 0. */
export function scoreOf(verdict: Verdict, elapsedMs: number, answerMs: number): number {
  if (verdict === 'correct') return correctScore(elapsedMs, answerMs);
  if (verdict === 'near') return NEAR_POINTS;
  return 0;
}

export interface AnswerLike {
  userId: string;
  roundIndex: number;
  verdict: Verdict;
  elapsedMs: number;
  /** 서버가 계산해 돌려준 정본 점수. 최속 보너스는 미포함(별도로 더한다). */
  points: number;
}

export interface Standing {
  userId: string;
  totalPoints: number;
  correctCount: number;
  totalElapsedMs: number;
  /** 완전 동점이면 같은 순위를 공유한다(다음 사람은 공동 인원만큼 건너뛴다). */
  rank: number;
}

/** 그 라운드 정답자 중 가장 빨랐던 사람. 동점이면 user_id 사전순(결정론적). */
export function fastestCorrectUserId(answers: AnswerLike[], roundIndex: number): string | null {
  const correct = answers.filter((a) => a.roundIndex === roundIndex && a.verdict === 'correct');
  if (correct.length === 0) return null;
  correct.sort((a, b) => a.elapsedMs - b.elapsedMs || a.userId.localeCompare(b.userId));
  return correct[0].userId;
}

/**
 * 최종 순위. 클라이언트마다 순위가 다르면 즉시 신뢰를 잃으므로 정렬은 완전히
 * 결정론적이어야 한다: 점수 ↓ → 정답 수 ↓ → 총 소요시간 ↑ → user_id 사전순.
 */
export function rankPlayers(answers: AnswerLike[], playerIds: string[]): Standing[] {
  const byPlayer = new Map<string, { totalPoints: number; correctCount: number; totalElapsedMs: number }>();
  for (const id of playerIds) byPlayer.set(id, { totalPoints: 0, correctCount: 0, totalElapsedMs: 0 });

  for (const a of answers) {
    const s = byPlayer.get(a.userId);
    if (!s) continue;
    s.totalPoints += a.points;
    s.totalElapsedMs += a.elapsedMs;
    if (a.verdict === 'correct') s.correctCount += 1;
  }

  // 최속 보너스: DB에 별도로 쓰지 않고, 라운드마다 room_answers로부터 그때그때 계산한다.
  const rounds = new Set(answers.map((a) => a.roundIndex));
  for (const idx of rounds) {
    const fastest = fastestCorrectUserId(answers, idx);
    const s = fastest ? byPlayer.get(fastest) : undefined;
    if (s) s.totalPoints += FASTEST_BONUS;
  }

  const list = [...byPlayer.entries()].map(([userId, s]) => ({ userId, ...s }));
  list.sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.correctCount - a.correctCount ||
      a.totalElapsedMs - b.totalElapsedMs ||
      a.userId.localeCompare(b.userId),
  );

  let rank = 0;
  let prevKey = '';
  return list.map((s, i) => {
    const key = `${s.totalPoints}:${s.correctCount}:${s.totalElapsedMs}`;
    if (key !== prevKey) {
      rank = i + 1;
      prevKey = key;
    }
    return { ...s, rank };
  });
}
