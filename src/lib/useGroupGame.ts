import { useCallback, useEffect, useRef, useState } from 'react';
import type { Verdict } from '../types';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  fetchAnswers,
  fetchPlayers,
  fetchRoom,
  finishGame,
  heartbeat,
  submitAnswer,
  SUBMIT_WINDOW_CLOSED_MESSAGE,
  type GameRoom,
  type RoomAnswer,
  type RoomPlayer,
} from './groupApi';

/** 게임 중 이모지 리액션 한 건. DB에는 안 남기고 방금 도착한 것만 화면에 잠깐 보여준다. */
export interface Reaction {
  id: string;
  userId: string;
  emoji: string;
  at: number;
}

const REACTION_TTL_MS = 3000;

export interface UseGroupGameResult {
  room: GameRoom | null;
  players: RoomPlayer[];
  /** 이번 판(room.gameNo)의 답안만. 판이 다시 시작되면(같은 방, 다음 game_no) 자동으로 비워진다. */
  answers: RoomAnswer[];
  /** 최근 3초 안에 도착한 이모지 리액션만. DB에 저장되지 않는 휘발성 브로드캐스트다. */
  reactions: Reaction[];
  loading: boolean;
  /** 마지막 제출 실패 사유. WINDOW_CLOSED(뒤늦은 정상 제출)는 여기 안 실린다 — 매
   *  라운드 전환 때마다 겁주는 에러 문구가 뜨면 안 되므로 조용히 삼킨다. 몇 초 뒤
   *  자동으로 비워진다. */
  submitError: string | null;
  submit: (roundIndex: number, input: string, verdict: Verdict) => Promise<RoomAnswer | null>;
  finish: () => Promise<void>;
  sendReaction: (emoji: string) => void;
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
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

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
      // 이모지 리액션은 DB를 안 거치는 순수 브로드캐스트다 — 게임 기록에 남길 이유가
      // 없는 잡담성 신호라 postgres_changes 대신 이 편이 더 가볍고 지연도 적다.
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        const p = payload as { userId?: string; emoji?: string };
        if (!p.userId || !p.emoji) return;
        setReactions((prev) => [...prev, { id: `${p.userId}-${Date.now()}`, userId: p.userId!, emoji: p.emoji!, at: Date.now() }]);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refetchAll();
      });

    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      void client.removeChannel(ch);
    };
  }, [roomId, userId, refetchAll]);

  // 3초 넘은 리액션은 지운다 — 화면에 계속 쌓이면 게임 진행 정보를 가린다.
  useEffect(() => {
    if (reactions.length === 0) return;
    const t = window.setInterval(() => {
      const cutoff = Date.now() - REACTION_TTL_MS;
      setReactions((prev) => prev.filter((r) => r.at > cutoff));
    }, 500);
    return () => window.clearInterval(t);
  }, [reactions.length]);

  // 5초 폴링 백스톱 — 게임 중엔 로비보다 갱신이 빨라야 reveal이 매끄럽다.
  useEffect(() => {
    if (!roomId || !userId) return;
    const t = window.setInterval(() => void refetchAll(), 5_000);
    return () => window.clearInterval(t);
  }, [roomId, userId, refetchAll]);

  // 25초 하트비트. useGroupRoom(로비)에서만 하트비트를 보내고 이 훅은 안 보내고
  // 있었더니, 로비를 떠나 실제로 플레이하는 동안 last_seen_at이 멈춰서 60초쯤
  // 지나면 서로가 "신선하지 않다"고 오판 — 아직 둘 다 잘 플레이 중인데도 아래
  // "혼자 남으면 자동 종료" 로직이 오작동해 게임이 중간에 강제로 끝나 버렸다.
  useEffect(() => {
    if (!roomId || !userId) return;
    void heartbeat(roomId);
    const t = window.setInterval(() => void heartbeat(roomId), 25_000);
    return () => window.clearInterval(t);
  }, [roomId, userId]);

  const submit = useCallback(
    async (roundIndex: number, input: string, verdict: Verdict) => {
      if (!roomId) return null;
      const res = await submitAnswer(roomId, roundIndex, input, verdict);
      if (res.ok && res.data) {
        setAnswers((prev) => [...prev.filter((a) => a.roundIndex !== roundIndex || a.userId !== userId), res.data!]);
        return res.data;
      }
      if (res.error && res.error !== SUBMIT_WINDOW_CLOSED_MESSAGE) setSubmitError(res.error);
      return null;
    },
    [roomId, userId],
  );

  // 몇 초 뒤 자동으로 지운다 — 다른 notice-bar들과 같은 관례(예: RoomScreen).
  useEffect(() => {
    if (!submitError) return;
    const t = window.setTimeout(() => setSubmitError(null), 5_000);
    return () => window.clearTimeout(t);
  }, [submitError]);

  const finish = useCallback(async () => {
    if (!roomId) return;
    await finishGame(roomId);
  }, [roomId]);

  // 브로드캐스트는 보낸 사람 화면에 안 돌아올 수 있어(self: 기본 false), 내가 보낸
  // 것도 로컬에서 바로 한 번 더 넣어 즉시 피드백을 준다.
  const sendReaction = useCallback(
    (emoji: string) => {
      if (!channelRef.current || !userId) return;
      void channelRef.current.send({ type: 'broadcast', event: 'reaction', payload: { userId, emoji } });
      setReactions((prev) => [...prev, { id: `${userId}-${Date.now()}`, userId, emoji, at: Date.now() }]);
    },
    [userId],
  );

  return { room, players, answers, reactions, loading, submitError, submit, finish, sendReaction };
}
