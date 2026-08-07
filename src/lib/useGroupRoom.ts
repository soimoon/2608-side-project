import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  FRESH_WINDOW_MS,
  fetchMessages,
  fetchPlayers,
  fetchRoom,
  heartbeat,
  joinRoom,
  kickPlayer,
  leaveRoom,
  leaveRoomBeacon,
  reconcileRoom,
  sendMessage,
  type ApiResult,
  type GameRoom,
  type RoomMessage,
  type RoomPlayer,
} from './groupApi';

export interface UseGroupRoomResult {
  room: GameRoom | null;
  players: RoomPlayer[];
  messages: RoomMessage[];
  /** 최초 입장(join_room) + 첫 데이터 로딩이 끝나기 전. */
  loading: boolean;
  /** 입장 자체가 실패한 경우(방이 가득 찼거나 이미 사라진 방). */
  joinError: string | null;
  /** 방이 존재했다가 사라진 경우(전원 퇴장 등). joinError와 달리 한 번은 들어와 있었다. */
  roomGone: boolean;
  /** 방장이 강제퇴장시킨 경우. */
  kickedOut: boolean;
  isHost: boolean;
  /** 실패해도 예전엔 조용히 삼켜서 메시지가 그냥 증발했다 — 이제 결과를 돌려주고
   *  ChatPanel이 직접 에러를 보여준다. */
  send: (body: string) => Promise<ApiResult<void>>;
  kick: (userId: string) => Promise<ApiResult<void>>;
  exit: () => Promise<void>;
}

/**
 * 방 화면 하나를 통째로 구독하는 훅. Realtime 채널은 방당 하나(`room:${roomId}`)에
 * game_rooms/room_players/room_messages 세 테이블 변경을 전부 붙인다 — 채널을 쪼개면
 * "채팅은 오는데 참가자 목록은 안 바뀌는" 상태가 생긴다. SUBSCRIBED가 될 때마다
 * 무조건 전체를 다시 읽는다: 구독 성립 전/재연결 중 이벤트는 영영 사라지기 때문이다.
 * 15초 폴링을 백스톱으로 둔다.
 */
export function useGroupRoom(
  roomId: string | null,
  userId: string | undefined,
  displayName: string,
): UseGroupRoomResult {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomGone, setRoomGone] = useState(false);

  const joinedRef = useRef(false);
  const everSawSelfRef = useRef(false);

  const refetchAll = useCallback(async () => {
    if (!roomId) return;
    const [r, p, m] = await Promise.all([fetchRoom(roomId), fetchPlayers(roomId), fetchMessages(roomId)]);
    if (r === null) {
      // 방이 삭제됐다(전원 퇴장 등). 한 번이라도 입장에 성공했던 경우에만 "사라졌다"로 취급한다
      // — 애초에 join이 실패한 경우는 joinError가 그 몫을 담당한다.
      if (joinedRef.current) setRoomGone(true);
      return;
    }
    setRoom(r);
    setPlayers(p);
    setMessages(m);
  }, [roomId]);

  // 최초 입장. join_room은 upsert라 방을 막 만든 방장이 방 화면으로 넘어와 다시 불러도 안전하다.
  useEffect(() => {
    joinedRef.current = false;
    everSawSelfRef.current = false;
    setRoom(null);
    setPlayers([]);
    setMessages([]);
    setJoinError(null);
    setRoomGone(false);

    if (!roomId || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void joinRoom(roomId, displayName).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setJoinError(res.error ?? '입장하지 못했습니다.');
        setLoading(false);
        return;
      }
      joinedRef.current = true;
      await refetchAll();
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // displayName이 세션 중 바뀔 일은 거의 없고, 바뀔 때마다 재입장하면 오히려 어색하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  // Realtime 구독 — 방당 채널 하나.
  useEffect(() => {
    const client = supabase; // cleanup 클로저까지 null 아님을 좁혀 두기 위한 로컬 복사
    if (!client || !roomId || !userId) return;
    const ch = client
      .channel(`room:${roomId}`, { config: { presence: { key: userId } } })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
        () => void refetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
        () => void refetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        () => void refetchAll(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refetchAll();
      });

    return () => {
      void client.removeChannel(ch);
    };
  }, [roomId, userId, refetchAll]);

  // 15초 폴링 백스톱.
  useEffect(() => {
    if (!roomId || !userId) return;
    const t = window.setInterval(() => void refetchAll(), 15_000);
    return () => window.clearInterval(t);
  }, [roomId, userId, refetchAll]);

  // 25초 하트비트 — 다른 사람 화면의 "접속 중" 판정과 방장 승계 판정의 재료.
  useEffect(() => {
    if (!roomId || !userId) return;
    void heartbeat(roomId);
    const t = window.setInterval(() => void heartbeat(roomId), 25_000);
    return () => window.clearInterval(t);
  }, [roomId, userId]);

  // 탭을 완전히 닫을 때는(pagehide) 60초 하트비트 타임아웃을 기다리지 않고 즉시 나간다.
  // persisted===true는 bfcache로 잠깐 백그라운드에 들어간 것뿐(iOS Safari에서 앱을
  // 잠깐 다른 화면으로 넘겨도 pagehide가 뜬다) — 이 경우까지 나가 버리면 "잠깐 딴 데
  // 봤다고 방에서 튕기는" 버그가 된다. persisted===false(진짜 언로드)일 때만 쏜다.
  useEffect(() => {
    if (!roomId || !userId) return;
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) leaveRoomBeacon(roomId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [roomId, userId]);

  // 방장이 신선도 창을 벗어나면(브라우저를 그냥 닫은 경우) 랜덤 지터 후 승계를 시도한다.
  // 여러 참가자가 동시에 호출해도 reconcile_room은 단일 UPDATE라 멱등하다.
  useEffect(() => {
    if (!roomId || !room) return;
    const host = players.find((p) => p.userId === room.hostId);
    const stale = !host || Date.now() - host.lastSeenAt > FRESH_WINDOW_MS;
    if (!stale) return;
    const jitter = Math.random() * 3000;
    const t = window.setTimeout(() => {
      void reconcileRoom(roomId).then(refetchAll);
    }, jitter);
    return () => window.clearTimeout(t);
  }, [roomId, room, players, refetchAll]);

  // 강제퇴장 판정: 한 번이라도 참가자 목록에서 나를 본 뒤, 더 이상 없으면 강제퇴장/자진퇴장된 것.
  useEffect(() => {
    if (!userId) return;
    if (players.some((p) => p.userId === userId)) everSawSelfRef.current = true;
  }, [players, userId]);
  const kickedOut =
    everSawSelfRef.current && Boolean(userId) && !players.some((p) => p.userId === userId) && !roomGone;

  const send = useCallback(
    async (body: string): Promise<ApiResult<void>> => {
      if (!roomId || !userId) return { ok: false, error: '방에 들어가 있어야 보낼 수 있습니다.' };
      return sendMessage(roomId, userId, displayName, body);
    },
    [roomId, userId, displayName],
  );

  const kick = useCallback(
    async (targetUserId: string): Promise<ApiResult<void>> => {
      if (!roomId) return { ok: false, error: '방을 찾을 수 없습니다.' };
      const res = await kickPlayer(roomId, targetUserId);
      void refetchAll();
      return res;
    },
    [roomId, refetchAll],
  );

  const exit = useCallback(async () => {
    if (!roomId) return;
    await leaveRoom(roomId);
  }, [roomId]);

  const isHost = Boolean(room && userId && room.hostId === userId);

  return { room, players, messages, loading, joinError, roomGone, kickedOut, isHost, send, kick, exit };
}
