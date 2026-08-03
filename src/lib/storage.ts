import type { DB, QuizSettings, Word } from '../types';

const KEY = 'voca-quiz/v2';
/** v2 이전 데이터. 있으면 1회 마이그레이션하고, 원본은 롤백 대비로 남겨 둔다. */
const LEGACY_KEY = 'voca-quiz/v1';

export const DEFAULT_DECK = '기본';

export const DEFAULT_SETTINGS: QuizSettings = {
  decks: [],
  count: 50,
  hintRatio: 0.2,
  seconds: 10,
  strategy: 'weak',
  retypeOnMiss: true,
  requeueWrong: true,
  autoPlayAudio: true,
};

function emptyDB(): DB {
  return {
    version: 2,
    words: [],
    settings: { ...DEFAULT_SETTINGS },
    history: [],
    sync: { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: {},
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function makeWord(en: string, ko: string, deck = DEFAULT_DECK): Word {
  const now = Date.now();
  return {
    id: newId(),
    en: en.trim(),
    ko: ko.trim(),
    deck,
    createdAt: now,
    updatedAt: now,
    stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
  };
}

/** v1(스키마 버전 없이 동기화 필드가 없던 시절) 데이터를 v2 모양으로 채워 넣는다. */
function migrateFromV1(parsed: Record<string, unknown>): DB {
  const rawWords = Array.isArray(parsed.words) ? (parsed.words as Partial<Word>[]) : [];
  const words: Word[] = rawWords
    .filter((w): w is Partial<Word> & { id: string; en: string; ko: string } =>
      Boolean(w && w.id && w.en && w.ko),
    )
    .map((w) => ({
      id: w.id,
      en: w.en,
      ko: w.ko,
      deck: w.deck ?? DEFAULT_DECK,
      createdAt: w.createdAt ?? Date.now(),
      // v1에는 updatedAt이 없었다. createdAt으로 채워야 동기화가 "전부 다 바뀐 행"으로
      // 오해하지 않는다 (그래도 최초 1회 push 때는 전부 올라가는 게 맞으므로 문제는 없다).
      updatedAt: w.updatedAt ?? w.createdAt ?? Date.now(),
      stats: w.stats ?? { seen: 0, correct: 0, wrong: 0, streak: 0 },
    }));

  return {
    version: 2,
    words,
    settings: { ...DEFAULT_SETTINGS, ...((parsed.settings as Partial<QuizSettings>) ?? {}) },
    history: Array.isArray(parsed.history) ? (parsed.history as DB['history']) : [],
    sync: { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: {},
  };
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DB>;
      return {
        version: 2,
        words: Array.isArray(parsed.words) ? parsed.words : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
        sync: parsed.sync ?? { lastPulledAt: 0, lastPushedAt: 0 },
        pronunciations: parsed.pronunciations ?? {},
      };
    }

    // v2 키가 없으면 v1(구버전)이 있는지 확인해 단어를 잃지 않고 옮긴다.
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const migrated = migrateFromV1(JSON.parse(legacyRaw) as Record<string, unknown>);
      saveDB(migrated); // 바로 v2로 저장해, 다음부터는 이 분기를 타지 않는다.
      return migrated;
    }

    return emptyDB();
  } catch {
    // 저장 데이터가 깨졌더라도 앱이 못 뜨는 상황은 만들지 않는다.
    return emptyDB();
  }
}

/** 소프트 삭제된 단어를 뺀 목록. 화면에 보여줄 단어는 항상 이걸 거쳐야 한다. */
export function activeWords(words: Word[]): Word[] {
  return words.filter((w) => !w.deletedAt);
}

export function saveDB(db: DB): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error('단어장 저장 실패 (localStorage 용량 초과일 수 있습니다)', e);
  }
}

/** 백업용 JSON 문자열. localStorage는 브라우저 정리로 날아갈 수 있으므로 내보내기를 권장한다. */
export function exportWordsJSON(words: Word[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2);
}

export function exportCSV(words: Word[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = 'en,ko,deck,seen,correct,wrong';
  const body = words.map((w) =>
    [esc(w.en), esc(w.ko), esc(w.deck), w.stats.seen, w.stats.correct, w.stats.wrong].join(','),
  );
  return [head, ...body].join('\n');
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
