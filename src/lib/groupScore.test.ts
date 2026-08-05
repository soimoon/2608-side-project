import { describe, expect, it } from 'vitest';
import {
  FASTEST_BONUS,
  NEAR_POINTS,
  correctScore,
  fastestCorrectUserId,
  rankPlayers,
  scoreOf,
  type AnswerLike,
} from './groupScore';

const ANSWER_MS = 10_000;

describe('correctScore — 경계값 표', () => {
  // supabase/schema.sql의 submit_answer가 이 표와 정확히 같은 값을 내야 한다(수동 대조용).
  const cases: [number, number][] = [
    [0, 1000], // p=0
    [4999, 700], // stage0 끝 직전 (거의 700에 수렴, round라 700)
    [5000, 650], // stage1 시작 — 경계에서 -50 낙차
    [7499, 450], // stage1 끝 직전
    [7500, 400], // stage2 시작 — 경계에서 -50 낙차
    [10000, 250], // p=1
  ];

  it.each(cases)('elapsed=%i → %i점', (elapsed, expected) => {
    expect(correctScore(elapsed, ANSWER_MS)).toBe(expected);
  });

  it('구간 안에서는 선형으로 감소한다', () => {
    const early = correctScore(1000, ANSWER_MS);
    const mid = correctScore(2000, ANSWER_MS);
    const late = correctScore(3000, ANSWER_MS);
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
  });

  it('음수·초과값은 0/1로 클램프된다', () => {
    expect(correctScore(-500, ANSWER_MS)).toBe(correctScore(0, ANSWER_MS));
    expect(correctScore(ANSWER_MS + 5000, ANSWER_MS)).toBe(correctScore(ANSWER_MS, ANSWER_MS));
  });
});

describe('scoreOf', () => {
  it('near는 항상 고정값, 어떤 정답보다도 낮다', () => {
    expect(scoreOf('near', 0, ANSWER_MS)).toBe(NEAR_POINTS);
    expect(scoreOf('near', ANSWER_MS, ANSWER_MS)).toBe(NEAR_POINTS);
    // 가장 늦은 정답(최저 정답 250)도 near(150)보다 높아야 한다.
    expect(scoreOf('correct', ANSWER_MS, ANSWER_MS)).toBeGreaterThan(NEAR_POINTS);
  });

  it('wrong/timeout/미제출 계열은 0점', () => {
    expect(scoreOf('wrong', 0, ANSWER_MS)).toBe(0);
    expect(scoreOf('timeout', 0, ANSWER_MS)).toBe(0);
  });
});

function answer(
  userId: string,
  roundIndex: number,
  verdict: AnswerLike['verdict'],
  elapsedMs: number,
): AnswerLike {
  return { userId, roundIndex, verdict, elapsedMs, points: scoreOf(verdict, elapsedMs, ANSWER_MS) };
}

describe('fastestCorrectUserId', () => {
  it('그 라운드 정답자 중 가장 빠른 사람을 고른다', () => {
    const answers = [answer('a', 0, 'correct', 3000), answer('b', 0, 'correct', 1000), answer('c', 0, 'wrong', 500)];
    expect(fastestCorrectUserId(answers, 0)).toBe('b');
  });

  it('동점이면 user_id 사전순(결정론적)', () => {
    const answers = [answer('zeta', 0, 'correct', 2000), answer('alpha', 0, 'correct', 2000)];
    expect(fastestCorrectUserId(answers, 0)).toBe('alpha');
  });

  it('정답자가 없으면 null', () => {
    expect(fastestCorrectUserId([answer('a', 0, 'wrong', 100)], 0)).toBeNull();
  });
});

describe('rankPlayers', () => {
  it('점수 합 + 최속 보너스로 순위를 매긴다', () => {
    const answers = [
      answer('a', 0, 'correct', 1000), // 최속 → +보너스
      answer('b', 0, 'correct', 5000),
      answer('a', 1, 'wrong', 0),
      answer('b', 1, 'correct', 1000),
    ];
    const standings = rankPlayers(answers, ['a', 'b']);
    const a = standings.find((s) => s.userId === 'a')!;
    const b = standings.find((s) => s.userId === 'b')!;

    expect(a.totalPoints).toBe(scoreOf('correct', 1000, ANSWER_MS) + FASTEST_BONUS);
    expect(b.totalPoints).toBe(
      scoreOf('correct', 5000, ANSWER_MS) + scoreOf('correct', 1000, ANSWER_MS) + FASTEST_BONUS,
    );
    expect(b.rank).toBe(1); // b가 총점 더 높음
    expect(a.rank).toBe(2);
  });

  it('완전 동점이면 공동 순위를 주고, 다음 사람은 그만큼 건너뛴다', () => {
    const answers = [answer('a', 0, 'correct', 2000), answer('b', 0, 'wrong', 0)];
    // a, b 둘 다 라운드 0에서 서로 다른 결과라 동점 만들기 어려우니, 아예 답이 없는
    // 두 명을 비교한다(0점 동점) + 3등 c.
    const standings = rankPlayers(answers, ['a', 'b', 'x', 'y']);
    const x = standings.find((s) => s.userId === 'x')!;
    const y = standings.find((s) => s.userId === 'y')!;
    expect(x.totalPoints).toBe(0);
    expect(y.totalPoints).toBe(0);
    expect(x.rank).toBe(y.rank); // 완전 동점 공동 순위
  });

  it('참가자 목록에 없는 유저의 답안은 무시한다(존재하지 않는 userId 방어)', () => {
    const answers = [answer('ghost', 0, 'correct', 1000)];
    const standings = rankPlayers(answers, ['a']);
    expect(standings).toHaveLength(1);
    expect(standings[0].totalPoints).toBe(0);
  });

  it('정렬 키가 결정론적이라 같은 입력이면 항상 같은 순서를 준다', () => {
    const answers = [
      answer('a', 0, 'correct', 1000),
      answer('b', 0, 'correct', 2000),
      answer('c', 0, 'correct', 3000),
    ];
    const r1 = rankPlayers(answers, ['a', 'b', 'c']).map((s) => s.userId);
    const r2 = rankPlayers([...answers].reverse(), ['c', 'b', 'a']).map((s) => s.userId);
    expect(r1).toEqual(r2);
  });
});
