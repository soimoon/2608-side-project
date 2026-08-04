import { THEMES, type DB, type QuizSettings, type Theme, type Word } from '../types';

const KEY = 'voca-quiz/v6';
/** v6 이전 데이터. 있으면 1회 마이그레이션하고, 원본은 롤백 대비로 남겨 둔다. */
const LEGACY_V5_KEY = 'voca-quiz/v5';
const LEGACY_V4_KEY = 'voca-quiz/v4';
const LEGACY_V3_KEY = 'voca-quiz/v3';
const LEGACY_V2_KEY = 'voca-quiz/v2';
const LEGACY_V1_KEY = 'voca-quiz/v1';

export const DEFAULT_DECK = '기본';
export const DEFAULT_THEME: Theme = 'blue';

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

function defaultDailyMission(): DB['dailyMission'] {
  return { date: '', revived: 0 };
}

/** 알 수 없는 값(구버전 데이터, 미래 버전이 내려보낸 값 등)이면 기본 테마로. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

function emptyDB(): DB {
  return {
    version: 6,
    words: [],
    settings: { ...DEFAULT_SETTINGS },
    history: [],
    sync: { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: {},
    decks: [],
    theme: DEFAULT_THEME,
    dailyMission: defaultDailyMission(),
    dailyClaims: [],
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** v1·v2 시절엔 ko가 문자열 하나였다. 그걸 원소 1개짜리 배열로, 혹시 모를 이상값도 안전하게 정리한다. */
function toKoArray(ko: unknown): string[] {
  if (Array.isArray(ko)) {
    return ko.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
  }
  if (typeof ko === 'string' && ko.trim() !== '') return [ko.trim()];
  return [];
}

export function makeWord(en: string, ko: string[], deck = DEFAULT_DECK): Word {
  const now = Date.now();
  return {
    id: newId(),
    en: en.trim(),
    ko: ko.map((k) => k.trim()).filter(Boolean),
    deck,
    createdAt: now,
    updatedAt: now,
    stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
  };
}

function normalizeLegacyWord(w: Record<string, unknown>): Word | null {
  const ko = toKoArray(w.ko);
  const id = w.id;
  const en = w.en;
  if (typeof id !== 'string' || typeof en !== 'string' || !en.trim() || ko.length === 0) return null;

  const createdAt = typeof w.createdAt === 'number' ? w.createdAt : Date.now();
  return {
    id,
    en,
    ko,
    deck: typeof w.deck === 'string' ? w.deck : DEFAULT_DECK,
    createdAt,
    // v1엔 updatedAt이 아예 없었다. createdAt으로 채워야 동기화가 "전부 다 바뀐 행"으로
    // 오해하지 않는다(그래도 최초 1회 push 때는 전부 올라가는 게 맞으므로 문제는 없다).
    updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : createdAt,
    deletedAt: typeof w.deletedAt === 'number' ? w.deletedAt : undefined,
    stats: (w.stats as Word['stats']) ?? { seen: 0, correct: 0, wrong: 0, streak: 0 },
  };
}

