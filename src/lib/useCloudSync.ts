import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { DB } from '../types';
import { isCloudConfigured, supabase } from './supabase';
import { mergeGuestWithCloud, pullAllWords, pullWords, pushWords } from './sync';

export type SyncStatus = 'guest' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudSync {
  /** .env.local에 Supabase 설정이 있는지. 없으면 로그인 UI 자체를 숨겨야 한다. */
  configured: boolean;
  session: Session | null;
  status: SyncStatus;
  message?: string;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * localStorage(db)와 Supabase를 이어주는 훅. 로그인하지 않으면 완전히 잠들어 있고,
 * 실패해도 절대 로컬 데이터를 건드리지 않는다 — 다음 트리거에서 다시 시도할 뿐이다.
 */
export function useCloudSync(db: DB, setDB: Dispatch<SetStateAction<DB>>): CloudSync {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus>('guest');
  const [message, setMessage] = useState<string>();
  const syncing = useRef(false);
  const dbRef = useRef(db);
  dbRef.current = db;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const runSync = useCallback(async () => {
    if (!supabase || !session || syncing.current) return;
    syncing.current = true;
    setStatus('syncing');
    try {
      const userId = session.user.id;
      const current = dbRef.current;
      // 커서가 둘 다 0이면 이 기기에서 한 번도 동기화한 적이 없다는 뜻이고,
      // userId가 다르면 "같은 기기, 다른 계정으로 로그인"한 경우다 — 둘 다
      // 최초 동기화(병합)로 취급해야 한다. 그러지 않으면 이전 계정 기준 커서로
      // 새 계정을 pull/push하게 되어 데이터가 섞이거나 누락된다.
      const firstSync =
        (current.sync.lastPulledAt === 0 && current.sync.lastPushedAt === 0) ||
        (current.sync.userId !== undefined && current.sync.userId !== userId);
      // 요청을 보내기 "전" 시각을 커서로 쓴다. 응답이 오는 동안 생긴 로컬 변경은
      // 이 값보다 늦으므로, 다음 sync에서 자연스럽게 다시 집힌다.
      const tick = Date.now();

      if (firstSync) {
        const remote = await pullAllWords(userId);
        if (!remote.ok) throw new Error(remote.error ?? '동기화 실패');

        const { words: mergedWords, summary } = mergeGuestWithCloud(current.words, remote.words);
        setDB((d) => ({ ...d, words: mergedWords }));

        const pushed = await pushWords(userId, mergedWords, 0, true);
        if (!pushed.ok) throw new Error(pushed.error ?? '동기화 실패');

        setDB((d) => ({ ...d, sync: { lastPulledAt: tick, lastPushedAt: tick, userId } }));
        setMessage(summary);
      } else {
        const pulled = await pullWords(userId, current.sync.lastPulledAt);
        if (!pulled.ok) throw new Error(pulled.error ?? '동기화 실패');

        if (pulled.words.length > 0) {
          setDB((d) => {
            const byId = new Map(d.words.map((w) => [w.id, w]));
            for (const w of pulled.words) {
              // last-write-wins: 서버가 더 최신일 때만 로컬을 덮어쓴다.
              const local = byId.get(w.id);
              if (!local || w.updatedAt > local.updatedAt) byId.set(w.id, w);
            }
            return { ...d, words: [...byId.values()] };
          });
        }

        const pushed = await pushWords(userId, dbRef.current.words, current.sync.lastPushedAt);
        if (!pushed.ok) throw new Error(pushed.error ?? '동기화 실패');

        setDB((d) => ({ ...d, sync: { lastPulledAt: tick, lastPushedAt: tick, userId } }));
        setMessage(undefined);
      }
      setStatus('synced');
    } catch (e) {
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      syncing.current = false;
    }
  }, [session, setDB]);

  // 로그인 직후 1회.
  useEffect(() => {
    if (session) runSync();
    else setStatus('guest');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 창 포커스를 되찾을 때 — 다른 기기에서 바뀐 내용을 받아오기 좋은 시점.
  useEffect(() => {
    if (!session) return;
    const onFocus = () => runSync();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, runSync]);

  // 로컬 변경 후 3초 디바운스 — 타이핑마다 요청을 보내지 않는다.
  useEffect(() => {
    if (!session) return;
    const t = window.setTimeout(runSync, 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.words, session, runSync]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setStatus('guest');
    setMessage(undefined);
  }, []);

  return { configured: isCloudConfigured, session, status, message, signInWithGoogle, signOut };
}
