import { supabase } from './supabase';
import { randomNicknameWord } from '../data/nicknameWords';
import type { Verdict } from '../types';
import type { GameWord } from '../data/decks';

/**
 * 단체게임 방(game_rooms/room_players/room_messages) RPC 래퍼.
 *
 * sync.ts와 같은 관례: 이 파일의 함수는 절대 throw하지 않는다. 실패하면 {ok:false,error}나
 * 빈 배열을 돌려주고, 호출부(훅)가 UI에 보여주거나 조용히 재시도한다. "방 레코드가 곧
 * 게임 상태다" 원칙에 따라 쓰기는 전부 RPC를 거친다 — 정원 초과·방장 이전 같은 경쟁
 * 조건을 클라이언트가 직접 UPDATE로 처리하면 반드시 깨지기 때문이다(자세한 이유는
 * supabase/schema.sql의 game_rooms 절 주석 참고).
 */

export type Speed = 'fast' | 'normal' | 'relaxed';
export type RoundCount = 10 | 20 | 30;
export type RoomStatus = 'lobby' | 'playing';

export interface RoomSummary {
  id: string;
  title: string;
  hostId: string;
  hostName: string;
  maxPlayers: number;
  playerCount: number;
  status: RoomStatus;
  speed: Speed;
  roundCount: number;
  createdAt: number;
}

export interface GameRoom {
  id: string;
  title: string;
  hostId: string;
  maxPlayers: number;
  status: RoomStatus;
  speed: Speed;
  roundCount: number;
  gameNo: number;
  /** 방 생성 시각. 모든 클라이언트가 DB에서 같은 값을 읽으므로, 아직 게임이 시작되지
   *  않은 상태에서도(예: Phase 2 디버그 스케줄) 기기 간에 공유되는 기준 시각으로 쓴다. */
  createdAt: number;
  /**
   * 아래는 start_game이 시작 순간에 동결하는 값들 — status가 'lobby'면 전부 null이다.
   * 락스텝 스케줄(lockstep.ts의 Schedule)이 그대로 이 필드들로부터 만들어진다.
   */
  startedAt: number | null;
  finishedAt: number | null;
  answerMs: number | null;
  revealMs: number | null;
  leadInMs: number | null;
  hintRatio: number | null;
  /** 동결된 출제 단어. from은 그 단어를 낸 참가자 닉네임(reveal 화면 표시용). */
  words: (GameWord & { from: string })[] | null;
  maskSeed: number | null;
}

export interface RoomPlayer {
  userId: string;
  displayName: string;
  sourceKind: 'mine' | 'official' | null;
  sourceLabel: string | null;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomMessage {
  id: number;
  userId: string;
  displayName: string;
  body: string;
  createdAt: number;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** 신선한(60초 이내 하트비트) 참가자만 "접속 중"으로 친다. RPC 쪽 판정과 같은 창을 쓴다. */
export const FRESH_WINDOW_MS = 60_000;

interface RoomListRow {
  id: string;
  title: string;
  host_id: string;
  host_name: string;
  max_players: number;
  player_count: number;
  status: RoomStatus;
  speed: Speed;
  round_count: number;
  created_at: string;
}

function fromListRow(r: RoomListRow): RoomSummary {
  return {
    id: r.id,
    title: r.title,
    hostId: r.host_id,
    hostName: r.host_name,
    maxPlayers: r.max_players,
    playerCount: r.player_count,
    status: r.status,
    speed: r.speed,
    roundCount: r.round_count,
    createdAt: new Date(r.created_at).getTime(),
  };
}

/** 방 목록. 내부적으로 만료된 방 정리(sweep_rooms)도 겸한다. */
export async function listRooms(): Promise<RoomSummary[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('list_rooms');
    if (error || !data) return [];
    return (data as RoomListRow[]).map(fromListRow);
  } catch {
    return [];
  }
}

interface GameRoomRow {
  id: string;
  title: string;
  host_id: string;
  max_players: number;
  status: RoomStatus;
  speed: Speed;
  round_count: number;
  game_no: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  answer_ms: number | null;
  reveal_ms: number | null;
  lead_in_ms: number | null;
  hint_ratio: number | null;
  words: (GameWord & { from: string })[] | null;
  mask_seed: number | null;
}


function fromRoomRow(r: GameRoomRow): GameRoom {
  return {
    id: r.id,
    title: r.title,
    hostId: r.host_id,
    maxPlayers: r.max_players,
    status: r.status,
    speed: r.speed,
    roundCount: r.round_count,
    gameNo: r.game_no,
    createdAt: new Date(r.created_at).getTime(),
    startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).getTime() : null,
    answerMs: r.answer_ms,
    revealMs: r.reveal_ms,
    leadInMs: r.lead_in_ms,
    hintRatio: r.hint_ratio,
    words: r.words,
    maskSeed: r.mask_seed,
  };
}