/** v1·v2(ko가 문자열이던 시절) 데이터를 v6 모양으로 채워 넣는다. 두 버전 모두 구조가 같아 하나로 처리한다. */
function migrateLegacy(parsed: Record<string, unknown>): DB {
  const rawWords = Array.isArray(parsed.words) ? (parsed.words as Record<string, unknown>[]) : [];
  const words = rawWords.map(normalizeLegacyWord).filter((w): w is Word => w !== null);

  return {
    version: 6,
    words,
    settings: { ...DEFAULT_SETTINGS, ...((parsed.settings as Partial<QuizSettings>) ?? {}) },
    history: Array.isArray(parsed.history) ? (parsed.history as DB['history']) : [],
    sync: { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: {},
    decks: [],
    theme: DEFAULT_THEME,
    dailyMission: defaultDailyMission(),
    dailyClaims: [],
  };
}

/** v3(ko는 이미 배열, decks·theme만 없던 시절) → v6. */
function migrateV3(parsed: Record<string, unknown>): DB {
  return {
    version: 6,
    words: Array.isArray(parsed.words)
      ? (parsed.words as Word[]).map((w) => ({ ...w, ko: toKoArray(w.ko) }))
      : [],
    settings: { ...DEFAULT_SETTINGS, ...((parsed.settings as Partial<QuizSettings>) ?? {}) },
    history: Array.isArray(parsed.history) ? (parsed.history as DB['history']) : [],
    sync: (parsed.sync as DB['sync']) ?? { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: (parsed.pronunciations as DB['pronunciations']) ?? {},
    decks: [],
    theme: DEFAULT_THEME,
    dailyMission: defaultDailyMission(),
    dailyClaims: [],
  };
}

/** v4(decks까지는 있고 theme만 없던 시절) → v6. */
function migrateV4(parsed: Record<string, unknown>): DB {
  return {
    version: 6,
    words: Array.isArray(parsed.words)
      ? (parsed.words as Word[]).map((w) => ({ ...w, ko: toKoArray(w.ko) }))
      : [],
    settings: { ...DEFAULT_SETTINGS, ...((parsed.settings as Partial<QuizSettings>) ?? {}) },
    history: Array.isArray(parsed.history) ? (parsed.history as DB['history']) : [],
    sync: (parsed.sync as DB['sync']) ?? { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: (parsed.pronunciations as DB['pronunciations']) ?? {},
    decks: Array.isArray(parsed.decks) ? (parsed.decks as string[]) : [],
    theme: DEFAULT_THEME,
    dailyMission: defaultDailyMission(),
    dailyClaims: [],
  };
}

/** v5(theme까지는 있고 출석/미션만 없던 시절) → v6. */
function migrateV5(parsed: Record<string, unknown>): DB {
  return {
    version: 6,
    words: Array.isArray(parsed.words)
      ? (parsed.words as Word[]).map((w) => ({ ...w, ko: toKoArray(w.ko) }))
      : [],
    settings: { ...DEFAULT_SETTINGS, ...((parsed.settings as Partial<QuizSettings>) ?? {}) },
    history: Array.isArray(parsed.history) ? (parsed.history as DB['history']) : [],
    sync: (parsed.sync as DB['sync']) ?? { lastPulledAt: 0, lastPushedAt: 0 },
    pronunciations: (parsed.pronunciations as DB['pronunciations']) ?? {},
    decks: Array.isArray(parsed.decks) ? (parsed.decks as string[]) : [],
    theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_THEME,
    dailyMission: defaultDailyMission(),
    dailyClaims: [],
  };
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DB>;
      return {
        version: 6,
        // 방어적으로 한 번 더 배열화한다 — 수동으로 손댄 localStorage 등 이상값 대비.
        words: Array.isArray(parsed.words)
          ? parsed.words.map((w) => ({ ...w, ko: toKoArray(w.ko) }))
          : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
        sync: parsed.sync ?? { lastPulledAt: 0, lastPushedAt: 0 },
        pronunciations: parsed.pronunciations ?? {},
        decks: Array.isArray(parsed.decks) ? parsed.decks : [],
        theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_THEME,
        dailyMission:
          parsed.dailyMission && typeof parsed.dailyMission.date === 'string'
            ? parsed.dailyMission
            : defaultDailyMission(),
        dailyClaims: Array.isArray(parsed.dailyClaims) ? parsed.dailyClaims : [],
      };
    }

    // v6 키가 없으면 구버전이 있는지 순서대로 확인해 단어를 잃지 않고 옮긴다.
    const v5Raw = localStorage.getItem(LEGACY_V5_KEY);
    if (v5Raw) {
      const migrated = migrateV5(JSON.parse(v5Raw) as Record<string, unknown>);
      saveDB(migrated);
      return migrated;
    }
    const v4Raw = localStorage.getItem(LEGACY_V4_KEY);
    if (v4Raw) {
      const migrated = migrateV4(JSON.parse(v4Raw) as Record<string, unknown>);
      saveDB(migrated);
      return migrated;
    }
    const v3Raw = localStorage.getItem(LEGACY_V3_KEY);
    if (v3Raw) {
      const migrated = migrateV3(JSON.parse(v3Raw) as Record<string, unknown>);
      saveDB(migrated);
      return migrated;
    }
    for (const legacyKey of [LEGACY_V2_KEY, LEGACY_V1_KEY]) {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) {
        const migrated = migrateLegacy(JSON.parse(legacyRaw) as Record<string, unknown>);
        saveDB(migrated); // 바로 v6로 저장해, 다음부터는 이 분기를 타지 않는다.
        return migrated;
      }
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
    [esc(w.en), esc(w.ko.join(' / ')), esc(w.deck), w.stats.seen, w.stats.correct, w.stats.wrong].join(
      ',',
    ),
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
