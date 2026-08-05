import { useCallback, useEffect, useState } from 'react';
import type { Verdict } from '../types';
import { supabase } from './supabase';
import {
  fetchAnswers,
  fetchPlayers,
  fetchRoom,
  finishGame,
  submitAnswer,
  type GameRoom,
  type RoomAnswer,
  type RoomPlayer,
} from './groupApi';

export interface UseGroupGameResult {
  room: GameRoom | null;
  players: RoomPlayer[];
  /** 이번 판(room.gameNo)의 답안만. 판이 다시 시작되면(같은 방, 다음 game_no) 자동으로 비워진다. */
  answers: RoomAnswer[];
  loading: boolean;
  submit: (roundIndex: number, input: string, verdict: Verdict) => Promise<RoomAnswer | null>;
  finish: () => Promise<void>;
}

/**
 * 게임 플레이 화면(GroupQuizScreen) 전용 구독 훅. RoomScreen의 useGroupRoom과 별개다 —
 * 로비는 채팅이 필요하고 게임 중엔 필요 없는 등 관심사가 달라, 화면이 바뀔 때(로비→게임)
 * 훅도 자연스럽게 새로 마운트되게 뒀다. 채널은 여기서도 방당 하나(`room:${roomId}`)다.
 */
export function useGroupGame(roomId: string | null, userId: string | undefined): UseGroupGameResult {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [answers, setAnswers] = useState<RoomAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const refetchAll = useCallback(async () => {
    if (!roomId) return;
    const r = await fetchRoom(roomId);
    if (!r) return; // 방이 사라진 경우 — 게임 화면에선 흔치 않지만, 그냥 마지막 상태를 유지한다.
    const [p, a] = await Promise.all([fetchPlayers(roomId), fetchAnswers(roomId, r.gameNo)]);
    setRoom(r);
    setPlayers(p);
    setAnswers(a);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void refetchAll().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, userId, refetchAll]);

  useEffect(() => {
    const client = supabase;
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
        { event: '*', schema: 'public', table: 'room_answers', filter: `room_id=eq.${roomId}` },
        () => void refetchAll(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refetchAll();
      });

    return () => {
      void client.removeChannel(ch);
    };
  }, [roomId, userId, refetchAll]);

  // 5초 폴링 백스톱 — 게임 중엔 로비보다 갱신이 빨라야 reveal이 매끄럽다.
  useEffect(() => {
    if (!roomId || !userId) return;
    const t = window.setInterval(() => void refetchAll(), 5_000);
    return () => window.clearInterval(t);
  }, [roomId, userId, refetchAll]);

  const submit = useCallback(
    async (roundIndex: number, input: string, verdict: Verdict) => {
      if (!roomId) return null;
      const res = await submitAnswer(roomId, roundIndex, input, verdict);
      if (res.ok && res.data) {
        setAnswers((prev) => [...prev.filter((a) => a.roundIndex !== roundIndex || a.userId !== userId), res.data!]);
        return res.data;
      }
      return null;
    },
    [roomId, userId],
  );

  const finish = useCallback(async () => {
    if (!roomId) return;
    await finishGame(roomId);
  }, [roomId]);

  return { room, players, answers, loading, submit, finish };
}
