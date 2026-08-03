import { describe, expect, it } from 'vitest';
import { parseBulk } from './parse';

describe('parseBulk', () => {
  it('엑셀 복붙(탭 구분)을 처리한다', () => {
    const { rows } = parseBulk('synthesize\t통합하다\nubiquitous\t어디에나 있는');
    expect(rows).toEqual([
      { en: 'synthesize', ko: '통합하다' },
      { en: 'ubiquitous', ko: '어디에나 있는' },
    ]);
  });

  it('뜻에 쉼표가 들어가도 영단어만 떼어낸다', () => {
    const { rows } = parseBulk('synthesize\t통합하다, 종합하다');
    expect(rows[0]).toEqual({ en: 'synthesize', ko: '통합하다, 종합하다' });
  });

  it('구분자 없이 공백만 있어도 한글 경계로 자른다', () => {
    const { rows } = parseBulk('mitigate 완화하다, 경감하다');
    expect(rows[0]).toEqual({ en: 'mitigate', ko: '완화하다, 경감하다' });
  });

  it('한글이 앞에 와도 처리한다', () => {
    const { rows } = parseBulk('분명한  apparent');
    expect(rows[0]).toEqual({ en: 'apparent', ko: '분명한' });
  });

  it('여러 구분자와 앞 번호를 정리한다', () => {
    const { rows } = parseBulk('12. mitigate - 완화하다\n3) prolific : 다작하는\n"acute","극심한"');
    expect(rows).toEqual([
      { en: 'mitigate', ko: '완화하다' },
      { en: 'prolific', ko: '다작하는' },
      { en: 'acute', ko: '극심한' },
    ]);
  });

  it('숙어(공백 포함 영어)를 보존한다', () => {
    const { rows } = parseBulk('give up\t포기하다');
    expect(rows[0]).toEqual({ en: 'give up', ko: '포기하다' });
  });

  it('품사 표기를 떼어낸다', () => {
    const { rows } = parseBulk('synthesize (v.)\t통합하다');
    expect(rows[0].en).toBe('synthesize');
  });

  it('중복은 첫 항목만 남긴다', () => {
    const { rows } = parseBulk('acute\t극심한\nacute\t예리한');
    expect(rows).toHaveLength(1);
  });

  it('한글이 없는 줄은 skipped로 보고한다', () => {
    const { rows, skipped } = parseBulk('hello world\nacute\t극심한');
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual(['hello world']);
  });
});
