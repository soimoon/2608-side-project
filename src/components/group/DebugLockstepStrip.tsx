import { useMemo } from 'react';
import { useLockstep } from '../../lib/useLockstep';
import type { LockstepPhase, Schedule } from '../../lib/lockstep';

function phaseLabel(phase: LockstepPhase): string {
  switch (phase.kind) {
    case 'not-started':
      return '시작 전';
    case 'lead-in':
      return `카운트다운 ${(phase.msLeft / 1000).toFixed(1)}s`;
    case 'answer':
      return `라운드 ${phase.index + 1} · 답 ${(phase.msLeft / 1000).toFixed(1)}s`;
    case 'reveal':
      return `라운드 ${phase.index + 1} · 공개 ${(phase.msLeft / 1000).toFixed(1)}s`;
    case 'ended':
      return '종료';
  }
}

interface Props {
  /** 방 생성 시각(epoch ms). 모두가 DB에서 같은 값을 읽으므로 기기 간 공유 기준점이 된다. */
  roomCreatedAt: number;
}

/**
 * Phase 2 검증용 디버그 스트립. 실제 게임 스케줄이 아니라, room.createdAt(모든 클라이언트가
 * DB에서 동일하게 읽는 값)을 기준으로 "다음 10초 경계"부터 계속 도는 가짜 스케줄이다.
 *
 * 처음엔 각자 접속한 시각을 기준으로 반올림했었는데, 그러면 나중에 들어온 사람이 자기
 * 접속 시각부터 새로 라운드 1을 보는 버그가 있었다 — 기준점 자체가 사람마다 달랐기
 * 때문이다. room.createdAt처럼 "모두가 같은 곳에서 읽는 값"이어야 기기 간에 실제로
 * 맞아떨어진다.
 *
 * Phase 3에서 진짜 게임 스케줄(game_rooms.started_at 기반)이 붙으면 이 컴포넌트는 지운다.
 */
export default function DebugLockstepStrip({ roomCreatedAt }: Props) {
  const schedule = useMemo<Schedule>(
    () => ({
      startedAt: Math.ceil(roomCreatedAt / 10_000) * 10_000,
      leadInMs: 3000,
      answerMs: 8000,
      revealMs: 4000,
      roundCount: 1000,
    }),
    [roomCreatedAt],
  );
  const { phase, clock } = useLockstep(schedule);

  return (
    <p className="muted debug-strip">
      offset {clock.offsetMs.toFixed(0)}ms · rtt {clock.rttMs.toFixed(0)}ms · {phaseLabel(phase)}
    </p>
  );
}
