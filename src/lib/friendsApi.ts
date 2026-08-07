import { supabase } from './supabase';
import type { ApiResult } from './groupApi';

/**
 * 친구(친구 요청·접속 상태·단체게임 초대) RPC 래퍼. groupApi.ts와 같은 관례를 그대로
 * 따른다: 이 파일의 함수는 절대 throw하지 않는다. 실패하면 {ok:false,error}나 빈
 * 배열을 돌려주고, 호출부(훅)가 UI에 보여주거나 조용히 재시도한다.
 *
 * 남의 닉네임·접속 상태가 필요한 조회는 전부 security definer RPC가 필요한 필드만
 * 골라 돌려준다 — profiles의 select 정책(본인만)은 이 기능 때문에 건드리지 않는다.
 * 자세한 이유는 supabase/schema.sql의 "친구" 절 맨 위 주석 참고.
 */

export type FriendRelation = 'none' | 'friend' | 'outgoing' | 'incoming';

export interface FriendSearchResult {
  userId: string;
  displayName: string;
  relation: FriendRelation;
}

export interface Friend {
  userId: string;
  displayName: string;
  /** 60초 이내 하트비트가 있는지. */
  online: boolean;
  /** 다른 단체게임 방에 신선한 참가자로 들어가 있는지. */
  inGame: boolean;
  /** 착용 중인 아바타 아이템 id(decorItems.ts). 안 꾸몄으면 null. */
  avatar: string | null;
}

export interface FriendRequest {
  fromId: string;
  displayName: string;
  createdAt: number;
}

export interface InvitableFriend {
  userId: string;
  displayName: string;
}

export interface GameInvite {
  id: number;
  roomId: string;
  fromId: string;
  fromName: string;
  roomTitle: string;
  createdAt: number;
}

function mapFriendError(message?: string): string {
  if (message?.includes('ALREADY_FRIENDS')) return '이미 친구입니다.';
  if (message?.includes('ANONYMOUS')) return '게스트 계정은 친구를 추가할 수 없습니다.';
  if (message?.includes('BAD_TARGET')) return '존재하지 않거나 닉네임을 설정하지 않은 사용자입니다.';
  if (message?.includes('NO_REQUEST')) return '이미 처리되었거나 없는 요청입니다.';
  return message ?? '처리하지 못했습니다.';
}

function mapInviteError(message?: string): string {
  if (message?.includes('NOT_FRIEND')) return '친구가 아닙니다.';
  if (message?.includes('ROOM_FULL')) return '방이 가득 찼습니다.';
  if (message?.includes('INVITE_MUTED')) return '상대가 이 방의 초대를 받지 않기로 했습니다.';
  if (message?.includes('TARGET_BUSY')) return '지금은 초대할 수 없는 상태입니다.';
  if (message?.includes('ROOM_NOT_FOUND')) return '이미 사라진 방입니다.';
  if (message?.includes('NOT_MEMBER')) return '방에 들어가 있어야 초대할 수 있습니다.';
  return message ?? '초대하지 못했습니다.';
}

/** 접속 상태를 알린다. 실패해도 다음 주기에 다시 시도되므로 조용히 넘어간다. */
export async function touchPresence(status: 'idle' | 'quiz'): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('touch_presence', { p_status: status });
  } catch {
    /* no-op */
  }
}

interface SearchUserRow {
  id: string;
  display_name: string;
  relation: FriendRelation;
}

/** 닉네임 앞글자로 찾는다. 2글자 미만은 서버가 빈 결과를 돌려주므로 왕복을 아끼려면
 *  호출부에서 미리 걸러도 된다. */
export async function searchUsers(query: string): Promise<FriendSearchResult[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('search_users', { p_query: query });
    if (error || !data) return [];
    return (data as SearchUserRow[]).map((r) => ({
      userId: r.id,
      displayName: r.display_name,
      relation: r.relation,
    }));
  } catch {
    return [];
  }
}

/** 친구 요청을 보낸다. 상대가 이미 나에게 요청해 둔 상태였다면 서버가 바로 친구로
 *  성립시키고 'friend'를 돌려준다(수락 왕복 없이 즉시 성사). */
