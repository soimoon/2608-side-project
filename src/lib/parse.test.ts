import { describe, expect, it } from 'vitest';
import { normalizeOcrText, parseBulk } from './parse';

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

describe('normalizeOcrText (OCR 잡음 대응)', () => {
  it('영단어만 있는 줄과 한글만 있는 줄을 하나로 합친다', () => {
    const out = normalizeOcrText('synthesize\n통합하다\nubiquitous\n어디에나 있는');
    expect(out).toBe('synthesize\t통합하다\nubiquitous\t어디에나 있는');
  });

  it('Day/Chapter 표제 줄과 페이지 번호만 있는 줄을 제거한다', () => {
    const out = normalizeOcrText('Day 3\nsynthesize\t통합하다\n42\nChapter 12\nacute\t극심한');
    expect(out).toBe('synthesize\t통합하다\nacute\t극심한');
  });

  it('전각 문자를 반각으로, 스마트 따옴표를 일반 따옴표로 바꾼다', () => {
    const out = normalizeOcrText('“synthesize”，"통합하다"');
    expect(out).toBe('"synthesize","통합하다"');
  });

  it('OCR로 끊긴 줄을 합친 뒤 parseBulk가 정상적으로 등록한다', () => {
    const { rows } = parseBulk('Day 1\nsynthesize\n통합하다\n2\nubiquitous\n어디에나 있는');
    expect(rows).toEqual([
      { en: 'synthesize', ko: '통합하다' },
      { en: 'ubiquitous', ko: '어디에나 있는' },
    ]);
  });
});

describe('parseBulk (OCR 오인식 자동 보정)', () => {
  it('숫자/기호가 알파벳으로 오인식된 것을 보정하고 내역을 남긴다', () => {
    // hollow → OCR이 o를 0으로, l을 1로 잘못 읽은 경우
    const { rows } = parseBulk('h0110w\t속이 빈');
    expect(rows[0].en).toBe('hollow');
    expect(rows[0].corrected?.length).toBeGreaterThan(0);
  });

  it('순수 숫자(페이지 번호 등)는 알파벳이 없으면 보정하지 않는다', () => {
    // buildRow는 en에 알파벳이 하나도 없으면 그대로 둔다 (오인식 보정은 알파벳이 섞인 경우만).
    const { rows } = parseBulk('510\t오백십');
    expect(rows[0].en).toBe('510');
    expect(rows[0].corrected).toBeUndefined();
  });

  it('낱자모 단독 등장을 뜻에서 제거한다', () => {
    const { rows } = parseBulk('acute\tㅇ극심한');
    expect(rows[0].ko).toBe('극심한');
    expect(rows[0].corrected?.some((c) => c.includes('뜻'))).toBe(true);
  });

  it('보정이 없으면 corrected 필드가 없다', () => {
    const { rows } = parseBulk('acute\t극심한');
    expect(rows[0].corrected).toBeUndefined();
  });
});