export async function createRoom(
  title: string,
  maxPlayers: number,
  speed: Speed,
  roundCount: RoundCount,
  displayName: string,
): Promise<ApiResult<GameRoom>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('create_room', {
      p_title: title,
      p_max: maxPlayers,
      p_speed: speed,
      p_round_count: roundCount,
      p_name: displayName,
    });
    if (error || !data) return { ok: false, error: error?.message ?? '방을 만들지 못했습니다.' };
    return { ok: true, data: fromRoomRow(data as GameRoomRow) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function joinRoom(roomId: string, displayName: string): Promise<ApiResult<GameRoom>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('join_room', { p_room_id: roomId, p_name: displayName });
    if (error || !data) return { ok: false, error: mapJoinError(error?.message) };
    return { ok: true, data: fromRoomRow(data as GameRoomRow) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function mapJoinError(message?: string): string {
  if (message?.includes('ROOM_FULL')) return '방이 가득 찼습니다.';
  if (message?.includes('ROOM_NOT_FOUND')) return '이미 사라진 방입니다.';
  if (message?.includes('KICKED_COOLDOWN')) return '강제퇴장된 방입니다. 잠시 후 다시 시도해 주세요.';
  return message ?? '입장하지 못했습니다.';
}

/** 방을 나간다. 실패해도 조용히 넘어간다 — 하트비트가 끊기면 어차피 신선도 창 밖으로 밀려난다. */
export async function leaveRoom(roomId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('leave_room', { p_room_id: roomId });
  } catch {
    /* no-op */
  }
}

export async function kickPlayer(roomId: string, userId: string): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('kick_player', { p_room_id: roomId, p_user_id: userId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 접속 중임을 알린다. 실패해도 다음 주기에 다시 시도되므로 조용히 넘어간다. */
export async function heartbeat(roomId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('heartbeat', { p_room_id: roomId });
  } catch {
    /* no-op */
  }
}

/** 방장이 신선도 창을 벗어났을 때 신선한 참가자에게 방장을 넘긴다. 멱등이라 여러 명이 동시에 불러도 안전하다. */
export async function reconcileRoom(roomId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('reconcile_room', { p_room_id: roomId });
  } catch {
    /* no-op */
  }
}

/** 방 행 자체를 다시 읽는다. null이면 방이 삭제된 것(전원 퇴장 등) — 화면이 이걸로 판정한다. */
export async function fetchRoom(roomId: string): Promise<GameRoom | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('game_rooms')
      .select(
        'id, title, host_id, max_players, status, speed, round_count, game_no, created_at, started_at, finished_at, answer_ms, reveal_ms, lead_in_ms, hint_ratio, words, mask_seed',
      )
      .eq('id', roomId)
      .maybeSingle();
    if (error || !data) return null;
    return fromRoomRow(data as GameRoomRow);
  } catch {
    return null;
  }
}

interface RoomPlayerRow {
  user_id: string;
  display_name: string;
  source_kind: 'mine' | 'official' | null;
  source_label: string | null;
  joined_at: string;
  last_seen_at: string;
}

export async function fetchPlayers(roomId: string): Promise<RoomPlayer[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('room_players')
      .select('user_id, display_name, source_kind, source_label, joined_at, last_seen_at')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error || !data) return [];
    return (data as RoomPlayerRow[]).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      sourceKind: r.source_kind,
      sourceLabel: r.source_label,
      joinedAt: new Date(r.joined_at).getTime(),
      lastSeenAt: new Date(r.last_seen_at).getTime(),
    }));
  } catch {
    return [];
  }
}

