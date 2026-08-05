import { maskWord } from './mask';

/**
 * 단체게임 전용 힌트 점진 공개. 시간이 지나면 글자를 더 열어 주되, 한 번 열린 글자는
 * 절대 다시 가려지지 않는다 — mask.ts를 다른 비율로 그냥 재호출하면 버킷 경계가
 * 통째로 재계산돼 이미 보이던 글자가 사라질 수 있다(실제로 있던 함정). 그래서 매
 * 단계의 마스크를 새로 계산하는 대신, 0단계부터 지금 단계까지의 마스크를 전부
 * 합집합으로 쌓는다 — 집합이 커지기만 하므로 "이미 공개된 글자는 안 사라진다"는
 * 불변식이 구조적으로 보장된다.
 */

const STAGE_STEP = 0.15;

/** 경과 비율(0~1)에 따라 힌트 단계를 정한다. 0~50%는 0단계, 50~75%는 1단계, 그 뒤는 2단계. */
export function hintStageAt(elapsedMs: number, answerMs: number): 0 | 1 | 2 {
  if (answerMs <= 0) return 2;
  const p = elapsedMs / answerMs;
  if (p < 0.5) return 0;
  if (p < 0.75) return 1;
  return 2;
}

/** stage까지의 마스크 합집합. mask.ts는 전혀 손대지 않는다(솔로 퀴즈에 영향 없음). */
export function progressiveMask(word: string, baseRatio: number, stage: 0 | 1 | 2, seed: number): boolean[] {
  const revealed = [...word].map(() => false);
  for (let s = 0; s <= stage; s++) {
    const ratio = Math.min(1, baseRatio + s * STAGE_STEP);
    maskWord(word, ratio, seed).forEach((v, i) => {
      if (v) revealed[i] = true;
    });
  }
  return revealed;
}
