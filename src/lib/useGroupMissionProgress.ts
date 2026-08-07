import { useCallback, useEffect, useState } from 'react';
import { fetchTodayGroupFinishes } from './groupApi';

/**
 * "단체게임 1판 완주" 미션의 오늘 진행률. 로컬 데이터가 없어(단체게임 기록은
 * 서버 room_answers에만 있다) 서버에 물어봐야 한다 — 로그인 시 한 번 + 창 포커스를
 * 되찾을 때마다 다시 확인한다(App.tsx의 revival_events pull과 같은 focus 패턴,
 * 다른 기기·다른 방에서 판을 끝내고 돌아왔을 수 있어서).
 *
 * userId는 sync.session이 있는 아무 계정(게스트 포함)이나 넘기면 된다 — 씨앗
 * 지급 자체는 daily_claims 트리거가 세션 종류를 안 가리므로, 이 진행률 조회도
 * 굳이 실계정으로 제한할 이유가 없다(다른 미션 3종도 게스트가 그대로 씀).
 */
export function useGroupMissionProgress(userId: string | undefined): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    void fetchTodayGroupFinishes().then(setCount);
  }, [userId]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return count;
}
