import { supabase } from './supabase';

/**
 * 재화(씨앗)·프로필 꾸미기 RPC 래퍼. groupApi.ts/friendsApi.ts와 같은 관례 — 이 파일의
 * 함수는 절대 throw하지 않는다. 실패하면 {ok:false,error}를 돌려주고 호출부(훅)가
 * UI에 보여주거나 조용히 재시도한다.
 */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface Wallet {
  balance: number;
  ownedItems: string[];
}

interface WalletRow {
  balance: number;
  owned_items: string[] | null;
}

export async function getWallet(): Promise<ApiResult<Wallet>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('get_wallet');
    if (error || !data) return { ok: false, error: error?.message ?? '잔액을 불러오지 못했습니다.' };
    // language sql stable 함수가 단일 행을 돌려줄 때 supabase-js는 배열로 감싸 준다.
    const row = (Array.isArray(data) ? data[0] : data) as WalletRow;
    return { ok: true, data: { balance: row.balance, ownedItems: row.owned_items ?? [] } };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function mapPurchaseError(message?: string): string {
  if (message?.includes('ITEM_NOT_FOUND')) return '존재하지 않는 아이템입니다.';
  if (message?.includes('ALREADY_OWNED')) return '이미 가지고 있는 아이템입니다.';
  if (message?.includes('NOT_ENOUGH_SEEDS')) return '씨앗이 부족합니다.';
  return message ?? '구매하지 못했습니다.';
}

export async function purchaseItem(itemId: string): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('purchase_item', { p_item_id: itemId });
    if (error) return { ok: false, error: mapPurchaseError(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function mapEquipError(message?: string): string {
  if (message?.includes('NOT_OWNED')) return '가지고 있지 않은 아이템입니다.';
  if (message?.includes('BAD_ITEM') || message?.includes('BAD_SLOT')) return '착용하지 못했습니다.';
  return message ?? '착용하지 못했습니다.';
}

/** itemId가 null이면 그 칸을 벗는다. */
export async function equipItem(slot: 'avatar' | 'background', itemId: string | null): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase.rpc('equip_item', { p_slot: slot, p_item_id: itemId });
    if (error) return { ok: false, error: mapEquipError(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface Equipped {
  avatar: string | null;
  background: string | null;
}

interface ProfileEquippedRow {
  equipped_avatar: string | null;
  equipped_background: string | null;
}

/** profiles.theme과 같은 패턴 — 단일 mutable 값이라 직접 select한다(profiles_select_own
 *  정책이 이미 "내 행만"을 허용하므로 RPC 없이도 안전하다). */
export async function fetchEquipped(userId: string): Promise<Equipped> {
  if (!supabase) return { avatar: null, background: null };
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('equipped_avatar, equipped_background')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return { avatar: null, background: null };
    const row = data as ProfileEquippedRow;
    return { avatar: row.equipped_avatar, background: row.equipped_background };
  } catch {
    return { avatar: null, background: null };
  }
}

/** GroupResultScreen이 이 문구와 비교해 "standings 판정과 서버 판정이 아주 드물게
 *  어긋난 것뿐"인 흔한 경우를 조용히 넘긴다 — 상수로 공유해 두 파일이 서로 다른
 *  문자열을 갖는 사고를 막는다(useGroupGame.ts의 SUBMIT_WINDOW_CLOSED_MESSAGE와 같은 이유). */
export const CLAIM_NOT_WINNER_MESSAGE = '1등이 아닙니다.';

function mapClaimGameRewardError(message?: string): string {
  if (message?.includes('GAME_NOT_FINISHED')) return '아직 끝나지 않은 판입니다.';
  if (message?.includes('NOT_ENOUGH_ROUNDS')) return '10라운드 이상인 판만 보상이 나갑니다.';
  if (message?.includes('NOT_ENOUGH_PLAYERS')) return '3명 이상 참여한 판만 보상이 나갑니다.';
  if (message?.includes('TIE_NO_WINNER')) return '공동 1등이라 보상이 나가지 않았습니다.';
  if (message?.includes('NOT_WINNER')) return CLAIM_NOT_WINNER_MESSAGE;
  if (message?.includes('DAILY_LIMIT')) return '오늘 받을 수 있는 1등 보상을 다 받았습니다.';
  return message ?? '보상을 받지 못했습니다.';
}

/** 성공하면 받은 씨앗 수를 돌려준다. 1등이 아니거나 조건 미달이면 조용히 실패하는
 *  게 정상 경로다(예: 2등도 결과 화면을 보므로) — 호출부가 에러를 사용자에게 굳이
 *  안 보여줘도 된다(1등 아닌 사람에게 "1등이 아닙니다" 뜨는 게 오히려 이상하다). */
export async function claimGameReward(roomId: string, gameNo: number): Promise<ApiResult<number>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { data, error } = await supabase.rpc('claim_game_reward', { p_room_id: roomId, p_game_no: gameNo });
    if (error || data === null) return { ok: false, error: mapClaimGameRewardError(error?.message) };
    return { ok: true, data: data as number };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
