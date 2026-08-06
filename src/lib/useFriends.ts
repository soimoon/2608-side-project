import { useCallback, useEffect, useState } from 'react';
import {
  type Friend,
  type FriendRequest,
  listFriendRequests,
  listFriends,
  removeFriend,
  respondFriendRequest,
} from './friendsApi';

export interface UseFriendsResult {
  friends: Friend[];
  requests: FriendRequest[];
  loading: boolean;
  refetch: () => Promise<void>;
  respond: (fromUserId: string, accept: boolean) => Promise<void>;
  remove: (friendId: string) => Promise<void>;
}

/**
 * 친구 목록 + 받은 요청. friend_requests/friends 테이블엔 select 정책이 없어(RPC
 * 전용, schema.sql 참고) postgres_changes 구독이 애초에 안 된다 — 그래서 방 화면처럼
 * Realtime을 쓰지 않고 20초 폴링 + 창 포커스 시 재조회로 충분히 신선하게 유지한다
 * (App.tsx의 revival_events pull이 쓰는 것과 같은 focus 패턴).
 */
export function useFriends(userId: string | undefined): UseFriendsResult {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const [f, r] = await Promise.all([listFriends(), listFriendRequests()]);
    setFriends(f);
    setRequests(r);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setFriends([]);
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refetch().then(() => setLoading(false));

    const interval = window.setInterval(() => void refetch(), 20_000);
    window.addEventListener('focus', refetch);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refetch);
    };
  }, [userId, refetch]);

  const respond = useCallback(
    async (fromUserId: string, accept: boolean) => {
      await respondFriendRequest(fromUserId, accept);
      void refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (friendId: string) => {
      await removeFriend(friendId);
      void refetch();
    },
    [refetch],
  );

  return { friends, requests, loading, refetch, respond, remove };
}
