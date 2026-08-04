import { useEffect, useRef, useState } from 'react';
import { phaseAt, type LockstepPhase, type Schedule } from './lockstep';
import { clockDrifted, clockStatus, serverNow, syncServerClock } from './serverClock';

export interface LockstepState {
  phase: LockstepPhase;
  clock: { synced: boolean; offsetMs: number; rttMs: number };
}

/**
 * 100ms마다 phaseAt(schedule, serverNow())을 처음부터 다시 계산한다. `schedule`이
 * 바뀌면(예: 방 realtime 갱신으로 started_at이 채워짐) 다음 틱부터 새 스케줄을 따른다.
 *
 * 재동기화 시점: 마운트 직후 / `visibilitychange → visible` / 60초마다 / 벽시계와
 * 250ms 이상 벌어졌을 때(노트북 슬립 등으로 앵커가 흐트러진 경우).
 */
export function useLockstep(schedule: Schedule): LockstepState {
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  const [phase, setPhase] = useState<LockstepPhase>(() => phaseAt(schedule, serverNow()));
  const [clock, setClock] = useState(clockStatus());

  useEffect(() => {
    let cancelled = false;

    async function resync() {
      await syncServerClock();
      if (cancelled) return;
      setClock(clockStatus());
      setPhase(phaseAt(scheduleRef.current, serverNow()));
    }

    void resync();

    const tick = window.setInterval(() => {
      if (clockDrifted()) void resync();
      setPhase(phaseAt(scheduleRef.current, serverNow()));
    }, 100);

    const resyncInterval = window.setInterval(() => void resync(), 60_000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearInterval(resyncInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, clock };
}
