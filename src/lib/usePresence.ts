import { useEffect } from 'react';
import { touchPresence } from './friendsApi';

/**
 * 앱 전역 접속 상태 하트비트. useGroupRoom.ts의 방 하트비트(25초 주기·60초 신선도)와는
 * 별개 값을 쓴다 — 친구 온라인 표시는 더 빠르게 반영되길 원해서 12초 주기·30초 신선도로
 * 더 촘촘하게 잡았다(schema.sql list_friends/list_invitable_friends와 짝 맞춰야 함).
 * 신선도 창이 하트비트 주기의 2.5배는 되어야 정상 접속 중에도 일시적 지연으로
 * "방금 오프라인"처럼 깜빡이지 않는다 — 그 비율을 유지한 채로 둘 다 줄인 것.
 *
 * status가 'quiz'인 동안엔 다른 사람의 "초대 가능 친구" 목록에서 제외된다
 * (list_invitable_friends의 presence_status 조건) — 문제를 풀고 있는데 초대 모달이
 * 뜨는 걸 막기 위한 신호다. 실계정에서만 의미가 있으므로 userId가 없으면(게스트·
 * 로그아웃) 아무것도 하지 않는다.
 *
 * 탭이 백그라운드로 가면 하트비트를 일부러 멈춘다 — throttle로 지연되는 걸 억지로
 * 우회하지 않는다. 그러면 자연히 신선도 창을 벗어나 "오프라인"으로 보이는데, 다른 앱을
 * 보고 있는 사람을 초대 대상에서 빼는 게 오히려 맞는 동작이다. 탭에 돌아오면
 * visibilitychange가 즉시 한 번 더 쏴서 복귀를 지연 없이 반영한다.
 */
export function usePresence(userId: string | undefined, status: 'idle' | 'quiz'): void {
  useEffect(() => {
    if (!userId) return;

    const tick = () => {
      if (document.visibilityState === 'visible') void touchPresence(status);
    };

    tick();
    const interval = window.setInterval(tick, 12_000);
    document.addEventListener('visibilitychange', tick);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [userId, status]);
}
