import { useMemo } from 'react';
import type { DB, Word } from '../types';
import { deckNames } from '../lib/select';
import type { CloudSync } from '../lib/useCloudSync';
import AuthBar from './AuthBar';

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** 오늘(또는 어제)부터 거꾸로 이어지는 학습일 수. 향후 출석/연속출석 기능의 토대. */
function studyStreak(dates: string[]): number {
  const set = new Set(dates);
  const cursor = new Date();
  if (!set.has(todayKey())) cursor.setDate(cursor.getDate() - 1); // 오늘 아직 안 했으면 어제부터

  let streak = 0;
  for (;;) {
    if (!set.has(cursor.toLocaleDateString('sv-SE'))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

interface Props {
  db: DB;
  /** 소프트 삭제된 단어를 뺀 목록. 통계·단어장 집계는 전부 여기 기준. */
  words: Word[];
  sync: CloudSync;
  onManageWords: () => void;
  onStudy: () => void;
  onStart: () => void;
}

export default function Home({ db, words, sync, onManageWords, onStudy, onStart }: Props) {
  const stats = useMemo(() => {
    const decks = deckNames(words);
    const dates = db.history.map((h) => h.date);
    const today = db.history.filter((h) => h.date === todayKey());
    const todayCount = today.reduce((s, h) => s + h.attempts.filter((a) => !a.requeued).length, 0);

    const learned = words.filter((w) => w.stats.streak >= 3).length;
    const seen = words.filter((w) => w.stats.seen > 0);
    const accuracy = seen.length
      ? Math.round(
          (seen.reduce((s, w) => s + w.stats.correct / w.stats.seen, 0) / seen.length) * 100,
        )
      : 0;

    return { decks, streak: studyStreak(dates), todayCount, learned, accuracy };
  }, [db, words]);

  const empty = words.length === 0;

  return (
    <div className="screen home">
      <AuthBar sync={sync} />
      <header className="hero">
        <h1>
          Voca <span className="accent">Quiz</span>
        </h1>
        <p className="sub">뜻을 보고 제한 시간 안에 영단어를 전부 타이핑하세요.</p>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{words.length}</span>
          <span className="stat-label">등록 단어</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.decks.length}</span>
          <span className="stat-label">단어장</span>
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
      </div>

      {stats.todayCount > 0 && (
        <p className="today-note">
          오늘 <b>{stats.todayCount}문제</b> 풀었습니다. 3회 연속 맞힌 단어 {stats.learned}개.
        </p>
      )}

      {empty ? (
        <div className="empty-cta">
          <p>아직 등록된 단어가 없습니다.</p>
          <p className="muted">
            엑셀에서 단어와 뜻을 복사해 붙여넣으면 자동으로 분류됩니다.
          </p>
          <button className="btn primary lg" onClick={onManageWords}>
            단어 등록하러 가기
          </button>
        </div>
      ) : (
        <div className="home-actions">
          <button className="btn primary lg" onClick={onStart}>
            퀴즈 시작
          </button>
          <button className="btn ghost lg" onClick={onStudy}>
            단어장 보기
          </button>
          <button className="btn ghost lg" onClick={onManageWords}>
            단어장 관리
          </button>
        </div>
      )}
    </div>
  );
}
