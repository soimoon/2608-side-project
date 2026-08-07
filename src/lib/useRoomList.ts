import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { listRooms, type RoomSummary } from './groupApi';

/**
 * 단체게임 로비 목록. postgres_changes를 "다시 읽어라"는 힌트로만 쓰고, 실제 데이터는
 * 항상 list_rooms() RPC로 다시 받는다 — Realtime 이벤트가 (재연결 중 등) 유실돼도
 * 15초 폴링이 백스톱 역할을 한다.
 */
export function useRoomList(enabled: boolean): {
  rooms: RoomSummary[];
  loading: boolean;
  /** 마지막 새로고침이 실패했을 때만 채워진다. 화면은 "방이 없습니다"가 아니라
   *  이 문구 + 다시 시도 버튼을 보여줘야 한다 — listRooms()가 예전엔 실패해도 그냥
   *  []를 돌려줘서 두 상황이 구분이 안 됐다. */
  error: string | null;
  refresh: () => void;
} {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listRooms().then((res) => {
      if (res.ok) {
        // 실패 시엔 rooms를 비우지 않는다 — 잠깐의 폴링 실패로 목록이 깜빡이며
        // 사라지는 것보다, 직전 값을 보여주며 에러 문구만 얹는 게 낫다.
        setRooms(res.data ?? []);
        setError(null);
      } else {
        setError(res.error ?? '목록을 불러오지 못했습니다.');
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    // 로컬 const로 한 번 더 좁혀 둔다 — 모듈 바인딩은 정리(cleanup) 클로저 안에서까지
    // null 아님이 좁혀지지 않는다(TS가 다른 곳에서 재할당될 가능성을 배제 못 함).
    const client = supabase;
    if (!client || !enabled) {
      setRooms([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();

    const poll = window.setInterval(refresh, 15_000);
    const ch = client
      .channel('lobby:rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms' }, refresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });

    return () => {
      window.clearInterval(poll);
      void client.removeChannel(ch);
    };
  }, [enabled, refresh]);

  return { rooms, loading, error, refresh };
}
