import { describe, expect, it } from 'vitest';
import {
  attendanceStreak,
  claimKey,
  currentTier,
  hasClaimed,
  kstDateKey,
  revivedWordCount,
  todayAddedWordCount,
  todayBestAccuracy,
  todaySolvedCount,
  totalCorrect,
} from './attendance';
import type { Attempt, SessionResult, Word } from '../types';

function word(over: Partial<Word['stats']>): Word {
  return {
    id: 'w',
    en: 'w',
    ko: ['뜻'],
    deck: '기본',
    createdAt: 0,
    updatedAt: 0,
    stats: { seen: 0, correct: 0, wrong: 0, streak: 0, ...over },
  };
}

/** todayAddedWordCount 전용 — 위 word()는 stats만 오버라이드하므로 createdAt이 필요한
 *  이 블록에서만 별도로 둔다. */
function wordAt(createdAt: number): Word {
  return { ...word({}), createdAt };
}

function attempt(over: Partial<Attempt>): Attempt {
  return {
    wordId: 'w',
    en: 'w',
    ko: ['뜻'],
    input: 'w',
    verdict: 'correct',
    elapsedMs: 1000,
    requeued: false,
    ...over,
  };
}

function session(finishedAt: number, attempts: Attempt[]): SessionResult {
  return {
    id: 's',
    date: '2026-01-01',
    startedAt: finishedAt - 1000,
    finishedAt,
    settings: {
      decks: [],
      count: 10,
      hintRatio: 0.2,
      seconds: 10,
      strategy: 'weak',
      retypeOnMiss: true,
      requeueWrong: true,
      autoPlayAudio: true,
    },
    attempts,
  };
}

describe('kstDateKey', () => {
  it('UTC 자정 근처에서도 한국 날짜(UTC+9)로 계산한다', () => {
    // 2026-01-01 15:00 UTC = 2026-01-02 00:00 KST
    const utc15 = Date.UTC(2026, 0, 1, 15, 0, 0);
    expect(kstDateKey(utc15)).toBe('2026-01-02');

    // 2026-01-01 14:59 UTC = 2026-01-01 23:59 KST — 아직 하루 안 넘어감.
    const utc1459 = Date.UTC(2026, 0, 1, 14, 59, 0);
    expect(kstDateKey(utc1459)).toBe('2026-01-01');
  });

  it('기기 타임존과 무관하다 (UTC ms 값만 본다)', () => {
    // 같은 순간이면 어떤 로컬 타임존에서 실행되든 같은 값이어야 한다.
    const ms = Date.UTC(2026, 5, 15, 3, 0, 0);
    expect(kstDateKey(ms)).toBe(kstDateKey(ms));
  });
});

describe('claimKey / hasClaimed', () => {
  it('날짜와 kind를 합쳐 키를 만들고, 그 키가 있는지 확인한다', () => {
    const key = claimKey('2026-08-04', 'attendance');
    expect(key).toBe('2026-08-04:attendance');
    expect(hasClaimed([key], '2026-08-04', 'attendance')).toBe(true);
    expect(hasClaimed([key], '2026-08-04', 'mission_revive')).toBe(false);
    expect(hasClaimed([key], '2026-08-05', 'attendance')).toBe(false);
  });
});

describe('attendanceStreak', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('오늘 이미 출석했으면 오늘부터 거꾸로 센다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0); // KST 2026-08-04 낮
    const claims = [
      claimKey(kstDateKey(now), 'attendance'),
      claimKey(kstDateKey(now - DAY), 'attendance'),
      claimKey(kstDateKey(now - 2 * DAY), 'attendance'),
    ];
    expect(attendanceStreak(claims, 'attendance', now)).toBe(3);
  });

  it('오늘 아직 출석 안 했으면 어제부터 센다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const claims = [
      claimKey(kstDateKey(now - DAY), 'attendance'),
      claimKey(kstDateKey(now - 2 * DAY), 'attendance'),
    ];
    expect(attendanceStreak(claims, 'attendance', now)).toBe(2);
  });

  it('중간에 하루라도 비면 거기서 끊긴다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const claims = [
      claimKey(kstDateKey(now), 'attendance'),
      claimKey(kstDateKey(now - 2 * DAY), 'attendance'), // 어제 없음
    ];
    expect(attendanceStreak(claims, 'attendance', now)).toBe(1);
  });

  it('다른 kind의 claim은 무시한다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const claims = [claimKey(kstDateKey(now), 'mission_revive')];
    expect(attendanceStreak(claims, 'attendance', now)).toBe(0);
  });

  it('출석 기록이 전혀 없으면 0', () => {
    expect(attendanceStreak([], 'attendance', Date.now())).toBe(0);
  });
});