interface RoomMessageRow {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

/** 최근 메시지부터 limit개, 화면에 표시할 땐 시간순으로 뒤집어 쓴다. */
export async function fetchMessages(roomId: string, limit = 100): Promise<RoomMessage[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('room_messages')
      .select('id, user_id, display_name, body, created_at')
      .eq('room_id', roomId)
      .order('id', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as RoomMessageRow[])
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        body: r.body,
        createdAt: new Date(r.created_at).getTime(),
      }))
      .reverse();
  } catch {
    return [];
  }
}

export async function sendMessage(
  roomId: string,
  userId: string,
  displayName: string,
  body: string,
): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: '' };
  try {
    const { error } = await supabase
      .from('room_messages')
      .insert({ room_id: roomId, user_id: userId, display_name: displayName, body: trimmed.slice(0, 300) });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * 앱 전체에서 쓰는 닉네임(profiles.display_name). 프로필 화면과 단체게임 양쪽에
 * 보인다. 로그인 제공자의 실명에 기대지 않기 위해, 계정마다 한 번은 반드시
 * 확정해야 한다(nickname_set=false면 단체게임 화면 진입 시 설정 모달을 강제로 띄운다
 * — 지금은 그 화면에 처음 들어갈 때가 사실상 첫 확정 시점이다).
 */
export interface NicknameStatus {
  displayName: string | null;
  nicknameSet: boolean;
}

interface ProfileNicknameRow {
  display_name: string | null;
  nickname_set: boolean;
}

export async function fetchNicknameStatus(userId: string): Promise<NicknameStatus> {
  if (!supabase) return { displayName: null, nicknameSet: false };
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, nickname_set')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return { displayName: null, nicknameSet: false };
    const row = data as ProfileNicknameRow;
    return { displayName: row.display_name, nicknameSet: Boolean(row.nickname_set) };
  } catch {
    return { displayName: null, nicknameSet: false };
  }
}

/**
 * 랜덤 제시안 하나를 받아온다("샴12"). 단어별 순번은 서버가 원자적으로 매기므로
 * (next_nickname RPC) 동시에 여러 명이 같은 단어를 뽑아도 겹치지 않는다.
 */
async function suggestNicknameOnce(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('next_nickname', { p_word: randomNicknameWord() });
    if (error || !data) return null;
    return data as string;
  } catch {
    return null;
  }
}

/**
 * 그 단어로는 10자 안에 빈 번호를 못 찾으면(사실상 없을 상황) RPC가 null을 돌려준다 —
 * 다른 단어로 한 번 더 시도한다. 그래도 안 되면 그냥 빈 입력으로 두고 사용자가 직접 쓰게 한다.
 */
export async function suggestNickname(): Promise<string | null> {
  return (await suggestNicknameOnce()) ?? (await suggestNicknameOnce());
}

/** 닉네임 형식 검사. DB의 profiles_display_name_format 제약과 정확히 같은 규칙이어야 한다. */
const NICKNAME_PATTERN = /^[A-Za-z0-9가-힣]{1,10}$/;

/**
 * 닉네임을 확정한다. profiles_update_own 정책이 이미 "내 행"을 직접 수정하도록
 * 허용해 두어서(id=auth.uid()) RPC 없이 바로 UPDATE한다. 중복·형식은 DB 제약
 * (profiles_display_name_uniq/profiles_display_name_format)이 최종적으로 막아 주므로,
 * 여기 검사는 대부분의 경우 왕복 없이 바로 걸러내는 용도다.
 */
