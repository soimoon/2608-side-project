import type { IconName } from '../components/Icon';

export type DecorSlot = 'avatar' | 'background';

/**
 * 실제로 어떻게 그릴지. 지금은 전부 코드(CSS/아이콘)로만 그린다 — 나중에 마스코트
 * 이미지가 생기면 'image' 케이스를 추가하기만 하면 되고, 기존 아이템·화면 코드는
 * 하나도 안 건드려도 된다(DecorRender를 소비하는 쪽은 전부 switch(render.type)).
 */
export type DecorRender =
  | { type: 'icon'; icon: IconName; bg: string }
  | { type: 'gradient'; from: string; to: string; angle?: number }
  | { type: 'image'; src: string };

export interface DecorItem {
  id: string;
  slot: DecorSlot;
  label: string;
  /** 씨앗 가격. supabase/schema.sql의 decor_items 표와 반드시 같아야 한다 —
   *  실제 차감은 서버가 하므로 여기 값은 상점 화면 표시용이다. 어긋나면 "화면에
   *  보이는 가격"과 "실제로 깎이는 금액"이 달라지는 사고가 난다. */
  price: number;
  render: DecorRender;
}

/**
 * 색은 되도록 CSS 변수(--accent 등)를 써서 7개 테마 어디서 봐도 자연스럽게 어울리게
 * 한다. 다만 아바타는 "이 사람 것"이라는 개인 식별 성격이 강해, 테마를 따라 계속
 * 바뀌면 오히려 알아보기 어려워진다 — 아바타 배경은 고정된 파스텔 팔레트를 쓰고,
 * 배경(background) 아이템만 테마 변수를 섞어 쓴다.
 */
export const DECOR_ITEMS: DecorItem[] = [
  {
    id: 'avatar-star',
    slot: 'avatar',
    label: '별',
    price: 30,
    render: { type: 'icon', icon: 'star', bg: '#ffd76a' },
  },
  {
    id: 'avatar-heart',
    slot: 'avatar',
    label: '하트',
    price: 30,
    render: { type: 'icon', icon: 'heart', bg: '#ff9fb2' },
  },
  {
    id: 'avatar-cat',
    slot: 'avatar',
    label: '고양이',
    price: 50,
    render: { type: 'icon', icon: 'cat', bg: '#f3c98b' },
  },
  {
    id: 'avatar-rabbit',
    slot: 'avatar',
    label: '토끼',
    price: 50,
    render: { type: 'icon', icon: 'rabbit', bg: '#d9c7f5' },
  },
  {
    id: 'avatar-moon',
    slot: 'avatar',
    label: '달',
    price: 80,
    render: { type: 'icon', icon: 'moon', bg: '#8fa3d9' },
  },
  {
    id: 'avatar-gem',
    slot: 'avatar',
    label: '보석',
    price: 120,
    render: { type: 'icon', icon: 'gem', bg: '#7fd4c1' },
  },
  {
    id: 'bg-sunrise',
    slot: 'background',
    label: '일출',
    price: 40,
    render: { type: 'gradient', from: '#ffd76a', to: '#ff9fb2', angle: 135 },
  },
  {
    id: 'bg-ocean',
    slot: 'background',
    label: '바다',
    price: 40,
    render: { type: 'gradient', from: '#8fd3f4', to: '#2f6fd0', angle: 135 },
  },
  {
    id: 'bg-meadow',
    slot: 'background',
    label: '초원',
    price: 70,
    render: { type: 'gradient', from: '#c8f0a8', to: '#5cb885', angle: 135 },
  },
  {
    id: 'bg-dusk',
    slot: 'background',
    label: '노을',
    price: 100,
    render: { type: 'gradient', from: '#a685e2', to: '#3a3564', angle: 135 },
  },
];

export function findDecorItem(id: string | null | undefined): DecorItem | undefined {
  if (!id) return undefined;
  return DECOR_ITEMS.find((i) => i.id === id);
}

export function decorItemsBySlot(slot: DecorSlot): DecorItem[] {
  return DECOR_ITEMS.filter((i) => i.slot === slot);
}
