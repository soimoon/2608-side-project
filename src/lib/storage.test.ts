import { beforeEach, describe, expect, it } from 'vitest';
import { dedupeWordsById, loadDB, saveDB } from './storage';
import type { Word } from '../types';

/**
 * vitest 기본 환경(node)에는 localStorage가 없다. 실제 브라우저 Storage와 같은 동기 동작을
 * 하는 최소 구현만 흉내 낸다 — 마이그레이션이 진짜로 데이터를 보존하는지 검증하려면
 * loadDB()가 마주치는 것과 같은 형태의 localStorage가 필요하다.
 */
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new FakeLocalStorage();
});

const SETTINGS = {
  decks: [],
  count: 50,
  hintRatio: 0.2,
  seconds: 10,
  strategy: 'weak',
  retypeOnMiss: true,
  requeueWrong: true,
  autoPlayAudio: true,
};

describe('loadDB (v1 → v7 마이그레이션)', () => {
  it('v7 데이터가 없고 v1만 있으면 단어를 잃지 않고 옮긴다 (ko는 배열로, decks/theme/출석은 기본값으로)', () => {
    const v1 = {
      version: 1,
      words: [
        {
          id: 'w1',
          en: 'synthesize',
          ko: '통합하다', // v1 시절엔 ko가 문자열 하나였다.
          deck: '기본',
          createdAt: 1700000000000,
          stats: { seen: 2, correct: 1, wrong: 1, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
    };
    localStorage.setItem('voca-quiz/v1', JSON.stringify(v1));

    const db = loadDB();

    expect(db.version).toBe(7);
    expect(db.words).toHaveLength(1);
    expect(db.words[0]).toMatchObject({
      id: 'w1',
      en: 'synthesize',
      ko: ['통합하다'],
      stats: { seen: 2, correct: 1, wrong: 1, streak: 0 },
    });
    // v1엔 없던 필드가 안전하게 채워졌는지.
    expect(db.words[0].updatedAt).toBe(1700000000000); // createdAt으로 백필
    expect(db.words[0].deletedAt).toBeUndefined();
    expect(db.sync).toEqual({ lastPulledAt: 0, lastPushedAt: 0 });
    expect(db.decks).toEqual([]);
    expect(db.theme).toBe('blue');
    expect(db.dailyMission).toEqual({ date: '', revivedWordIds: [] });
    expect(db.dailyClaims).toEqual([]);

    // 마이그레이션 직후 v7로 즉시 저장돼, 다음 로드부터는 이 분기를 타지 않는다.
    expect(localStorage.getItem('voca-quiz/v7')).not.toBeNull();
  });

  it('v7 데이터가 없고 v2만 있어도(ko가 문자열이던 시절) 옮긴다', () => {
    const v2 = {
      version: 2,
      words: [
        {
          id: 'w2',
          en: 'acute',
          ko: '극심한',
          deck: '기본',
          createdAt: 5,
          updatedAt: 5,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
    };
    localStorage.setItem('voca-quiz/v2', JSON.stringify(v2));

    const db = loadDB();
    expect(db.version).toBe(7);
    expect(db.words[0].ko).toEqual(['극심한']);
    expect(db.theme).toBe('blue');
    expect(db.dailyClaims).toEqual([]);
  });

  it('v7 데이터가 없고 v3만 있으면(decks·theme·출석 목록만 없던 시절) 옮긴다', () => {
    const v3 = {
      version: 3,
      words: [
        {
          id: 'w3',
          en: 'exploit',
          ko: ['이용하다', '위업'],
          deck: '기본',
          createdAt: 7,
          updatedAt: 7,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
      pronunciations: {},
    };
    localStorage.setItem('voca-quiz/v3', JSON.stringify(v3));

    const db = loadDB();
    expect(db.version).toBe(7);
    expect(db.words[0].ko).toEqual(['이용하다', '위업']);
    expect(db.decks).toEqual([]);
    expect(db.theme).toBe('blue');
    expect(db.dailyClaims).toEqual([]);
  });

  it('v7 데이터가 없고 v4만 있으면(theme·출석 목록만 없던 시절) 옮긴다', () => {
    const v4 = {
      version: 4,
      words: [
        {
          id: 'w4',
          en: 'prominent',
          ko: ['두드러진'],
          deck: '기본',
          createdAt: 9,
          updatedAt: 9,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
      pronunciations: {},
      decks: ['빈단어장'],
    };
    localStorage.setItem('voca-quiz/v4', JSON.stringify(v4));

    const db = loadDB();
    expect(db.version).toBe(7);
    expect(db.words[0].en).toBe('prominent');
    expect(db.decks).toEqual(['빈단어장']);
    expect(db.theme).toBe('blue');
    expect(db.dailyClaims).toEqual([]);
  });

  it('v7 데이터가 없고 v5만 있으면(출석 목록만 없던 시절) 옮긴다', () => {
    const v5 = {
      version: 5,
      words: [
        {
          id: 'w5',
          en: 'replenish',
          ko: ['다시 채우다'],
          deck: '기본',
          createdAt: 11,
          updatedAt: 11,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
      pronunciations: {},
      decks: [],
      theme: 'pink',
    };
    localStorage.setItem('voca-quiz/v5', JSON.stringify(v5));

    const db = loadDB();
    expect(db.version).toBe(7);
    expect(db.words[0].en).toBe('replenish');
    expect(db.theme).toBe('pink'); // v5에 있던 테마는 보존
    expect(db.dailyMission).toEqual({ date: '', revivedWordIds: [] });
    expect(db.dailyClaims).toEqual([]);
  });

  it('v7 데이터가 없고 v6만 있으면(dailyMission이 카운터였던 시절) 옮긴다', () => {
    const v6 = {
      version: 6,
      words: [
        {
          id: 'w6',
          en: 'mitigate',
          ko: ['완화하다'],
          deck: '기본',
          createdAt: 13,
          updatedAt: 13,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
      pronunciations: {},
      decks: [],
      theme: 'pink',
      // v6 시절엔 revived가 단순 카운터였다 — 구체적으로 어떤 단어였는지는 복원할 수
      // 없으므로 오늘 진행률은 한 번 리셋되는 게 맞다(마이그레이션 함수의 의도된 동작).
      dailyMission: { date: '2026-08-04', revived: 3 },
      dailyClaims: ['2026-08-04:attendance'],
    };
    localStorage.setItem('voca-quiz/v6', JSON.stringify(v6));

    const db = loadDB();
    expect(db.version).toBe(7);
    expect(db.words[0].en).toBe('mitigate');
    expect(db.theme).toBe('pink');
    expect(db.dailyMission).toEqual({ date: '', revivedWordIds: [] });
    // dailyClaims(출석·미션 수령 기록)는 카운터와 무관하니 그대로 보존된다.
    expect(db.dailyClaims).toEqual(['2026-08-04:attendance']);
  });

  it('v7 데이터가 이미 있으면 구버전은 무시한다', () => {
    localStorage.setItem(
      'voca-quiz/v1',
      JSON.stringify({ version: 1, words: [{ id: 'old', en: 'old', ko: '옛날', stats: {} }] }),
    );
    const v7db = {
      version: 7,
      words: [
        {
          id: 'new',
          en: 'acute',
          ko: ['극심한'],
          deck: '기본',
          createdAt: 1,
          updatedAt: 1,
          stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
        },
      ],
      settings: SETTINGS,
      history: [],
      sync: { lastPulledAt: 0, lastPushedAt: 0 },
      pronunciations: {},
      decks: ['빈단어장'],
      theme: 'pink',
      dailyMission: { date: '2026-08-04', revivedWordIds: ['new'] },
      dailyClaims: ['2026-08-04:attendance'],
    };
    localStorage.setItem('voca-quiz/v7', JSON.stringify(v7db));

    const db = loadDB();
    expect(db.words).toHaveLength(1);
    expect(db.words[0].en).toBe('acute');
    expect(db.decks).toEqual(['빈단어장']);
    expect(db.theme).toBe('pink');
    expect(db.dailyMission).toEqual({ date: '2026-08-04', revivedWordIds: ['new'] });
    expect(db.dailyClaims).toEqual(['2026-08-04:attendance']);
  });

  it('저장된 theme 값이 알 수 없는 값이면 기본 테마로 안전하게 되돌린다', () => {
    localStorage.setItem(
      'voca-quiz/v7',
      JSON.stringify({
        version: 7,
        words: [],
        settings: SETTINGS,
        history: [],
        sync: { lastPulledAt: 0, lastPushedAt: 0 },
        pronunciations: {},
        decks: [],
        theme: 'not-a-real-theme',
        dailyMission: { date: '', revivedWordIds: [] },
        dailyClaims: [],
      }),
    );
    const db = loadDB();
    expect(db.theme).toBe('blue');
  });

  it('저장된 dailyMission이 옛 카운터 모양이면(방어적 파싱) 기본값으로 되돌린다', () => {
    localStorage.setItem(
      'voca-quiz/v7',
      JSON.stringify({
        version: 7,
        words: [],
        settings: SETTINGS,
        history: [],
        sync: { lastPulledAt: 0, lastPushedAt: 0 },
        pronunciations: {},
        decks: [],
        theme: 'blue',
        dailyMission: { date: '2026-08-04', revived: 3 }, // revivedWordIds가 없는 옛 모양
        dailyClaims: [],
      }),
    );
    const db = loadDB();
    expect(db.dailyMission).toEqual({ date: '', revivedWordIds: [] });
  });

  it('아무 데이터도 없으면 빈 DB를 만든다', () => {
    const db = loadDB();
    expect(db.words).toEqual([]);
    expect(db.version).toBe(7);
    expect(db.decks).toEqual([]);
    expect(db.theme).toBe('blue');
    expect(db.dailyMission).toEqual({ date: '', revivedWordIds: [] });
    expect(db.dailyClaims).toEqual([]);
  });

  it('깨진 JSON이 있어도 앱이 죽지 않고 빈 DB로 시작한다', () => {
    localStorage.setItem('voca-quiz/v7', '{ this is not json');
    const db = loadDB();
    expect(db.words).toEqual([]);
  });

  it('saveDB로 저장한 뒤 loadDB로 그대로 복원된다 (라운드트립, 뜻 여러 개·빈 단어장·테마·출석 포함)', () => {
    const db = loadDB();
    db.words.push({
      id: 'w1',
      en: 'ubiquitous',
      ko: ['어디에나 있는'],
      deck: '기본',
      createdAt: 10,
      updatedAt: 10,
      stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
    });
    db.words.push({
      id: 'w2',
      en: 'exploit',
      ko: ['이용하다', '위업, 공적'],
      deck: '기본',
      createdAt: 11,
      updatedAt: 11,
      stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
    });
    db.decks.push('토플 Day 3'); // 아직 단어 없는 빈 단어장
    db.theme = 'pink';
    db.dailyMission = { date: '2026-08-04', revivedWordIds: ['w1', 'w2', 'w3'] };
    db.dailyClaims = ['2026-08-04:attendance', '2026-08-04:mission_revive'];
    saveDB(db);

    const reloaded = loadDB();
    expect(reloaded.words).toHaveLength(2);
    expect(reloaded.words[0].en).toBe('ubiquitous');
    expect(reloaded.words[1].ko).toEqual(['이용하다', '위업, 공적']);
    expect(reloaded.decks).toEqual(['토플 Day 3']);
    expect(reloaded.theme).toBe('pink');
    expect(reloaded.dailyMission).toEqual({ date: '2026-08-04', revivedWordIds: ['w1', 'w2', 'w3'] });
    expect(reloaded.dailyClaims).toEqual(['2026-08-04:attendance', '2026-08-04:mission_revive']);
  });
});

describe('dedupeWordsById', () => {
  function word(id: string, updatedAt: number, patch: Partial<Word> = {}): Word {
    return {
      id,
      en: 'exploit',
      ko: ['이용하다'],
      deck: '기본',
      createdAt: updatedAt,
      updatedAt,
      stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
      ...patch,
    };
  }

  it('중복 없으면 같은 배열 참조를 그대로 돌려준다', () => {
    const words = [word('a', 1), word('b', 2)];
    expect(dedupeWordsById(words)).toBe(words);
  });

  it('같은 id가 두 번 있으면 하나로 합치고, updatedAt이 더 최근인 쪽을 남긴다', () => {
    const older = word('a', 1, { deletedAt: 100 });
    const newer = word('a', 2, { deletedAt: undefined });
    const result = dedupeWordsById([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(newer);
  });

  it('순서와 무관하게 항상 최신 것을 남긴다', () => {
    const older = word('a', 1);
    const newer = word('a', 2);
    expect(dedupeWordsById([newer, older])[0]).toBe(newer);
  });
});
