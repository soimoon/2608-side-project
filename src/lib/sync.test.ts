import { describe, expect, it } from 'vitest';
import { mergeGuestWithCloud } from './sync';
import type { Word } from '../types';

function word(over: Partial<Word> & { en: string; ko: string[] }): Word {
  return {
    id: over.id ?? `id-${over.en}`,
    en: over.en,
    ko: over.ko,
    deck: over.deck ?? '기본',
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
    deletedAt: over.deletedAt,
    stats: over.stats ?? { seen: 0, correct: 0, wrong: 0, streak: 0 },
  };
}

describe('mergeGuestWithCloud', () => {
  it('겹치지 않으면 두 목록을 그대로 합친다', () => {
    const local = [word({ en: 'acute', ko: ['극심한'] })];
    const remote = [word({ en: 'ubiquitous', ko: ['어디에나 있는'], id: 'remote-1' })];
    const { words, summary } = mergeGuestWithCloud(local, remote);
    expect(words).toHaveLength(2);
    expect(words.map((w) => w.en).sort()).toEqual(['acute', 'ubiquitous']);
    expect(summary).not.toContain('병합');
  });

  it('같은 철자는 로컬 id를 유지하고 통계를 더한다', () => {
    const local = [
      word({
        id: 'local-1',
        en: 'synthesize',
        ko: ['통합하다'],
        stats: { seen: 3, correct: 2, wrong: 1, streak: 1 },
      }),
    ];
    const remote = [
      word({
        id: 'remote-1',
        en: 'Synthesize', // 대소문자 달라도 같은 단어로 취급
        ko: ['종합하다'],
        stats: { seen: 5, correct: 4, wrong: 1, streak: 4 },
      }),
    ];
    const { words, summary } = mergeGuestWithCloud(local, remote);
    expect(words).toHaveLength(1);
    expect(words[0].id).toBe('local-1'); // 로컬 id 유지 — 세션 기록의 wordId가 안 끊기도록
    expect(words[0].ko).toEqual(['통합하다', '종합하다']); // 로컬 뜻이 먼저, 새 뜻은 뒤에 추가
    expect(words[0].stats).toMatchObject({ seen: 8, correct: 6, wrong: 2, streak: 4 });
    expect(summary).toContain('중복 1개 병합');
  });

  it('뜻이 완전히 같으면 중복으로 이어붙이지 않는다', () => {
    const local = [word({ id: 'l1', en: 'acute', ko: ['극심한'] })];
    const remote = [word({ id: 'r1', en: 'acute', ko: ['극심한'] })];
    const { words } = mergeGuestWithCloud(local, remote);
    expect(words[0].ko).toEqual(['극심한']);
  });

  it('로컬에 여러 뜻이 있어도 순서를 지키고, 겹치지 않는 클라우드 뜻만 뒤에 붙인다', () => {
    const local = [word({ id: 'l1', en: 'exploit', ko: ['이용하다', '위업, 공적'] })];
    const remote = [word({ id: 'r1', en: 'exploit', ko: ['위업, 공적', '착취하다'] })];
    const { words } = mergeGuestWithCloud(local, remote);
    expect(words[0].ko).toEqual(['이용하다', '위업, 공적', '착취하다']);
  });

  it('소프트 삭제된 행은 병합 대상에서 제외한다', () => {
    const local = [word({ id: 'l1', en: 'acute', ko: ['극심한'], deletedAt: 999 })];
    const remote = [word({ id: 'r1', en: 'ubiquitous', ko: ['어디에나 있는'], deletedAt: 999 })];
    const { words } = mergeGuestWithCloud(local, remote);
    expect(words).toHaveLength(0);
  });
});