export async function sendFriendRequest(toUserId: string): Promise<ApiResult<'friend' | 'requested'>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('send_friend_request', { p_to_id: toUserId });
    if (error || !data) return { ok: false, error: mapFriendError(error?.message) };
    return { ok: true, data: data as 'friend' | 'requested' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function respondFriendRequest(fromUserId: string, accept: boolean): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('respond_friend_request', { p_from_id: fromUserId, p_accept: accept });
    if (error) return { ok: false, error: mapFriendError(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 친구를 끊는다. 실패해도 조용히 넘어간다 — 다음 조회 때 여전히 남아 있으면 사용자가 다시 누르면 된다. */
export async function removeFriend(friendId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('remove_friend', { p_friend_id: friendId });
  } catch {
    /* no-op */
  }
}

interface ListFriendRow {
  user_id: string;
  display_name: string;
  online: boolean;
  in_game: boolean;
  avatar: string | null;
}

export async function listFriends(): Promise<Friend[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('list_friends');
    if (error || !data) return [];
    return (data as ListFriendRow[]).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      online: r.online,
      inGame: r.in_game,
      avatar: r.avatar,
    }));
  } catch {
    return [];
  }
}

interface ListRequestRow {
  from_id: string;
  display_name: string;
  created_at: string;
}

export async function listFriendRequests(): Promise<FriendRequest[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('list_friend_requests');
    if (error || !data) return [];
    return (data as ListRequestRow[]).map((r) => ({
      fromId: r.from_id,
      displayName: r.display_name,
      createdAt: new Date(r.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

interface InvitableRow {
  user_id: string;
  display_name: string;
}

/** 지금 이 방으로 불러도 방해가 안 되는 친구만("개인 퀴즈 중 아님 + 접속 중 + 다른
 *  방 없음 + 이 방을 차단 안 함" 네 조건, 서버가 검사). */
/** 실패와 "지금 초대할 친구가 없음"을 구분하려고 ApiResult를 쓴다 — groupApi.ts의
 *  listRooms()와 같은 이유(리스트 참고: 예전엔 실패해도 []를 돌려줘 구분이 안 됐다). */
export async function listInvitableFriends(roomId: string): Promise<ApiResult<InvitableFriend[]>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('list_invitable_friends', { p_room_id: roomId });
    if (error || !data) return { ok: false, error: error?.message ?? '목록을 불러오지 못했습니다.' };
    return {
      ok: true,
      data: (data as InvitableRow[]).map((r) => ({ userId: r.user_id, displayName: r.display_name })),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function inviteFriend(roomId: string, toUserId: string): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('invite_friend', { p_room_id: roomId, p_to_id: toUserId });
    if (error) return { ok: false, error: mapInviteError(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

interface GameInviteRow {
  id: number;
  room_id: string;
  from_id: string;
  from_name: string;
  room_title: string;
  created_at: string;
}

export function fromGameInviteRow(r: GameInviteRow): GameInvite {
  return {
    id: r.id,
    roomId: r.room_id,
    fromId: r.from_id,
    fromName: r.from_name,
    roomTitle: r.room_title,
    createdAt: new Date(r.created_at).getTime(),
  };
}

/** 내가 받은 초대 전부(오래된 순). game_invites_select_mine 정책이 to_id=본인을
 *  허용하므로 RPC 없이 바로 select한다 — 재연결·새로고침 직후 놓친 초대를 채우는 용도. */
export async function fetchPendingInvites(userId: string): Promise<GameInvite[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('game_invites')
      .select('id, room_id, from_id, from_name, room_title, created_at')
      .eq('to_id', userId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return (data as GameInviteRow[]).map(fromGameInviteRow);
  } catch {
    return [];
  }
}

/** 초대에 답한다. 수락해도 여기서 방에 넣어주진 않는다 — 정원 검사가 join_room 한
 *  곳에만 있어야 경쟁 조건이 갈라지지 않으므로, 호출부가 이어서 join_room을 부른다.
 *  성공하면 이동할 방 id를 돌려준다. */
function mapRespondInviteError(message?: string): string {
  if (message?.includes('NO_INVITE')) return '이미 처리되었거나 사라진 초대입니다.';
  return message ?? '처리하지 못했습니다.';
}

export async function respondInvite(
  inviteId: number,
  accept: boolean,
  mute: boolean,
): Promise<ApiResult<string>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('respond_invite', {
      p_invite_id: inviteId,
      p_accept: accept,
      p_mute: mute,
    });
    if (error || !data) return { ok: false, error: mapRespondInviteError(error?.message) };
    return { ok: true, data: data as string };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
