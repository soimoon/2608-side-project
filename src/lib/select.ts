import type { SessionResult, Strategy, Word } from '../types';
import { REVIVAL_STREAK_GOAL } from './attendance';

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

/**
 * 오답 부활전에 나올 수 있는 단어: 한 번 이상 틀렸고(wrong>0) 아직 목표만큼
 * 연속 정답을 못 채운(streak < REVIVAL_STREAK_GOAL) 단어.
 *
 * 부활 배지의 달성 조건과 정확히 대칭이라, 어떤 단어가 이 풀에서 빠지는 순간
 * 프로필의 "부활시킨 단어" 숫자가 하나 올라간다. Word.stats 기반이므로 세션
 * 기록과 달리 계정에 동기화되고, 기기를 바꿔도 목록이 그대로다.
 */
export function revivalPool(all: Word[], decks: string[]): Word[] {
  const candidates = decks.length ? all.filter((w) => decks.includes(w.deck)) : all;
  return candidates.filter(
    (w) => w.stats.wrong > 0 && w.stats.streak < REVIVAL_STREAK_GOAL,
  );
}

/**
 * wordId → 가장 최근에 틀린 시각(ms). 세션 기록(history)은 계정에 올리지 않아
 * 기기를 바꾸면 비어 있을 수 있다 — 그래서 "우선순위"로만 쓰고, 출제 대상 자체를
 * 여기에 의존시키지는 않는다.
 */
export function lastWrongAt(history: SessionResult[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of history) {
    for (const a of s.attempts) {
      if (a.verdict === 'correct') continue;
      if (s.finishedAt > (map.get(a.wordId) ?? 0)) map.set(a.wordId, s.finishedAt);
    }
  }
  return map;
}

/**
 * 오답 부활전 출제 단어. 최근에 틀린 단어를 먼저 채우고(가장 최근 학습일의
 * 오답이 자연스럽게 앞에 온다), 세션 기록이 없으면 아직 덜 잡힌 단어부터 채운다.
 * 고른 뒤 순서는 섞어 난이도 편향을 없앤다.
 */
export function pickRevivalWords(
  all: Word[],
  decks: string[],
  count: number,
  history: SessionResult[],
): Word[] {
  const pool = revivalPool(all, decks);
  if (pool.length === 0) return [];

  const wrongAt = lastWrongAt(history);
  const sorted = pool.slice().sort((a, b) => {
    const recency = (wrongAt.get(b.id) ?? 0) - (wrongAt.get(a.id) ?? 0);
    if (recency !== 0) return recency;
    // 기기를 바꿔 기록이 없을 때의 대체 기준: 부활까지 멀수록, 많이 틀렸을수록 먼저.
    if (a.stats.streak !== b.stats.streak) return a.stats.streak - b.stats.streak;
    return b.stats.wrong - a.stats.wrong;
  });

  return shuffle(sorted.slice(0, Math.min(count, sorted.length)));
}

export function deckNames(words: Word[]): string[] {
  return [...new Set(words.map((w) => w.deck))].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 단어에서 드러나는 단어장 + 아직 단어가 없어 존재만 하는 단어장(DB.decks)을 합친다. */
export function allDeckNames(words: Word[], extra: string[]): string[] {
  return [...new Set([...deckNames(words), ...extra])].sort((a, b) => a.localeCompare(b, 'ko'));
}
