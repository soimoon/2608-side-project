import type { DecorItem } from '../data/decorItems';
import { findDecorItem } from '../data/decorItems';
import Icon from './Icon';

interface Props {
  /** 착용한 아이템 id(profiles.equipped_avatar). null/undefined면 기본 얼굴을 보여준다. */
  itemId?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

function renderInner(item: DecorItem | undefined) {
  if (!item) return <Icon name="smile" />;
  switch (item.render.type) {
    case 'icon':
      return <Icon name={item.render.icon} />;
    case 'image':
      return <img src={item.render.src} alt={item.label} />;
    case 'gradient':
      // 아바타 자리에 그라디언트 아이템이 잘못 들어오는 일은 없다(슬롯이 분리돼
      // 있음) — 방어적으로만 처리.
      return null;
  }
}

/** 착용 중인 아바타 아이템을 원 안에 그린다. 프로필·친구 목록에서 공용으로 쓴다. */
export default function Avatar({ itemId, size = 'md' }: Props) {
  const item = findDecorItem(itemId);
  const bg = item?.render.type === 'icon' ? item.render.bg : 'var(--surface-2)';
  return (
    <span className={`avatar avatar-${size}`} style={{ background: bg }}>
      {renderInner(item)}
    </span>
  );
}
