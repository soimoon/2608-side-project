import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { DB } from '../types';
import { isCloudConfigured, supabase } from './supabase';
import { mergeGuestWithCloud, pullAllWords, pullWords, pushWords } from './sync';

export type SyncStatus = 'guest' | 'syncing' | 'confirming' | 'synced' | 'offline' | 'error';

/**
 * 익명 로그인(단체게임 전용 — 브라우저를 지우면 사라지는 임시 정체성)은 여기서 "진짜
 * 로그인"으로 치지 않는다. 단어장 동기화·테마·출석 같은 계정 기반 기능은 이 함수로
 * 걸러진 세션만 봐야 한다 — 안 그러면 단체게임 테스트 삼아 익명 로그인했을 뿐인데
 * "이 기기 단어장을 계정에 합칠까요?" 팝업이 뜨는 식으로 엉뚱하게 얽힌다.
 */
export function isRealSession(session: Session | null): session is Session {
  return Boolean(session) && session!.user.is_anonymous !== true;
}

/** merge: 합친다 · cloudOnly: 기기 단어는 버리고 계정 단어만 쓴다 · cancel: 로그아웃하고 아무것도 안 바꾼다. */
export type MergeChoice = 'merge' | 'cloudOnly' | 'cancel';

export interface PendingMerge {
  /** 이 기기에 있던(아직 이 계정과 동기화된 적 없는) 단어 수. */
  localCount: number;
  /** 로그인한 계정에 이미 클라우드에 저장돼 있던 단어 수. */
  remoteCount: number;
}

export interface CloudSync {
  /** .env.local에 Supabase 설정이 있는지. 없으면 로그인 UI 자체를 숨겨야 한다. */
  configured: boolean;
  session: Session | null;
  status: SyncStatus;
  message?: string;
  /**
   * 로그인 직후 이 기기에 아직 계정과 합쳐지지 않은 단어가 있으면 채워진다.
   * confirmMerge를 부를 때까지 동기화가 멈춰 있는다 — 물어보지도 않고 기기의
   * 임시 단어를 계정에 밀어넣지 않기 위해서다.
   */
  pendingMerge: PendingMerge | null;
  confirmMerge: (choice: MergeChoice) => void;
  signInWithGoogle: () => Promise<void>;
  /**
   * 단체게임 전용 임시 로그인. 계정 생성·비밀번호 없이 즉시 auth.uid()를 받는다 —
   * 시크릿 창마다 서로 다른 임시 사용자가 되므로, 기기 하나로도 "여러 명"을 흉내 내며
   * 방/라운드 테스트를 할 수 있다. 단어장 동기화에는 관여하지 않는다(isRealSession 참고).
   */
  signInAnonymously: () => Promise<void>;
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
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const syncing = useRef(false);
  const dbRef = useRef(db);
  dbRef.current = db;
  /** askMergeChoice가 만든 Promise를 confirmMerge가 풀어주기 위한 통로. */
  const mergeResolver = useRef<((choice: MergeChoice) => void) | null>(null);

  function askMergeChoice(localCount: number, remoteCount: number): Promise<MergeChoice> {
    return new Promise((resolve) => {
      mergeResolver.current = resolve;
      setPendingMerge({ localCount, remoteCount });
    });
  }

  const confirmMerge = useCallback((choice: MergeChoice) => {
    setPendingMerge(null);
    mergeResolver.current?.(choice);
    mergeResolver.current = null;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const runSync = useCallback(async () => {
    // 익명 세션(단체게임 전용)은 단어장 동기화 대상이 아니다 — isRealSession 주석 참고.
    if (!supabase || !isRealSession(session) || syncing.current) return;
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

        const localActive = current.words.filter((w) => !w.deletedAt);

        // 이 기기에 물어볼 만한 단어가 없으면(빈 게스트 상태) 그냥 계정 데이터를 받는다.
        if (localActive.length === 0) {
          setDB((d) => ({
            ...d,
            words: remote.words,
            sync: { lastPulledAt: tick, lastPushedAt: tick, userId },
          }));
          setStatus('synced');
          return;
        }

        // 기기에 남아 있던 단어를 계정에 합칠지 사용자에게 직접 물어본다 — 로그인만
        // 했는데 임시로 써보던 단어가 조용히 계정에 저장되는 걸 막기 위해서다.
        setStatus('confirming');
        const choice = await askMergeChoice(localActive.length, remote.words.length);

        if (choice === 'cancel') {
          await supabase.auth.signOut();
          setStatus('guest');
          setMessage(undefined);
          return;
        }

        if (choice === 'cloudOnly') {
          setDB((d) => ({
            ...d,
            words: remote.words,
            sync: { lastPulledAt: tick, lastPushedAt: tick, userId },
          }));
          setMessage(
            remote.words.length > 0
              ? `계정 단어 ${remote.words.length}개를 불러왔습니다. 이 기기에 있던 단어는 사용하지 않았습니다.`
              : '이 기기에 있던 단어는 사용하지 않았습니다.',
          );
          setStatus('synced');
          return;
        }

        // choice === 'merge'
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

  // 로그인 직후 1회. 익명 세션이면 동기화를 건너뛰고 그냥 guest 취급한다.
  useEffect(() => {
    if (isRealSession(session)) runSync();
    else setStatus('guest');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 창 포커스를 되찾을 때 — 다른 기기에서 바뀐 내용을 받아오기 좋은 시점.
  useEffect(() => {
    if (!isRealSession(session)) return;
    const onFocus = () => runSync();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, runSync]);

  // 로컬 변경 후 3초 디바운스 — 타이핑마다 요청을 보내지 않는다.
  useEffect(() => {
    if (!isRealSession(session)) return;
    const t = window.setTimeout(runSync, 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.words, session, runSync]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // GitHub Pages는 /voca-quiz/ 하위 경로에서 서빙되므로 origin만 쓰면 경로가 빠진다.
      // 이 값이 Supabase의 Redirect URLs 허용 목록에 없으면 로그인 후 기본 Site URL로
      // 돌아가려다 실패한다(폰에서 "서버에 연결할 수 없음" 형태로 나타남).
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
  }, []);

  const signInAnonymously = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInAnonymously();
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setStatus('guest');
    setMessage(undefined);
  }, []);

  return {
    configured: isCloudConfigured,
    session,
    status,
    message,
    pendingMerge,
    confirmMerge,
    signInWithGoogle,
    signInAnonymously,
    signOut,
  };
}
