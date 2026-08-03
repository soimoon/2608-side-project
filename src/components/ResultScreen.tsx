import { useMemo } from 'react';
import type { Pronunciation, QuizSettings, SessionResult, Word } from '../types';
import { lookupCache } from '../lib/pronounce';
import PronounceButton from './PronounceButton';

interface Props {
  session: SessionResult;
  allWords: Word[];
  pronunciations: Record<string, Pronunciation>;
  onRetryWrong: (words: Word[], settings: QuizSettings) => void;
  onHome: () => void;
}

export default function ResultScreen({
  session,
  allWords,
  pronunciations,
  onRetryWrong,
  onHome,
}: Props) {
  const { attempts, settings } = session;

  const summary = useMemo(() => {
    // 통계는 첫 시도만 센다. 재출제(복습)는 별도로 표시한다.
    const first = attempts.filter((a) => !a.requeued);
    const correct = first.filter((a) => a.verdict === 'correct');
    const near = first.filter((a) => a.verdict === 'near');
    const timeout = first.filter((a) => a.verdict === 'timeout');
    const missed = first.filter((a) => a.verdict !== 'correct');

    const avgMs = correct.length
      ? Math.round(correct.reduce((s, a) => s + a.elapsedMs, 0) / correct.length)
      : 0;

    const reviewed = attempts.filter((a) => a.requeued);
    const reviewCorrect = reviewed.filter((a) => a.verdict === 'correct').length;

    return {
      total: first.length,
      correct: correct.length,
      near: near.length,
      timeout: timeout.length,
      missed,
      avgMs,
      accuracy: first.length ? Math.round((correct.length / first.length) * 100) : 0,
      reviewed: reviewed.length,
      reviewCorrect,
      durationMin: Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000)),
    };
  }, [attempts, session]);

  const wrongWords = useMemo(() => {
    const ids = new Set(summary.missed.map((a) => a.wordId));
    return allWords.filter((w) => ids.has(w.id));
  }, [summary.missed, allWords]);

  const grade =
    summary.accuracy >= 90 ? 'great' : summary.accuracy >= 70 ? 'good' : 'needs-work';

  return (
    <div className="screen result">
      <header className={`result-hero ${grade}`}>
        <p className="result-label">이번 세션 결과</p>
        <p className="result-score">
          {summary.correct}
          <span className="of">/ {summary.total}</span>
        </p>
        <p className="result-accuracy">{summary.accuracy}%</p>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">
            {(summary.avgMs / 1000).toFixed(1)}
            <small>초</small>
          </span>
          <span className="stat-label">정답 평균 시간</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.near}</span>
          <span className="stat-label">아깝다 (한 글자)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.timeout}</span>
          <span className="stat-label">시간 초과</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {summary.durationMin}
            <small>분</small>
          </span>
          <span className="stat-label">소요 시간</span>
        </div>
      </div>

      {summary.reviewed > 0 && (
        <p className="today-note">
          복습 재출제 {summary.reviewed}문제 중 <b>{summary.reviewCorrect}개</b> 정답.
        </p>
      )}

      {summary.missed.length > 0 && (
        <section className="card">
          <h3>틀린 단어 {summary.missed.length}개</h3>
          <table className="word-table compact">
            <thead>
              <tr>
                <th>영단어</th>
                <th>발음</th>
                <th>뜻</th>
                <th>내 입력</th>
              </tr>
            </thead>
            <tbody>
              {summary.missed.map((a, i) => (
                <tr key={i}>
                  <td className="en">{a.en}</td>
                  <td className="nowrap">
                    <PronounceButton pron={lookupCache(a.en, pronunciations)} size="sm" />
                  </td>
                  <td>{a.ko.join(' / ')}</td>
                  <td className={`muted ${a.verdict}`}>
                    {a.verdict === 'timeout' ? '시간 초과' : a.input.trim() || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="home-actions">
        {wrongWords.length > 0 && (
          <button
            className="btn primary lg"
            onClick={() => onRetryWrong(wrongWords, { ...settings, count: wrongWords.length })}
          >
            틀린 {wrongWords.length}개만 다시 풀기
          </button>
        )}
        <button className="btn ghost lg" onClick={onHome}>
          홈으로
        </button>
      </div>
    </div>
  );
}
