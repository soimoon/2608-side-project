import { useTheme } from '../lib/theme';

import flatBook from '../assets/icons/open-book.svg';
import flatPencil from '../assets/icons/pencil.svg';
import flatPeople from '../assets/icons/people.svg';
import flatSmile from '../assets/icons/smile.svg';
import flatFire from '../assets/icons/fire.svg';
import flatSeedling from '../assets/icons/seedling.svg';
import flatBooks from '../assets/icons/books.svg';
import flatSpeaker from '../assets/icons/speaker.svg';
import flatMedalGold from '../assets/icons/medal-gold.svg';
import flatMedalSilver from '../assets/icons/medal-silver.svg';
import flatMedalBronze from '../assets/icons/medal-bronze.svg';
import flatCrown from '../assets/icons/crown.svg';

import monoBook from '../assets/icons/open-book-mono.svg?raw';
import monoPencil from '../assets/icons/pencil-mono.svg?raw';
import monoPeople from '../assets/icons/people-mono.svg?raw';
import monoSmile from '../assets/icons/smile-mono.svg?raw';
import monoFire from '../assets/icons/fire-mono.svg?raw';
import monoSeedling from '../assets/icons/seedling-mono.svg?raw';
import monoBooks from '../assets/icons/books-mono.svg?raw';
import monoSpeaker from '../assets/icons/speaker-mono.svg?raw';
import monoMedalGold from '../assets/icons/medal-gold-mono.svg?raw';
import monoMedalSilver from '../assets/icons/medal-silver-mono.svg?raw';
import monoMedalBronze from '../assets/icons/medal-bronze-mono.svg?raw';
import monoCrown from '../assets/icons/crown-mono.svg?raw';

const FLAT = {
  book: flatBook,
  pencil: flatPencil,
  people: flatPeople,
  smile: flatSmile,
  fire: flatFire,
  seedling: flatSeedling,
  books: flatBooks,
  speaker: flatSpeaker,
  medalGold: flatMedalGold,
  medalSilver: flatMedalSilver,
  medalBronze: flatMedalBronze,
  crown: flatCrown,
} as const;

const MONO = {
  book: monoBook,
  pencil: monoPencil,
  people: monoPeople,
  smile: monoSmile,
  fire: monoFire,
  seedling: monoSeedling,
  books: monoBooks,
  speaker: monoSpeaker,
  medalGold: monoMedalGold,
  medalSilver: monoMedalSilver,
  medalBronze: monoMedalBronze,
  crown: monoCrown,
} as const;

export type IconName = keyof typeof FLAT;

interface Props {
  name: IconName;
  className?: string;
}

/**
 * 블랙&화이트 테마(라이트/다크)에서만 Fluent Emoji의 모노(High Contrast) 버전을 쓰고,
 * 나머지 테마는 전부 컬러(Flat) 버전을 쓴다. 모노는 currentColor로 칠해져 있어 인라인
 * SVG로 그려야 테마 글자색을 그대로 물려받는다 — <img src>로는 그게 안 된다.
 */
export default function Icon({ name, className }: Props) {
  const theme = useTheme();
  if (theme === 'bw-light' || theme === 'bw-dark') {
    return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: MONO[name] }} />;
  }
  return <img className={className} src={FLAT[name]} alt="" />;
}
