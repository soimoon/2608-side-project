import { useMemo, useState } from 'react';
import type { ClaimKind, SessionResult, Theme, Word } from '../types';
import {
  BADGES,
  MISSION_TARGET,
  attendanceStreak,
  currentTier,
  hasClaimed,
  kstDateKey,
  revivedWordCount,
  totalCorrect,
} from '../lib/attendance';
import type { CloudSync } from '../lib/useCloudSync';
import { useNickname } from '../lib/useNickname';
import SettingsModal from './SettingsModal';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 이번 달(KST 기준) 날짜 칸을 만든다. 기기 타임존과 무관하게 항상 같은 달력을 보여준다. */
function buildMonthGrid(nowMs: number): { weekday: number; dateKey: string; day: number }[] {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return {
      weekday: (firstWeekday + i) % 7,
      dateKey: `${year}-${pad2(month + 1)}-${pad2(day)}`,
      day,
    };
  });
}

interface Props {
  words: Word[];
  history: SessionResult[];
  sync: CloudSync;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  dailyMission: { date: string; revivedWordIds: string[] };
  dailyClaims: string[];
  onClaim: (kind: ClaimKind) => void;
  onGoWords: () => void;
}

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** 오늘(또는 어제)부터 거꾸로 이어지는 학습일 수 — 실제로 퀴즈를 푼 날 기준(기기 로컬 날짜). */
function studyStreak(dates: string[]): number {
  const set = new Set(dates);
  const cursor = new Date();
  if (!set.has(todayKey())) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  for (;;) {
    if (!set.has(cursor.toLocaleDateString('sv-SE'))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export default function ProfileScreen({
  words,
  history,
  sync,
  theme,
  onThemeChange,
  dailyMission,
  dailyClaims,
  onClaim,
  onGoWords,
}: Props) {
  const now = Date.now();
  const today = kstDateKey(now);

  const stats = useMemo(() => {
    const dates = history.map((h) => h.date);
    const learned = words.filter((w) => w.stats.streak >= 3).length;
    const seen = words.filter((w) => w.stats.seen > 0);
    const accuracy = seen.length
      ? Math.round((seen.reduce((s, w) => s + w.stats.correct / w.stats.seen, 0) / seen.length) * 100)
      : 0;
    return { streak: studyStreak(dates), learned, accuracy };
  }, [history, words]);

  // 퀴즈를 오늘(KST) 하나라도 끝냈는지 — 출석 버튼 활성화 조건.
  const finishedQuizToday = useMemo(
    () => history.some((h) => kstDateKey(h.finishedAt) === today),
    [history, today],
  );
  const attendedToday = hasClaimed(dailyClaims, today, 'attendance');
  const attendStreak = attendanceStreak(dailyClaims, 'attendance', now);

  const missionProgress = dailyMission.date === today ? dailyMission.revivedWordIds.length : 0;
  const missionDone = missionProgress >= MISSION_TARGET;
  const missionClaimed = hasClaimed(dailyClaims, today, 'mission_revive');

  const monthGrid = useMemo(() => buildMonthGrid(now), [now]);
  const monthLabel = useMemo(() => {
    const kst = new Date(now + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월`;
  }, [now]);

  const badgeValues: Record<keyof typeof BADGES, number> = {
    attendance: attendStreak,
    revival: revivedWordCount(words),
    volume: totalCorrect(words),
  };

  const { displayName: nickname, nicknameSet, save: saveNickname } = useNickname(sync.session?.user.id);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  function startEditNickname() {
    setNicknameInput(nickname ?? '');
    setNicknameError('');
    setEditingNickname(true);
  }

  async function submitNickname() {
    const res = await saveNickname(nicknameInput);
    if (!res.ok) {
      setNicknameError(res.error ?? '저장하지 못했습니다.');
      return;
    }
    setEditingNickname(false);
  }

  return (
    <div className="screen">
      <div className="topline">
        <span />
        <button
          className="btn ghost sm settings-trigger"
          aria-label="설정"
          onClick={() => setShowSettings(true)}
        >
          ☰
        </button>
      </div>

      {showSettings && (
        <SettingsModal
          sync={sync}
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {sync.session && (
        <div className="row nickname-row">
          <span className="muted">닉네임</span>
          {editingNickname ? (
            <>
              <input
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                maxLength={10}
                autoFocus
              />
              <button className="btn primary sm" onClick={submitNickname}>
                저장
              </button>
              <button className="btn ghost sm" onClick={() => setEditingNickname(false)}>
                취소
              </button>
            </>
          ) : (
            <>
              <b>{nicknameSet ? nickname : '미설정'}</b>
              <button className="btn ghost sm" onClick={startEditNickname}>
                {nicknameSet ? '변경' : '설정'}
              </button>
            </>
          )}
        </div>
      )}
      {nicknameError && (
        <p className="notice-bar" role="status">
          {nicknameError}
        </p>
      )}

      <header className="hero">
        <h1>{nicknameSet && nickname ? `${nickname}님` : '프로필'}</h1>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{words.length}</span>
          <span className="stat-label">등록 단어</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {stats.streak}
            <small>일</small>
          </span>
          <span className="stat-label">연속 학습</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {stats.accuracy}
            <small>%</small>
          </span>
          <span className="stat-label">평균 정답률</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {badgeValues.revival}
            <small>개</small>
          </span>
          <span className="stat-label">부활시킨 단어</span>
        </div>
      </div>

      {words.length === 0 && (
        <div className="empty-cta">
          <p>아직 등록된 단어가 없습니다.</p>
          <button className="btn primary lg" onClick={onGoWords}>
            단어장으로 가기
          </button>
        </div>
      )}

      <section className="card">
        <h3>출석 {monthLabel}</h3>
        <div className="calendar-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
            <span key={d} className="calendar-weekday muted">
              {d}
            </span>
          ))}
          {monthGrid[0] &&
            Array.from({ length: monthGrid[0].weekday }, (_, i) => <span key={`pad-${i}`} />)}
          {monthGrid.map((cell) => {
            const claimed = hasClaimed(dailyClaims, cell.dateKey, 'attendance');
            const isToday = cell.dateKey === today;
            return (
              <span
                key={cell.dateKey}
                className={`calendar-day ${claimed ? 'claimed' : ''} ${isToday ? 'today' : ''}`}
              >
                {cell.day}
              </span>
            );
          })}
        </div>

        {attendedToday ? (
          <p className="today-note">오늘 출석 완료 · 연속 {attendStreak}일</p>
        ) : finishedQuizToday ? (
          <button className="btn primary" onClick={() => onClaim('attendance')}>
            출석하기
          </button>
        ) : (
          <p className="muted">퀴즈를 하나 끝내면 오늘 출석할 수 있습니다.</p>
        )}
      </section>

      <section className="card">
        <h3>오늘의 미션 — 오답 부활전</h3>
        <p className="muted">예전에 틀렸던 단어를 오늘 다시 맞혀 보세요.</p>
        <div className="mission-bar">
          <div
            className="mission-bar-fill"
            style={{ transform: `scaleX(${Math.min(1, missionProgress / MISSION_TARGET)})` }}
          />
        </div>
        <p className="mission-count">
          {Math.min(missionProgress, MISSION_TARGET)} / {MISSION_TARGET}
        </p>
        {missionDone && !missionClaimed && (
          <button className="btn primary" onClick={() => onClaim('mission_revive')}>
            보상 받기
          </button>
        )}
        {missionClaimed && <p className="today-note">오늘 미션 완료</p>}
      </section>

      <section className="card">
        <h3>배지</h3>
        <div className="badge-grid">
          {Object.values(BADGES).map((b) => {
            const value = badgeValues[b.key as keyof typeof BADGES];
            const { tier, next, remaining } = currentTier(value, b.tiers);
            return (
              <div key={b.key} className={`badge ${tier > 0 ? 'earned' : ''}`}>
                <span className="badge-icon" aria-hidden>
                  {b.icon}
                </span>
                <span className="badge-label">{b.label}</span>
                <span className="badge-tier">{tier > 0 ? `${tier} 달성` : '미달성'}</span>
                {next !== null && <span className="muted badge-next">다음 티어까지 {remaining}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
