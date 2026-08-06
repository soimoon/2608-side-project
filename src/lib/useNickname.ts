import { useCallback, useEffect, useState } from 'react';
import { fetchNicknameStatus, setNickname as setNicknameApi, type ApiResult } from './groupApi';

export interface UseNicknameResult {
  displayName: string | null;
  /** false면 아직 한 번도 닉네임을 확정하지 않은 계정 — 단체게임 화면이 이걸로 게이트를 띄운다. */
  nicknameSet: boolean;
  loading: boolean;
  save: (nickname: string) => Promise<ApiResult<void>>;
}

const CACHE_KEY = 'voca-quiz/nickname-cache';

interface NicknameCache {
  userId: string;
  displayName: string | null;
  nicknameSet: boolean;
}

/** 서버 조회가 끝나기 전 한 프레임이라도 "미설정"이 보이는 깜빡임을 없애려고 마지막
 *  값을 로컬에 남겨 둔다 — 진짜 값은 아니고 "지난번엔 이랬다"는 낙관적 추정일 뿐이라,
 *  refresh()가 항상 뒤이어 서버 값으로 덮어써 확정한다. */
function readCache(userId: string): { displayName: string | null; nicknameSet: boolean } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NicknameCache;
    if (parsed.userId !== userId) return null;
    return { displayName: parsed.displayName, nicknameSet: parsed.nicknameSet };
  } catch {
    return null;
  }
}

function writeCache(userId: string, displayName: string | null, nicknameSet: boolean): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, displayName, nicknameSet }));
  } catch {
    /* no-op — 캐시는 있으면 좋고 없어도 그만이다 */
  }
}

/** 계정의 닉네임(profiles.display_name) 상태. userId가 없으면 아무 일도 하지 않는다. */
export function useNickname(userId: string | undefined): UseNicknameResult {
  const [displayName, setDisplayName] = useState<string | null>(
    () => (userId && readCache(userId)?.displayName) || null,
  );
  const [nicknameSet, setNicknameSet] = useState(() => Boolean(userId && readCache(userId)?.nicknameSet));
  // 캐시가 있으면 그걸 낙관적으로 먼저 보여주고 로딩 스피너 없이 시작한다.
  const [loading, setLoading] = useState(() => !(userId && readCache(userId)));

  const refresh = useCallback(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    // 캐시로 이미 채워 둔 화면이면 조용히 백그라운드에서만 확인한다 — 다시 로딩
    // 상태로 되돌리면 화면이 깜빡이므로 loading은 캐시가 없을 때만 true로 둔다.
    if (!readCache(userId)) setLoading(true);
    void fetchNicknameStatus(userId).then((s) => {
      setDisplayName(s.displayName);
      setNicknameSet(s.nicknameSet);
      setLoading(false);
      writeCache(userId, s.displayName, s.nicknameSet);
    });
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (nickname: string) => {
      if (!userId) return { ok: false, error: '로그인이 필요합니다.' };
      const res = await setNicknameApi(userId, nickname);
      if (res.ok) {
        const trimmed = nickname.trim();
        setDisplayName(trimmed);
        setNicknameSet(true);
        writeCache(userId, trimmed, true);
      }
      return res;
    },
    [userId],
  );

  return { displayName, nicknameSet, loading, save };
}
