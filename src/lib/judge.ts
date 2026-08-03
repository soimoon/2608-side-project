import type { Verdict } from '../types';

/** 대소문자·앞뒤 공백을 무시하고, 내부 연속 공백은 하나로 줄인다. */
export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 편집 거리. limit을 넘으면 조기 종료하고 limit + 1을 반환한다. */
export function levenshtein(a: string, b: string, limit = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > limit) return limit + 1;
    prev = curr.slice();
  }
  return prev[b.length];
}

/**
 * 정답 판정.
 *  - correct: 정규화 후 완전 일치
 *  - near:    편집 거리 1 ("아깝다" — 오답이지만 완전 오답과 구분해 표시)
 *  - wrong:   그 외
 */
export function judge(input: string, answer: string): Verdict {
  const a = normalize(input);
  const b = normalize(answer);
  if (!a) return 'wrong';
  if (a === b) return 'correct';
  if (levenshtein(a, b, 1) === 1) return 'near';
  return 'wrong';
}
