import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { type GameInvite, fetchPendingInvites, fromGameInviteRow, respondInvite } from './friendsApi';

/** 이보다 오래된 초대는 무시한다 — 재연결 직후 fetchPendingInvites로 뒤늦게 딸려온
 *  유령 초대나, 상대가 이미 딴 데로 넘어갔을 초대를 화면에 안 띄우기 위해서다. */
const STALE_MS = 90_000;

export interface UseInviteInboxResult {
  /** 큐에서 가장 오래된 하나. 여러 건이 와도 한 번에 하나씩만 보여준다. */
  pendingInvite: GameInvite | null;
  /** 수락하면 이동할 방 id. join_room 자체는 RoomScreen 진입 시 useGroupRoom이 처리한다
   *  (정원 검사를 한 곳에서만 하기 위해 — schema.sql의 respond_invite 주석 참고). */
  accept: () => Promise<string | null>;
  decline: (mute: boolean) => Promise<void>;
}

/**
 * 채널 하나로 "나에게 온 초대"를 구독한다. 방 화면의 room:${roomId} 채널과 같은 모양—
 * postgres_changes로 game_invites의 to_id=내id 행 변화를 받고, SUBSCRIBED가 될 때마다
 * (재연결 포함) fetchPendingInvites로 놓친 초대를 다시 채운다.
 */
export function useInviteInbox(userId: string | undefined): UseInviteInboxResult {
  const [queue, setQueue] = useState<GameInvite[]>([]);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const invites = await fetchPendingInvites(userId);
    setQueue(invites.filter((inv) => Date.now() - inv.createdAt < STALE_MS));
  }, [userId]);

  useEffect(() => {
    const client = supabase;
    if (!client || !userId) {
      setQueue([]);
      return;
    }

    const ch = client
      .channel(`user-invites:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `to_id=eq.${userId}` },
        (payload) => {
          const inv = fromGameInviteRow(payload.new as Parameters<typeof fromGameInviteRow>[0]);
          if (Date.now() - inv.createdAt >= STALE_MS) return;
          setQueue((prev) => (prev.some((x) => x.id === inv.id) ? prev : [...prev, inv]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'game_invites', filter: `to_id=eq.${userId}` },
        (payload) => {
          const oldId = (payload.old as { id?: number }).id;
          if (oldId === undefined) return;
          setQueue((prev) => prev.filter((x) => x.id !== oldId));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refetch();
      });

    return () => {
      void client.removeChannel(ch);
    };
  }, [userId, refetch]);

  // 오래 열어둔 탭에서 큐에 쌓인 채 시간이 지난 초대를 주기적으로 걸러낸다.
  useEffect(() => {
    if (queue.length === 0) return;
    const t = window.setInterval(() => {
      setQueue((prev) => prev.filter((inv) => Date.now() - inv.createdAt < STALE_MS));
    }, 10_000);
    return () => window.clearInterval(t);
  }, [queue.length]);

  const pendingInvite = queue[0] ?? null;

  const accept = useCallback(async (): Promise<string | null> => {
    if (!pendingInvite) return null;
    const res = await respondInvite(pendingInvite.id, true, false);
    setQueue((prev) => prev.filter((x) => x.id !== pendingInvite.id));
    return res.ok ? (res.data ?? null) : null;
  }, [pendingInvite]);

  const decline = useCallback(
    async (mute: boolean) => {
      if (!pendingInvite) return;
      await respondInvite(pendingInvite.id, false, mute);
      setQueue((prev) => prev.filter((x) => x.id !== pendingInvite.id));
    },
    [pendingInvite],
  );

  return { pendingInvite, accept, decline };
}
