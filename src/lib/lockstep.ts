/**
 * 락스텝 라운드 스케줄. 순수 함수만 있다 — 방장이 매 라운드 신호를 쏘는 게 아니라,
 * 이 스케줄 하나(서버가 동결한 시작 시각 + 라운드 길이)로부터 모든 클라이언트가
 * "지금이 몇 라운드, 몇 초 남았는지"를 각자 독립적으로 계산한다.
 *
 * 절대 setTimeout으로 다음 라운드를 "누적"해서 넘기지 않는다 — 탭이 백그라운드에서
 * 스로틀링되면 영원히 뒤처진다. 대신 매 틱 phaseAt(schedule, now)을 처음부터 다시
 * 계산한다(파생) — 그래야 30초 잠들었다 깨어나도 다음 틱에 바로 올바른 라운드로 스냅한다.
 */

export interface Schedule {
  /** epoch ms(서버 시각). 아직 게임이 시작되지 않았으면 null. */
  startedAt: number | null;
  /** "3·2·1" 카운트다운 길이 — 시작 신호가 전파되는 지연이 1라운드를 잡아먹지 않게 한다. */
  leadInMs: number;
  /** 문제당 답변 시간. */
  answerMs: number;
  /** 라운드 사이 "누가 맞았나" 공개 구간 — 남의 제출이 도착할 버퍼도 겸한다. */
  revealMs: number;
  roundCount: number;
}

export type LockstepPhase =
  | { kind: 'not-started' }
  | { kind: 'lead-in'; msLeft: number }
  | { kind: 'answer'; index: number; msLeft: number; roundStart: number }
  | { kind: 'reveal'; index: number; msLeft: number }
  | { kind: 'ended' };

/** index번째 라운드가 시작되는 시각(서버 기준 epoch ms). 아직 시작 전이면 null. */
export function roundStartAt(s: Schedule, index: number): number | null {
  if (s.startedAt === null) return null;
  return s.startedAt + s.leadInMs + index * (s.answerMs + s.revealMs);
}

/** 게임 전체가 끝나는 시각. 아직 시작 전이면 null. */
export function gameEndAt(s: Schedule): number | null {
  return roundStartAt(s, s.roundCount);
}

export function phaseAt(s: Schedule, nowMs: number): LockstepPhase {
  const startedAt = s.startedAt;
  if (startedAt === null) return { kind: 'not-started' };

  const leadInEnd = startedAt + s.leadInMs;
  if (nowMs < leadInEnd) return { kind: 'lead-in', msLeft: leadInEnd - nowMs };

  const roundLen = s.answerMs + s.revealMs;
  const end = leadInEnd + s.roundCount * roundLen;
  if (nowMs >= end) return { kind: 'ended' };

  const index = Math.min(s.roundCount - 1, Math.floor((nowMs - leadInEnd) / roundLen));
  const roundStart = leadInEnd + index * roundLen;
  const posInRound = nowMs - roundStart;

  if (posInRound < s.answerMs) {
    return { kind: 'answer', index, msLeft: s.answerMs - posInRound, roundStart };
  }
  return { kind: 'reveal', index, msLeft: roundLen - posInRound };
}
