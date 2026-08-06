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
    // userId가 마운트 시점의 useState 이니셜라이저가 아니라 나중에(세션 복원 후)
    // 채워지는 경우가 실제로는 항상이라, 캐시를 여기서도 다시 확인해 즉시 반영한다 —
    // 안 그러면 loading=false・nicknameSet=false(아직 서버 확인 전의 초기값)인 순간이
    // 생겨 이미 닉네임을 정한 계정에서도 NicknameGateModal이 잠깐 보인다.
    const cached = readCache(userId);
    if (cached === null) {
      setLoading(true);
    } else {
      setDisplayName(cached.displayName);
      setNicknameSet(cached.nicknameSet);
      setLoading(false);
    }
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
