import {
  BookOpen,
  Pencil,
  Users,
  Smile,
  Flame,
  Sprout,
  Library,
  Volume2,
  Medal,
  Crown,
  type LucideIcon,
} from 'lucide-react';

const ICONS = {
  book: BookOpen,
  pencil: Pencil,
  people: Users,
  smile: Smile,
  fire: Flame,
  seedling: Sprout,
  books: Library,
  speaker: Volume2,
  medalGold: Medal,
  medalSilver: Medal,
  medalBronze: Medal,
  crown: Crown,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  className?: string;
}

/**
 * Lucide는 stroke="currentColor"라 별도 색 자산 없이 CSS color만으로 테마마다
 * 다른 색을 입힐 수 있다 — 그래서 테마별 아이콘 세트를 따로 안 둔다.
 */
export default function Icon({ name, className }: Props) {
  const Component = ICONS[name];
  return <Component className={className} aria-hidden absoluteStrokeWidth />;
}
