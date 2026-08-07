import { useCallback, useEffect, useState } from 'react';
import {
  equipItem,
  fetchEquipped,
  getWallet,
  purchaseItem,
  type ApiResult,
  type Equipped,
  type Wallet,
} from './decorApi';

export interface UseWalletResult {
  wallet: Wallet;
  equipped: Equipped;
  loading: boolean;
  refresh: () => void;
  purchase: (itemId: string) => Promise<ApiResult<void>>;
  equip: (slot: 'avatar' | 'background', itemId: string | null) => Promise<ApiResult<void>>;
}

/** 잔액·보유·착용 상태를 한 번에 관리하는 훅. 게스트(userId 없음)면 완전히 잠들어
 *  있는다 — 재화는 실계정 전용 기능이다(친구 기능과 같은 이유: 게스트는 기기를
 *  바꾸면 사라지는 임시 정체성이라 애써 모은 씨앗이 날아갈 수 있다). */
export function useWallet(userId: string | undefined): UseWalletResult {
  const [wallet, setWallet] = useState<Wallet>({ balance: 0, ownedItems: [] });
  const [equipped, setEquipped] = useState<Equipped>({ avatar: null, background: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!userId) {
      setWallet({ balance: 0, ownedItems: [] });
      setEquipped({ avatar: null, background: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([getWallet(), fetchEquipped(userId)]).then(([w, eq]) => {
      if (w.ok && w.data) setWallet(w.data);
      setEquipped(eq);
      setLoading(false);
    });
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const purchase = useCallback(
    async (itemId: string) => {
      const res = await purchaseItem(itemId);
      if (res.ok) refresh(); // 잔액·보유 목록 둘 다 바뀌니 통째로 다시 불러온다.
      return res;
    },
    [refresh],
  );

  const equip = useCallback(async (slot: 'avatar' | 'background', itemId: string | null) => {
    const res = await equipItem(slot, itemId);
    if (res.ok) setEquipped((prev) => ({ ...prev, [slot]: itemId }));
    return res;
  }, []);

  return { wallet, equipped, loading, refresh, purchase, equip };
}
