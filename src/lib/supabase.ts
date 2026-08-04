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
      // 단체게임 방의 이모지 리액션이 기본값(초당 10건)을 쉽게 넘는다(5명이 연타하면).
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;
