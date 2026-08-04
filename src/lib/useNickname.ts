import { useCallback, useEffect, useState } from 'react';
import { fetchNicknameStatus, setNickname as setNicknameApi, type ApiResult } from './groupApi';

export interface UseNicknameResult {
  displayName: string | null;
  /** false면 아직 한 번도 닉네임을 확정하지 않은 계정 — 단체게임 화면이 이걸로 게이트를 띄운다. */
  nicknameSet: boolean;
  loading: boolean;
  save: (nickname: string) => Promise<ApiResult<void>>;
}

/** 계정의 닉네임(profiles.display_name) 상태. userId가 없으면 아무 일도 하지 않는다. */
export function useNickname(userId: string | undefined): UseNicknameResult {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [nicknameSet, setNicknameSet] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchNicknameStatus(userId).then((s) => {
      setDisplayName(s.displayName);
      setNicknameSet(s.nicknameSet);
      setLoading(false);
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
        setDisplayName(nickname.trim());
        setNicknameSet(true);
      }
      return res;
    },
    [userId],
  );

  return { displayName, nicknameSet, loading, save };
}
