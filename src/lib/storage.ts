import type { DB, QuizSettings, Word } from '../types';

const KEY = 'voca-quiz/v1';

export const DEFAULT_DECK = '기본';

export const DEFAULT_SETTINGS: QuizSettings = {
  decks: [],
  count: 50,
  hintRatio: 0.2,
  seconds: 10,
  strategy: 'weak',
  retypeOnMiss: true,
  requeueWrong: true,
};

function emptyDB(): DB {
  return { version: 1, words: [], settings: { ...DEFAULT_SETTINGS }, history: [] };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function makeWord(en: string, ko: string, deck = DEFAULT_DECK): Word {
  return {
    id: newId(),
    en: en.trim(),
    ko: ko.trim(),
    deck,
    createdAt: Date.now(),
    stats: { seen: 0, correct: 0, wrong: 0, streak: 0 },
  };
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDB();
    const parsed = JSON.parse(raw) as Partial<DB>;
    return {
      version: 1,
      words: Array.isArray(parsed.words) ? parsed.words : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    // 저장 데이터가 깨졌더라도 앱이 못 뜨는 상황은 만들지 않는다.
    return emptyDB();
  }
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