export async function setNickname(userId: string, nickname: string): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  const trimmed = nickname.trim();
  if (!NICKNAME_PATTERN.test(trimmed)) {
    return { ok: false, error: '닉네임은 영문·숫자·한글로 1~10자여야 합니다.' };
  }
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed, nickname_set: true })
      .eq('id', userId);
    if (error) {
      if (error.code === '23505') return { ok: false, error: '이미 사용 중인 닉네임입니다.' };
      if (error.code === '23514') return { ok: false, error: '닉네임은 영문·숫자·한글로 1~10자여야 합니다.' };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------- Phase 3: 단어장 선택 + 게임 플레이 ----------

/**
 * 참가자가 이번 판에 낼 단어장을 고른다(최대 300개). 시작 전까지 몇 번이고 다시
 * 골라도 된다 — set_source RPC가 upsert라 값을 그대로 덮어쓴다.
 */
export async function setSource(
  roomId: string,
  kind: 'mine' | 'official',
  label: string,
  words: GameWord[],
): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('set_source', {
      p_room_id: roomId,
      p_kind: kind,
      p_label: label,
      p_words: words,
    });
    if (error) return { ok: false, error: mapSetSourceError(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function mapSetSourceError(message?: string): string {
  if (message?.includes('EMPTY_WORDS')) return '단어가 없는 단어장입니다.';
  if (message?.includes('TOO_MANY_WORDS')) return '단어장이 너무 큽니다(최대 300개).';
  return message ?? '단어장을 등록하지 못했습니다.';
}

/**
 * 방장이 게임을 시작한다. 서버가 참가자별로 균등 추출해 단어를 동결하고 방 상태를
 * 'playing'으로 바꾼다 — 성공하면 돌아온 GameRoom.words/startedAt으로 곧바로
 * 락스텝 스케줄을 만들 수 있다.
 */
export async function startGame(roomId: string): Promise<ApiResult<GameRoom>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('start_game', { p_room_id: roomId });
    if (error || !data) return { ok: false, error: mapStartGameError(error?.message) };
    return { ok: true, data: fromRoomRow(data as GameRoomRow) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function mapStartGameError(message?: string): string {
  if (message?.includes('NOT_HOST')) return '방장만 시작할 수 있습니다.';
  if (message?.includes('ALREADY_PLAYING')) return '이미 게임이 진행 중입니다.';
  if (message?.includes('NOT_ENOUGH_PLAYERS')) return '최소 2명이 있어야 시작할 수 있습니다.';
  if (message?.includes('NOT_ALL_SELECTED')) return '아직 단어장을 안 고른 참가자가 있습니다.';
  if (message?.includes('NOT_ENOUGH_WORDS')) return '출제할 단어가 너무 적습니다.';
  return message ?? '게임을 시작하지 못했습니다.';
}

export interface RoomAnswer {
  roundIndex: number;
  userId: string;
  verdict: Verdict;
  elapsedMs: number;
  points: number;
}

interface RoomAnswerRow {
  round_index: number;
  user_id: string;
  verdict: Verdict;
  elapsed_ms: number;
  points: number;
}

/** 한 라운드의 답을 제출한다. 시간·점수는 서버가 직접 계산해 돌려준다(클라이언트가 보고하지 않음). */
export async function submitAnswer(
  roomId: string,
  roundIndex: number,
  input: string,
  verdict: Verdict,
): Promise<ApiResult<RoomAnswer>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('submit_answer', {
      p_room_id: roomId,
      p_round_index: roundIndex,
      p_input: input,
      p_verdict: verdict,
    });
    if (error || !data) return { ok: false, error: error?.message ?? '제출하지 못했습니다.' };
    const row = data as RoomAnswerRow;
    return {
      ok: true,
      data: {
        roundIndex: row.round_index,
        userId: row.user_id,
        verdict: row.verdict,
        elapsedMs: row.elapsed_ms,
        points: row.points,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 이번 판(game_no)의 답안 전체. 실시간 구독(reveal 화면)과 결과 화면 양쪽에서 쓴다. */
export async function fetchAnswers(roomId: string, gameNo: number): Promise<RoomAnswer[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('room_answers')
      .select('round_index, user_id, verdict, elapsed_ms, points')
      .eq('room_id', roomId)
      .eq('game_no', gameNo);
    if (error || !data) return [];
    return (data as RoomAnswerRow[]).map((r) => ({
      roundIndex: r.round_index,
      userId: r.user_id,
      verdict: r.verdict,
      elapsedMs: r.elapsed_ms,
      points: r.points,
    }));
  } catch {
    return [];
  }
}

/**
 * 스케줄상 게임이 끝났을 때 아무 클라이언트나 부른다. 서버가 시각을 다시 검사해
 * 진짜 끝났을 때만 동작하므로(그 전엔 조용히 무시) 여러 명이 동시에 불러도 안전하다.
 */
export async function finishGame(roomId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('finish_game', { p_room_id: roomId });
  } catch {
    /* no-op */
  }
}
