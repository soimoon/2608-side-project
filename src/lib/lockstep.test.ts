import { describe, expect, it } from 'vitest';
import { gameEndAt, phaseAt, roundStartAt, type Schedule } from './lockstep';

// startedAt=1000, leadInEnd=4000, roundLen=12000(answer 8000 + reveal 4000), 3라운드.
// round0: [4000,12000) answer, [12000,16000) reveal
// round1: [16000,24000) answer, [24000,28000) reveal
// round2: [28000,36000) answer, [36000,40000) reveal → gameEnd=40000
const schedule: Schedule = {
  startedAt: 1000,
  leadInMs: 3000,
  answerMs: 8000,
  revealMs: 4000,
  roundCount: 3,
};

describe('roundStartAt / gameEndAt', () => {
  it('각 라운드 시작 시각을 계산한다', () => {
    expect(roundStartAt(schedule, 0)).toBe(4000);
    expect(roundStartAt(schedule, 1)).toBe(16000);
    expect(roundStartAt(schedule, 2)).toBe(28000);
  });

  it('gameEndAt은 roundCount번째(마지막 라운드 다음) 시작 시각과 같다', () => {
    expect(gameEndAt(schedule)).toBe(40000);
    expect(gameEndAt(schedule)).toBe(roundStartAt(schedule, 3));
  });

  it('startedAt이 null이면 전부 null', () => {
    const notStarted: Schedule = { ...schedule, startedAt: null };
    expect(roundStartAt(notStarted, 0)).toBeNull();
    expect(gameEndAt(notStarted)).toBeNull();
  });
});

describe('phaseAt', () => {
  it('startedAt이 null이면 시작 전(not-started)', () => {
    const notStarted: Schedule = { ...schedule, startedAt: null };
    expect(phaseAt(notStarted, 999999)).toEqual({ kind: 'not-started' });
  });

  it('아직 리드인 중이면 lead-in', () => {
    expect(phaseAt(schedule, 500)).toEqual({ kind: 'lead-in', msLeft: 3500 });
    expect(phaseAt(schedule, 3999)).toEqual({ kind: 'lead-in', msLeft: 1 });
  });

  it('라운드 정각(리드인이 끝나는 순간)에 정확히 answer로 전환된다', () => {
    expect(phaseAt(schedule, 4000)).toEqual({
      kind: 'answer',
      index: 0,
      msLeft: 8000,
      roundStart: 4000,
    });
  });

  it('답변 마감 1ms 전까지는 answer', () => {
    expect(phaseAt(schedule, 11999)).toEqual({
      kind: 'answer',
      index: 0,
      msLeft: 1,
      roundStart: 4000,
    });
  });

  it('답변 마감 정각(±1ms)에 정확히 reveal로 넘어간다', () => {
    expect(phaseAt(schedule, 12000)).toEqual({ kind: 'reveal', index: 0, msLeft: 4000 });
    expect(phaseAt(schedule, 12001)).toEqual({ kind: 'reveal', index: 0, msLeft: 3999 });
  });

  it('reveal이 끝나는 정각에 다음 라운드의 answer로 넘어간다', () => {
    expect(phaseAt(schedule, 15999)).toEqual({ kind: 'reveal', index: 0, msLeft: 1 });
    expect(phaseAt(schedule, 16000)).toEqual({
      kind: 'answer',
      index: 1,
      msLeft: 8000,
      roundStart: 16000,
    });
  });

  it('마지막 라운드 끝(gameEnd) 1ms 전까지는 reveal, 정각부터는 ended', () => {
    expect(phaseAt(schedule, 39999)).toEqual({ kind: 'reveal', index: 2, msLeft: 1 });
    expect(phaseAt(schedule, 40000)).toEqual({ kind: 'ended' });
  });

  it('게임이 끝난 뒤로도 계속 ended', () => {
    expect(phaseAt(schedule, 999999)).toEqual({ kind: 'ended' });
  });

  it('라운드 인덱스는 단조 증가하며 라운드 수를 넘지 않는다', () => {
    const seen = new Set<number>();
    for (let t = 4000; t < 40000; t += 500) {
      const p = phaseAt(schedule, t);
      if (p.kind === 'answer' || p.kind === 'reveal') {
        seen.add(p.index);
        expect(p.index).toBeLessThan(schedule.roundCount);
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});
