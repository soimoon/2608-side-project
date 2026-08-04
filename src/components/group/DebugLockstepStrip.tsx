import { useEffect, useState } from 'react';
import { useLockstep } from '../../lib/useLockstep';
import { serverNow, syncServerClock } from '../../lib/serverClock';
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

function Strip({ schedule }: { schedule: Schedule }) {
  const { phase, clock } = useLockstep(schedule);
  return (
    <p className="muted debug-strip">
      offset {clock.offsetMs.toFixed(0)}ms · rtt {clock.rttMs.toFixed(0)}ms · {phaseLabel(phase)}
    </p>
  );
}

/**
 * Phase 2 검증용 디버그 스트립. 실제 게임 스케줄이 아니라, 각 클라이언트가 독립적으로
 * "다음 10초 경계"를 시작 시각으로 잡아 계속 도는 가짜 스케줄이다 — 그래도 serverNow()가
 * 맞다면 여러 기기가 같은 값을 계산하므로, 실제 게임 없이 동기화 엔진만 검증할 수 있다.
 *
 * 스케줄의 startedAt은 첫 서버 시계 동기화가 끝난 뒤에 고정한다 — 동기화 전의
 * serverNow()는 아직 로컬 시계라, 기기마다 다른 10초 경계로 반올림될 수 있다.
 *
 * Phase 3에서 진짜 게임 스케줄(game_rooms 행 기반)이 붙으면 이 컴포넌트는 지운다.
 */
export default function DebugLockstepStrip() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    let cancelled = false;
    void syncServerClock().then(() => {
      if (cancelled) return;
      const startedAt = Math.ceil(serverNow() / 10_000) * 10_000;
      setSchedule({ startedAt, leadInMs: 3000, answerMs: 8000, revealMs: 4000, roundCount: 1000 });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!schedule) return <p className="muted debug-strip">시계 동기화 중…</p>;
  return <Strip schedule={schedule} />;
}
