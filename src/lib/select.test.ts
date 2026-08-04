import { describe, expect, it } from 'vitest';
import type { Attempt, SessionResult, Verdict, Word, WordStats } from '../types';
import { byOrder, lastWrongAt, pickRevivalWords, reorderWords, revivalPool, sortKey } from './select';

function word(id: string, stats: Partial<WordStats>, deck = '기본'): Word {
  return {
    id,
    en: id,
    ko: [id],
    deck,
    createdAt: 0,
    updatedAt: 0,
    stats: { seen: 0, correct: 0, wrong: 0, streak: 0, ...stats },
  };
}

/** 정렬용 단어. createdAt만 다르고 order는 없다(= 순서를 한 번도 안 바꾼 상태). */
function ordered(id: string, createdAt: number, order?: number): Word {
  return { ...word(id, {}), createdAt, order };
}

/** changes를 적용한 뒤의 실제 표시 순서. */
function applied(list: Word[], changes: Map<string, number>): string[] {
  return list
    .map((w) => (changes.has(w.id) ? { ...w, order: changes.get(w.id) } : w))
    .sort(byOrder)
    .map((w) => w.id);
}

function session(finishedAt: number, results: [string, Verdict][]): SessionResult {
  const attempts: Attempt[] = results.map(([wordId, verdict]) => ({
    wordId,
    en: wordId,
    ko: [wordId],
    input: '',
    verdict,
    elapsedMs: 0,
    requeued: false,
  }));
  return {
    id: `s${finishedAt}`,
    date: '2026-08-04',
    startedAt: finishedAt - 1000,
    finishedAt,
    settings: {} as SessionResult['settings'],
    attempts,
  };
}

const ids = (ws: Word[]) => ws.map((w) => w.id).sort();

describe('revivalPool', () => {
  it('틀린 적이 있고 아직 5연속을 못 채운 단어만 고른다', () => {
    const words = [
      word('아직못잡음', { wrong: 2, streak: 1 }),
      word('방금틀림', { wrong: 1, streak: 0 }),
      word('부활완료', { wrong: 3, streak: 5 }), // streak 5 도달 → 배지로 넘어갔으니 제외
      word('한번도안틀림', { wrong: 0, streak: 0 }), // 틀린 적 없음 → 제외
    ];
    expect(ids(revivalPool(words, []))).toEqual(['방금틀림', '아직못잡음']);
  });

  it('부활 배지 조건(streak>=5)과 정확히 대칭이라 경계에서 겹치지 않는다', () => {
    const almost = word('4연속', { wrong: 1, streak: 4 });
    const done = word('5연속', { wrong: 1, streak: 5 });
    expect(ids(revivalPool([almost, done], []))).toEqual(['4연속']);
  });

  it('단어장을 지정하면 그 단어장 안에서만 고른다', () => {
    const words = [
      word('a', { wrong: 1, streak: 0 }, 'Day1'),
      word('b', { wrong: 1, streak: 0 }, 'Day2'),
    ];
    expect(ids(revivalPool(words, ['Day1']))).toEqual(['a']);
    expect(ids(revivalPool(words, []))).toEqual(['a', 'b']); // 빈 배열이면 전체
  });
});