describe('revivedWordCount', () => {
  it('한 번이라도 틀렸다가(wrong>0) 5연속 정답을 쌓은 단어만 센다', () => {
    const words = [
      word({ wrong: 1, streak: 5 }), // 부활
      word({ wrong: 2, streak: 7 }), // 부활
      word({ wrong: 0, streak: 5 }), // 한 번도 안 틀림 — 제외
      word({ wrong: 1, streak: 3 }), // 아직 5 미만 — 제외
    ];
    expect(revivedWordCount(words)).toBe(2);
  });

  it('단어가 없으면 0', () => {
    expect(revivedWordCount([])).toBe(0);
  });
});

describe('totalCorrect', () => {
  it('전체 단어의 correct를 합산한다', () => {
    const words = [word({ correct: 3 }), word({ correct: 5 }), word({ correct: 0 })];
    expect(totalCorrect(words)).toBe(8);
  });
});

describe('todaySolvedCount', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('오늘(KST) 끝난 세션의 시도 수를 합산한다(재출제 포함)', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const sessions = [
      session(now, [attempt({}), attempt({ requeued: true })]),
      session(now - DAY, [attempt({}), attempt({}), attempt({})]), // 어제 — 제외
    ];
    expect(todaySolvedCount(sessions, now)).toBe(2);
  });

  it('KST 자정 경계를 넘긴 세션은 오늘 걸로 잡힌다', () => {
    // 2026-01-01 15:00 UTC = 2026-01-02 00:00 KST
    const finishedAt = Date.UTC(2026, 0, 1, 15, 0, 0);
    const now = finishedAt; // 같은 순간을 "지금"으로
    const sessions = [session(finishedAt, [attempt({})])];
    expect(todaySolvedCount(sessions, now)).toBe(1);
  });

  it('오늘 끝난 세션이 없으면 0', () => {
    expect(todaySolvedCount([], Date.now())).toBe(0);
  });
});

describe('todayAddedWordCount', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('오늘(KST) 등록한 단어만 센다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const words = [wordAt(now), wordAt(now - 1000), wordAt(now - DAY)];
    expect(todayAddedWordCount(words, now)).toBe(2);
  });

  it('단어가 없으면 0', () => {
    expect(todayAddedWordCount([], Date.now())).toBe(0);
  });
});

describe('todayBestAccuracy', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('오늘 세션 중 가장 높은 정답률을 백분율로 돌려준다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const sessions = [
      session(now, [attempt({ verdict: 'correct' }), attempt({ verdict: 'wrong' })]), // 50%
      session(now, [attempt({ verdict: 'correct' }), attempt({ verdict: 'correct' })]), // 100%
      session(now - DAY, [attempt({ verdict: 'correct' })]), // 어제 — 제외
    ];
    expect(todayBestAccuracy(sessions, now)).toBe(100);
  });

  it('재출제 시도는 정답률 계산에서 뺀다', () => {
    const now = Date.UTC(2026, 7, 4, 3, 0, 0);
    const sessions = [
      session(now, [
        attempt({ verdict: 'wrong', requeued: false }),
        // 재출제를 그대로 셌다면 정답률이 50%로 나왔을 것 — 빠져야 0%.
        attempt({ verdict: 'correct', requeued: true }),
      ]),
    ];
    expect(todayBestAccuracy(sessions, now)).toBe(0);
  });

  it('오늘 세션이 없으면 0', () => {
    expect(todayBestAccuracy([], Date.now())).toBe(0);
  });
});

describe('currentTier', () => {
  const tiers = [7, 30, 100] as const;

  it('아직 첫 티어 미달이면 tier 0, next는 첫 티어', () => {
    expect(currentTier(3, tiers)).toEqual({ tier: 0, next: 7, remaining: 4 });
  });

  it('중간 티어에 정확히 도달하면 그 값이 tier', () => {
    expect(currentTier(30, tiers)).toEqual({ tier: 30, next: 100, remaining: 70 });
  });

  it('티어 사이 값이면 도달한 가장 높은 티어를 쓴다', () => {
    expect(currentTier(50, tiers)).toEqual({ tier: 30, next: 100, remaining: 50 });
  });

  it('마지막 티어를 넘으면 next는 null', () => {
    expect(currentTier(150, tiers)).toEqual({ tier: 100, next: null, remaining: 0 });
  });
});
