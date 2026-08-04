/**
 * 닉네임 자동 제시에 쓰는 단어 목록. "샴12"처럼 이 목록의 단어 + 순번으로 조합된다.
 *
 * 지금은 임시 목록(고양이 품종)이다 — 앱 디자인 컨셉이 정해지면(귀여운 테마) 이
 * 배열만 통째로 바꾸면 된다. 순번은 서버(next_nickname RPC)가 단어별로 원자적으로
 * 매기므로, 이 목록을 바꿔도 클라이언트/서버 어느 쪽도 별도로 손댈 곳이 없다.
 */
export const NICKNAME_WORDS = [
  '샴',
  '스코티쉬폴드',
  '러시안블루',
  '페르시안',
  '먼치킨',
  '브리티시숏헤어',
  '아메리칸숏헤어',
  '벵갈',
  '노르웨이숲',
  '랙돌',
  '스핑크스',
  '터키시앙고라',
  '아비시니안',
  '메인쿤',
  '코리안숏헤어',
  '히말라얀',
  '버만',
  '샤르트뢰',
  '오리엔탈숏헤어',
  '봄베이',
] as const;

export function randomNicknameWord(): string {
  return NICKNAME_WORDS[Math.floor(Math.random() * NICKNAME_WORDS.length)];
}
