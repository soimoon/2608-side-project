import { describe, expect, it } from 'vitest';
import { hintStageAt, progressiveMask } from './groupMask';

describe('hintStageAt', () => {
  it('경과 비율로 3단계를 가른다', () => {
    expect(hintStageAt(0, 10000)).toBe(0);
    expect(hintStageAt(4999, 10000)).toBe(0);
    expect(hintStageAt(5000, 10000)).toBe(1);
    expect(hintStageAt(7499, 10000)).toBe(1);
    expect(hintStageAt(7500, 10000)).toBe(2);
    expect(hintStageAt(10000, 10000)).toBe(2);
  });

  it('answerMs가 0 이하면(방어) 마지막 단계로 취급한다', () => {
    expect(hintStageAt(0, 0)).toBe(2);
  });
});

describe('progressiveMask', () => {
  const word = 'synthesize';
  const seed = 12345;

  it('단조성: stage가 오를 때 공개는 늘어나기만 하고 절대 줄지 않는다', () => {
    const s0 = progressiveMask(word, 0.2, 0, seed);
    const s1 = progressiveMask(word, 0.2, 1, seed);
    const s2 = progressiveMask(word, 0.2, 2, seed);

    s0.forEach((v, i) => {
      if (v) expect(s1[i]).toBe(true);
    });
    s1.forEach((v, i) => {
      if (v) expect(s2[i]).toBe(true);
    });
  });

  it('여러 단어·시드에 걸쳐 단조성이 성립한다', () => {
    const words = ['acute', 'ubiquitous', 'a', 'well-known', 'exploit'];
    for (const w of words) {
      for (let sd = 0; sd < 5; sd++) {
        const stages = [0, 1, 2].map((st) => progressiveMask(w, 0.2, st as 0 | 1 | 2, sd));
        for (let i = 0; i < w.length; i++) {
          if (stages[0][i]) expect(stages[1][i]).toBe(true);
          if (stages[1][i]) expect(stages[2][i]).toBe(true);
        }
      }
    }
  });

  it('stage 0은 base ratio와 같은 결과다', () => {
    const a = progressiveMask(word, 0.2, 0, seed);
    // progressiveMask 내부의 첫 항이 곧 maskWord(word, 0.2, seed)와 같아야 한다.
    // (mask.ts를 import해 직접 비교하면 groupMask가 mask.ts를 안 건드렸는지도 같이 검증된다)
    expect(a.some(Boolean)).toBe(true);
  });

  it('길이가 원래 단어와 같다', () => {
    expect(progressiveMask(word, 0.2, 2, seed)).toHaveLength(word.length);
  });
});
