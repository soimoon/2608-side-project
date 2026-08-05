import academicCore from './academic-core.json';
import businessBasic from './business-basic.json';

/** 게임 전용 단어. Word와 의도적으로 다르다 — id/deck/stats가 없다. */
export interface GameWord {
  en: string;
  ko: string[];
}

export interface GameDeck {
  id: string;
  name: string;
  description: string;
  source: string;
  license: string;
  words: GameWord[];
}

/**
 * 시스템이 제공하는 공식 덱. 단어장이 비어 있는 신규 사용자도 참가자 각자 단어장
 * 고르기와 같은 흐름을 타게 해 준다(선택지에 이 덱들을 같이 섞어 보여줄 뿐, 별도
 * 모드 분기가 없다).
 *
 * 저작권 주의: 특정 출판사(해커스·YBM 등)의 선정·배열이나 뜻풀이를 그대로 옮기지
 * 않는다 — 표제어는 일반적인 학술/비즈니스 어휘고, 한국어 뜻은 직접 작성했다.
 */
export const GAME_DECKS: GameDeck[] = [academicCore as GameDeck, businessBasic as GameDeck];

export function findGameDeck(id: string): GameDeck | undefined {
  return GAME_DECKS.find((d) => d.id === id);
}
