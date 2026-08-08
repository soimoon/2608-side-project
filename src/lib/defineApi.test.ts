import { describe, expect, it } from 'vitest';
import { formatWithReferences, stripReferences } from './defineApi';

describe('stripReferences', () => {
  // 실제 SerpApi(네이버 검색 경유) 응답으로 확인한 사례들.
  it('끝에 붙은 "(→관련어)" 하나를 지운다', () => {
    expect(stripReferences('사과 (→Adam’s apple, Big Apple, cooking apple)')).toBe('사과');
  });

  it('끝에 붙은 "(=동의어)"를 지운다', () => {
    expect(stripReferences('꼼꼼한, 세심한 (=fastidious, thorough)')).toBe('꼼꼼한, 세심한');
  });

  it('"(→...)"와 "(↔...)"가 연달아 붙어도 전부 지운다', () => {
    expect(stripReferences('인색한 (→stingy), (↔generous)')).toBe('인색한');
  });

  it('단어 앞쪽에 붙는 괄호(뜻풀이 자체의 일부)는 안 건드린다', () => {
    expect(stripReferences('(행동이) 친절한[우호적인]')).toBe('(행동이) 친절한[우호적인]');
    expect(stripReferences('(분위기 등이) 상냥한, 다정한, 친숙한')).toBe('(분위기 등이) 상냥한, 다정한, 친숙한');
  });

  it('참조가 없으면 그대로 둔다', () => {
    expect(stripReferences('친한, 친구 사이의')).toBe('친한, 친구 사이의');
    expect(stripReferences('친선 경기')).toBe('친선 경기');
  });
});

describe('formatWithReferences', () => {
  it('→는 "관련"으로 바꾼다', () => {
    expect(formatWithReferences('사과 (→Adam’s apple, Big Apple, cooking apple)')).toBe(
      '사과 (관련: Adam’s apple, Big Apple, cooking apple)',
    );
  });

  it('=는 "유의"로 바꾼다', () => {
    expect(formatWithReferences('꼼꼼한, 세심한 (=fastidious, thorough)')).toBe(
      '꼼꼼한, 세심한 (유의: fastidious, thorough)',
    );
  });

  it('여러 참조가 붙어 있으면 한글 라벨을 단 채로 다 모아서 붙인다', () => {
    expect(formatWithReferences('인색한 (→stingy), (↔generous)')).toBe(
      '인색한 (관련: stingy · 반의: generous)',
    );
  });

  it('앞쪽 괄호(뜻풀이 자체의 일부)는 안 건드린다', () => {
    expect(formatWithReferences('(행동이) 친절한[우호적인]')).toBe('(행동이) 친절한[우호적인]');
  });

  it('참조가 없으면 그대로 둔다', () => {
    expect(formatWithReferences('친선 경기')).toBe('친선 경기');
  });
});
