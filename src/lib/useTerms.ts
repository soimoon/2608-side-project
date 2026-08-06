import { useCallback, useEffect, useState } from 'react';
import { agreeToTerms, fetchTermsAgreed, type ApiResult } from './termsApi';

export interface UseTermsResult {
  /** false면 아직 약관에 동의하지 않은 계정 — 앱 진입 전 동의 화면이 이걸로 게이트를 띄운다. */
  agreed: boolean;
  loading: boolean;
  agree: () => Promise<ApiResult<void>>;
}

const CACHE_KEY = 'voca-quiz/terms-cache';

interface TermsCache {
  userId: string;
  agreed: boolean;
}

/** 서버 조회가 끝나기 전 한 프레임이라도 동의 화면이 번쩍이는 걸 막으려고 마지막 값을
 *  로컬에 남겨 둔다 — useNickname.ts와 같은 관례. 진짜 값은 아니라 refresh()가 항상
 *  뒤이어 서버 값으로 덮어써 확정한다. */
function readCache(userId: string): boolean | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TermsCache;
    if (parsed.userId !== userId) return null;
    return parsed.agreed;
  } catch {
    return null;
  }
}

function writeCache(userId: string, agreed: boolean): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, agreed }));
  } catch {
    /* no-op — 캐시는 있으면 좋고 없어도 그만이다 */
  }
}

/** 계정의 약관 동의 상태(profiles.terms_agreed_at). userId가 없으면 아무 일도 하지 않는다. */
export function useTerms(userId: string | undefined): UseTermsResult {
  const [agreed, setAgreed] = useState(() => Boolean(userId && readCache(userId)));
  const [loading, setLoading] = useState(() => !(userId && readCache(userId) !== null));

  const refresh = useCallback(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    // userId가 마운트 시점(캐시를 읽어 초기 state를 채우는 useState 이니셜라이저)이
    // 아니라 나중에(세션 복원 후) 채워지는 경우가 실제로는 항상이라, 캐시를 여기서도
    // 다시 확인해 즉시 반영한다 — 안 그러면 loading=false・agreed=false(아직 서버
    // 확인 전의 초기값)인 순간이 생겨 이미 동의한 계정에서도 TermsGate가 잠깐 보인다.
    const cached = readCache(userId);
    if (cached === null) {
      setLoading(true);
    } else {
      setAgreed(cached);
      setLoading(false);
    }
    void fetchTermsAgreed(userId).then((a) => {
      setAgreed(a);
      setLoading(false);
      writeCache(userId, a);
    });
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const agree = useCallback(async () => {
    if (!userId) return { ok: false, error: '로그인이 필요합니다.' };
    const res = await agreeToTerms(userId);
    if (res.ok) {
      setAgreed(true);
      writeCache(userId, true);
    }
    return res;
  }, [userId]);

  return { agreed, loading, agree };
}
