import { beforeEach, describe, expect, it } from 'vitest';
import { loadDB, saveDB } from './storage';

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

describe('loadDB (v1 → v3 마이그레이션)', () => {
  it('v3 데이터가 없고 v1만 있으면 단어를 잃지 않고 옮긴다 (ko는 배열로)', () => {
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

    expect(db.version).toBe(3);
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

    // 마이그레이션 직후 v3로 즉시 저장돼, 다음 로드부터는 이 분기를 타지 않는다.
    expect(localStorage.getItem('voca-quiz/v3')).not.toBeNull();
  });

  it('v3 데이터가 없고 v2만 있어도(ko가 문자열이던 시절) 옮긴다', () => {
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
    expect(db.version).toBe(3);
    expect(db.words[0].ko).toEqual(['극심한']);
  });

  it('v3 데이터가 이미 있으면 구버전은 무시한다', () => {
    localStorage.setItem(
      'voca-quiz/v1',
      JSON.stringify({ version: 1, words: [{ id: 'old', en: 'old', ko: '옛날', stats: {} }] }),
    );
    const v3db = {
      version: 3,
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
    };
    localStorage.setItem('voca-quiz/v3', JSON.stringify(v3db));

    const db = loadDB();
    expect(db.words).toHaveLength(1);
    expect(db.words[0].en).toBe('acute');
  });

  it('아무 데이터도 없으면 빈 DB를 만든다', () => {
    const db = loadDB();
    expect(db.words).toEqual([]);
    expect(db.version).toBe(3);
  });

  it('깨진 JSON이 있어도 앱이 죽지 않고 빈 DB로 시작한다', () => {
    localStorage.setItem('voca-quiz/v3', '{ this is not json');
    const db = loadDB();
    expect(db.words).toEqual([]);
  });

  it('saveDB로 저장한 뒤 loadDB로 그대로 복원된다 (라운드트립, 뜻 여러 개 포함)', () => {
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
    saveDB(db);

    const reloaded = loadDB();
    expect(reloaded.words).toHaveLength(2);
    expect(reloaded.words[0].en).toBe('ubiquitous');
    expect(reloaded.words[1].ko).toEqual(['이용하다', '위업, 공적']);
  });
});
