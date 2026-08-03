import { describe, expect, it } from 'vitest';
import { isLetter, maskWord } from './mask';
import { judge, levenshtein } from './judge';

function revealedCount(word: string, ratio: number, seed: number): number {
  return maskWord(word, ratio, seed).filter((r, i) => r && isLetter(word[i])).length;
}

describe('maskWord', () => {
  it('비율이 0이면 첫 글자만 공개한다', () => {
    const r = maskWord('synthesize', 0, 1);
    expect(r[0]).toBe(true);
    expect(r.slice(1).every((x) => !x)).toBe(true);
  });

  it('첫 글자는 어떤 비율에서도 항상 공개된다', () => {
    for (let ratio = 0; ratio <= 0.4; ratio += 0.05) {
      for (let seed = 0; seed < 20; seed++) {
        expect(maskWord('ubiquitous', ratio, seed)[0]).toBe(true);
      }
    }
  });

  it('공개 글자 수가 비율을 따른다 (첫 글자 포함)', () => {
    // synthesize = 10글자, 40% → 4글자
    expect(revealedCount('synthesize', 0.4, 3)).toBe(4);
    expect(revealedCount('synthesize', 0.2, 3)).toBe(2);
  });

  it('짧은 단어에서도 최소 1글자, 전체 공개는 하지 않는다', () => {
    for (const w of ['cat', 'a', 'go', 'ox']) {
      const c = revealedCount(w, 0.4, 5);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(w.length);
    }
  });

  it('공백과 하이픈은 항상 공개한다', () => {
    const word = 'give up';
    const r = maskWord(word, 0, 1);
    expect(r[4]).toBe(true); // 공백 위치
    const r2 = maskWord('well-known', 0, 1);
    expect(r2[4]).toBe(true); // 하이픈 위치
  });

  it('공개 위치가 한쪽에 몰리지 않는다', () => {
    // 40%로 12글자 단어를 가릴 때, 공개 위치가 앞 절반에만 몰리면 안 된다.
    const word = 'sophisticate'; // 12글자 → 5글자 공개
    let backHalfHits = 0;
    for (let seed = 0; seed < 50; seed++) {
      const r = maskWord(word, 0.4, seed);
      if (r.slice(6).some(Boolean)) backHalfHits++;
    }
    expect(backHalfHits).toBe(50);
  });

  it('시드가 다르면 공개 위치가 달라진다', () => {
    const patterns = new Set(
      Array.from({ length: 30 }, (_, s) => maskWord('sophisticate', 0.3, s).join('')),
    );
    expect(patterns.size).toBeGreaterThan(1);
  });
});

describe('judge', () => {
  it('대소문자와 앞뒤 공백을 무시한다', () => {
    expect(judge('  Synthesize ', 'synthesize')).toBe('correct');
  });

  it('한 글자 차이는 near로 구분한다', () => {
    expect(judge('synthesise', 'synthesize')).toBe('near');
    expect(judge('synthesiz', 'synthesize')).toBe('near');
    expect(judge('synthesizee', 'synthesize')).toBe('near');
  });

  it('두 글자 이상 차이는 오답이다', () => {
    expect(judge('synthesis', 'synthesize')).toBe('wrong');
    expect(judge('', 'synthesize')).toBe('wrong');
  });

  it('편집 거리 계산이 정확하다', () => {
    expect(levenshtein('kitten', 'sitting', 5)).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
});
