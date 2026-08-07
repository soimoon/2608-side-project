import { useState } from 'react';
import type { UseWalletResult } from '../lib/useWallet';
import { decorItemsBySlot, type DecorItem } from '../data/decorItems';
import Avatar from './Avatar';
import Icon from './Icon';

interface Props {
  walletState: UseWalletResult;
  onBack: () => void;
}

/** 배경(그라디언트) 아이템은 Avatar로 못 그린다(아바타 전용 아이콘 원이라) — 상점
 *  미리보기용 동그란 견본만 따로 그린다. */
function Swatch({ item }: { item: DecorItem }) {
  if (item.render.type === 'gradient') {
    return (
      <span
        className="decor-swatch"
        style={{
          background: `linear-gradient(${item.render.angle ?? 135}deg, ${item.render.from}, ${item.render.to})`,
        }}
      />
    );
  }
  return <Avatar itemId={item.id} size="md" />;
}

/**
 * 프로필에서 진입하는 상점 겸 보관함. 아바타/배경 두 섹션 — 안 산 아이템을 누르면
 * 구매(+즉시 착용), 산 아이템을 누르면 착용/해제를 토글한다. 별도 "장바구니"나
 * "구매 확인" 단계를 안 둔 건, 가격이 낮고(30~120 씨앗) 실수해도 되돌리기 쉬워서다
 * (다른 아이템을 사서 갈아입으면 그만 — 이미 산 아이템의 환불 개념 자체가 없다).
 */
export default function DecorShop({ walletState, onBack }: Props) {
  const { wallet, equipped, loading, purchase, equip } = walletState;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function handleClick(item: DecorItem) {
    const owned = wallet.ownedItems.includes(item.id);
    setNotice('');
    setBusyId(item.id);

    if (!owned) {
      const res = await purchase(item.id);
      if (!res.ok) {
        setNotice(res.error ?? '구매하지 못했습니다.');
        setBusyId(null);
        return;
      }
      // 사자마자 바로 착용까지 — 사고 나서 또 눌러야 하면 번거롭다.
      await equip(item.slot, item.id);
      setBusyId(null);
      return;
    }

    const isEquipped = equipped[item.slot] === item.id;
    const res = await equip(item.slot, isEquipped ? null : item.id);
    if (!res.ok) setNotice(res.error ?? '착용하지 못했습니다.');
    setBusyId(null);
  }

  function renderSection(slot: 'avatar' | 'background', title: string) {
    const items = decorItemsBySlot(slot);
    return (
      <section className="card">
        <h3>{title}</h3>
        <div className="decor-grid">
          {items.map((item) => {
            const owned = wallet.ownedItems.includes(item.id);
            const isEquipped = equipped[slot] === item.id;
            const affordable = owned || wallet.balance >= item.price;
            return (
              <button
                key={item.id}
                className={`decor-item ${isEquipped ? 'equipped' : ''}`}
                disabled={busyId === item.id || !affordable}
                onClick={() => void handleClick(item)}
              >
                <Swatch item={item} />
                <span className="decor-item-label">{item.label}</span>
                <span className="decor-item-price">
                  {isEquipped ? '착용 중' : owned ? '보유함 · 탭해서 착용' : `씨앗 ${item.price}개`}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 프로필
        </button>
        <h2>꾸미기</h2>
        <div className="topbar-right">
          <span className="wallet-balance">
            <Icon name="seedling" className="badge-icon" />
            {wallet.balance}
          </span>
        </div>
      </div>

      {notice && (
        <p className="notice-bar" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <>
          {renderSection('avatar', '아바타')}
          {renderSection('background', '배경')}
        </>
      )}
    </div>
  );
}
