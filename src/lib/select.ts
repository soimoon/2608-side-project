import type { Strategy, Word } from '../types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * 취약 단어 우선 전략의 가중치.
 * 정답률이 낮을수록, 아직 안 본 단어일수록, 오래 안 본 단어일수록 높다.
 * 연속 정답이 쌓인 단어는 가중치를 낮춰 자연스럽게 덜 나오게 한다.
 */
function weightOf(w: Word, now: number): number {
  const { seen, correct, streak, lastSeenAt } = w.stats;

  if (seen === 0) return 4; // 새 단어를 우선 노출

  const accuracy = correct / seen;
  let weight = 1 + (1 - accuracy) * 4;
  weight *= Math.pow(0.65, Math.min(streak, 5)); // 연속 정답 5회면 약 0.12배

  const days = lastSeenAt ? (now - lastSeenAt) / DAY : 30;
  weight *= 1 + Math.min(days, 14) / 14; // 2주 안 본 단어는 최대 2배

  return Math.max(weight, 0.05);
}

/** 가중치 기반 비복원 추출. */
function weightedSample(words: Word[], n: number, now: number): Word[] {
  const pool = words.map((w) => ({ w, weight: weightOf(w, now) }));
  const picked: Word[] = [];

  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx].w);
    pool.splice(idx, 1);
  }
  return picked;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 이번 퀴즈에 출제할 단어를 고른다.
 * decks가 비어 있으면 전체 단어장을 대상으로 한다.
 */
export function pickWords(
  all: Word[],
  decks: string[],
  count: number,
  strategy: Strategy,
): Word[] {
  const candidates = decks.length ? all.filter((w) => decks.includes(w.deck)) : all;
  const n = Math.min(count, candidates.length);
  if (n === 0) return [];

  switch (strategy) {
    case 'order':
      return candidates.slice(0, n);
    case 'random':
      return shuffle(candidates).slice(0, n);
    case 'weak':
      // 가중 추출로 뽑되, 출제 순서 자체는 섞어 난이도 편향을 없앤다.
      return shuffle(weightedSample(candidates, n, Date.now()));
  }
}

export function deckNames(words: Word[]): string[] {
  return [...new Set(words.map((w) => w.deck))].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 단어에서 드러나는 단어장 + 아직 단어가 없어 존재만 하는 단어장(DB.decks)을 합친다. */
export function allDeckNames(words: Word[], extra: string[]): string[] {
  return [...new Set([...deckNames(words), ...extra])].sort((a, b) => a.localeCompare(b, 'ko'));
}
