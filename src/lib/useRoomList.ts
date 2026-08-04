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
  refresh: () => void;
} {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void listRooms().then((list) => {
      setRooms(list);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    // 로컬 const로 한 번 더 좁혀 둔다 — 모듈 바인딩은 정리(cleanup) 클로저 안에서까지
    // null 아님이 좁혀지지 않는다(TS가 다른 곳에서 재할당될 가능성을 배제 못 함).
    const client = supabase;
    if (!client || !enabled) {
      setRooms([]);
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

  return { rooms, loading, refresh };
}
