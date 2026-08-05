import { MISSION_TARGET, REVIVAL_STREAK_GOAL } from '../lib/attendance';
import Icon from './Icon';

interface Props {
  wordCount: number;
  /** 지금 오답 부활전에 나올 수 있는 단어 수. 0이면 시작할 게 없다. */
  revivalCount: number;
  /** 오늘 이미 되살린 개수. 프로필의 "오늘의 미션"과 같은 값이다. */
  revivedToday: number;
  onNormal: () => void;
  onRevival: () => void;
}

/** "퀴즈" 탭 진입점. 어떤 방식으로 풀지부터 고르게 한다. */
export default function QuizHub({
  wordCount,
  revivalCount,
  revivedToday,
  onNormal,
  onRevival,
}: Props) {
  const missionDone = revivedToday >= MISSION_TARGET;
  const progress = Math.min(revivedToday / MISSION_TARGET, 1);

  return (
    <div className="screen">
      <header className="hero">
        <h1>퀴즈</h1>
        <p className="sub">
          {wordCount > 0 ? `등록된 단어 ${wordCount}개` : '먼저 단어장에 단어를 등록해 주세요.'}
        </p>
      </header>

      <section className="card">
        <h3>일반 퀴즈</h3>
        <p className="muted">
          단어장·난이도·제한 시간을 골라서 풉니다. 출제 범위에서 취약 단어 우선/무작위/등록
          순서를 선택할 수 있어요.
        </p>
        <button className="btn primary lg" disabled={wordCount === 0} onClick={onNormal}>
          설정하고 시작
        </button>
      </section>

      <section className="card">
        <h3>
          오답 부활전 <Icon name="seedling" className="inline-medal" />
        </h3>
        <p className="muted">
          {revivalCount > 0
            ? `틀렸던 적이 있고 아직 완전히 안 잡힌 단어 ${revivalCount}개를 모아서 풉니다. 최근에 틀린 단어부터 나와요.`
            : '틀렸던 단어를 모아서 푸는 모드입니다. 지금은 되살릴 단어가 없어요 — 일반 퀴즈를 풀다 보면 여기에 쌓입니다.'}
        </p>
        <p className="muted">
          한 단어를 {REVIVAL_STREAK_GOAL}번 연속으로 맞히면 "부활"로 인정돼 이 목록에서 빠지고,
          프로필의 부활 배지에 반영됩니다.
        </p>

        <div className="mission-bar" role="presentation">
          <div className="mission-bar-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="mission-count">
          오늘의 미션 · 되살린 단어 {revivedToday} / {MISSION_TARGET}
          {missionDone ? ' — 달성! 프로필에서 보상을 받으세요' : ''}
        </p>

        <button className="btn primary lg" disabled={revivalCount === 0} onClick={onRevival}>
          {revivalCount > 0 ? `${revivalCount}개 중에서 시작` : '되살릴 단어 없음'}
        </button>
      </section>
    </div>
  );
}
