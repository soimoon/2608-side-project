import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * .env.local에 클라우드 설정이 없으면 앱은 게스트(로컬 전용) 모드로 동작한다.
 * 로그인·동기화 UI는 이 값을 보고 자기 자신을 통째로 숨긴다 — 계정을 안 쓰는
 * 사용자에게는 아무 차이가 없어야 한다.
 */
export const isCloudConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