describe('sortKey / reorderWords', () => {
  it('order가 없으면 등록 시각이 곧 정렬 키다', () => {
    expect(sortKey(ordered('a', 500))).toBe(500);
    expect(sortKey(ordered('a', 500, 12))).toBe(12); // 직접 매긴 값이 우선
  });

  it('한 칸 위로 옮기면 두 단어의 순서만 뒤바뀐다', () => {
    const list = [ordered('a', 100), ordered('b', 200), ordered('c', 300)];
    const changes = reorderWords(list, 2, 1); // c를 b 앞으로
    expect(applied(list, changes)).toEqual(['a', 'c', 'b']);
  });

  it('맨 앞·맨 뒤로 옮길 수 있다', () => {
    const list = [ordered('a', 100), ordered('b', 200), ordered('c', 300)];
    expect(applied(list, reorderWords(list, 2, 0))).toEqual(['c', 'a', 'b']);
    expect(applied(list, reorderWords(list, 0, 2))).toEqual(['b', 'c', 'a']);
  });

  it('보통은 옮긴 단어 하나만 바뀐다 — 동기화에 올라가는 행을 최소로 유지', () => {
    const list = [ordered('a', 100), ordered('b', 200), ordered('c', 300)];
    expect(reorderWords(list, 2, 0).size).toBe(1);
  });

  it('제자리로 옮기거나 범위를 벗어나면 아무것도 바꾸지 않는다', () => {
    const list = [ordered('a', 100), ordered('b', 200)];
    expect(reorderWords(list, 1, 1).size).toBe(0);
    expect(reorderWords(list, 0, 5).size).toBe(0);
    expect(reorderWords(list, -1, 0).size).toBe(0);
  });

  it('같은 틈에 반복해 끼워 넣어 간격이 바닥나면 목록 전체를 다시 번호 매긴다', () => {
    // b와 c 사이가 이미 부동소수점으로 더 못 쪼갤 만큼 좁은 상황.
    const list = [ordered('a', 100), ordered('b', 200, 200), ordered('c', 300, 200.0000001)];
    const changes = reorderWords(list, 0, 1); // a를 그 좁은 틈으로
    expect(changes.size).toBe(3); // 하나만 고쳐서는 해결이 안 되므로 전체 재번호
    expect(applied(list, changes)).toEqual(['b', 'a', 'c']);
  });

  it('재번호를 매겨도 원래 값 근처에 머문다 — 다른 단어장과 눈금이 어긋나지 않게', () => {
    const list = [ordered('a', 100), ordered('b', 200, 200), ordered('c', 300, 200.0000001)];
    const changes = reorderWords(list, 0, 1);
    for (const v of changes.values()) expect(v).toBeGreaterThanOrEqual(100);
  });

  it('순서를 바꾼 단어와 안 바꾼 단어가 한 목록에 섞여도 비교가 성립한다', () => {
    // order를 createdAt과 같은 눈금(epoch ms)에 올려 둔 덕분에 가능한 성질.
    const list = [ordered('a', 1000), ordered('b', 2000), ordered('c', 3000)];
    const changes = reorderWords(list, 2, 0);
    expect(applied(list, changes)).toEqual(['c', 'a', 'b']);
    expect(changes.get('c')).toBeLessThan(1000);
  });
});

describe('lastWrongAt', () => {
  it('틀린 시도만 기록하고, 여러 번 틀렸으면 가장 최근 시각을 남긴다', () => {
    const history = [
      session(1000, [['a', 'wrong']]),
      session(2000, [['a', 'timeout'], ['b', 'correct']]),
    ];
    const map = lastWrongAt(history);
    expect(map.get('a')).toBe(2000); // 더 최근인 2000으로 갱신
    expect(map.has('b')).toBe(false); // 맞힌 단어는 안 들어간다
  });

  it('세션 순서가 뒤죽박죽이어도 가장 큰 finishedAt을 고른다', () => {
    const history = [session(5000, [['a', 'wrong']]), session(3000, [['a', 'wrong']])];
    expect(lastWrongAt(history).get('a')).toBe(5000);
  });

  it("'near'(오타 판정)도 틀린 것으로 센다", () => {
    expect(lastWrongAt([session(1, [['a', 'near']])].slice()).get('a')).toBe(1);
  });
});

describe('pickRevivalWords', () => {
  const words = [
    word('오래전', { wrong: 1, streak: 0 }),
    word('어제', { wrong: 1, streak: 0 }),
    word('오늘', { wrong: 1, streak: 0 }),
  ];

  it('최근에 틀린 단어부터 채운다', () => {
    const history = [
      session(1000, [['오래전', 'wrong']]),
      session(2000, [['어제', 'wrong']]),
      session(3000, [['오늘', 'wrong']]),
    ];
    // 2개만 뽑으면 가장 최근 둘(오늘·어제)이어야 한다. 출제 순서는 섞이므로 집합으로 비교.
    expect(ids(pickRevivalWords(words, [], 2, history))).toEqual(['어제', '오늘']);
  });

  it('요청한 개수보다 풀이 작으면 있는 만큼만 준다', () => {
    expect(pickRevivalWords(words, [], 99, [])).toHaveLength(3);
  });

  it('되살릴 단어가 없으면 빈 배열', () => {
    const clean = [word('a', { wrong: 0, streak: 0 }), word('b', { wrong: 1, streak: 5 })];
    expect(pickRevivalWords(clean, [], 10, [])).toEqual([]);
  });

  it('세션 기록이 없으면(기기를 바꾼 경우) 부활까지 먼 단어부터 채운다', () => {
    const pool = [
      word('거의다옴', { wrong: 1, streak: 4 }),
      word('멀었음', { wrong: 1, streak: 0 }),
    ];
    expect(ids(pickRevivalWords(pool, [], 1, []))).toEqual(['멀었음']);
  });

  it('streak이 같으면 많이 틀린 단어를 먼저 채운다', () => {
    const pool = [
      word('조금틀림', { wrong: 1, streak: 0 }),
      word('많이틀림', { wrong: 9, streak: 0 }),
    ];
    expect(ids(pickRevivalWords(pool, [], 1, []))).toEqual(['많이틀림']);
  });
});
