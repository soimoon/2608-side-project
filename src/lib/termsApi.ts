import { supabase } from './supabase';

/**
 * 이용약관·개인정보처리방침 동의(profiles.terms_agreed_at) 조회/기록.
 * 게스트(익명) 계정은 개인정보를 수집하지 않으므로 호출부(useTerms)가 애초에
 * isRealSession인 경우에만 이 함수들을 부른다.
 */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function fetchTermsAgreed(userId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('terms_agreed_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return false;
    return Boolean((data as { terms_agreed_at: string | null }).terms_agreed_at);
  } catch {
    return false;
  }
}

export async function agreeToTerms(userId: string): Promise<ApiResult<void>> {
  if (!supabase) return { ok: false, error: '클라우드 설정이 없습니다.' };
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ terms_agreed_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) return { ok: false, error: '동의 처리에 실패했습니다.' };
    return { ok: true };
  } catch {
    return { ok: false, error: '동의 처리에 실패했습니다.' };
  }
}
