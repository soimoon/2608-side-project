export type TimerStage = 'ok' | 'warn' | 'urgent';

/**
 * 신호등 규칙: 넉넉하면 초록, 절반 아래로 내려가면 노랑, 1/4 아래면 빨강(+깜빡임).
 * 전체 UI는 테마별로 색이 다르지만 타이머는 상태 표시라 통용되는 색 규칙을 그대로 쓴다.
 * QuizScreen·GroupQuizScreen 둘 다 이 값을 타이머 바 밖(.clock 글자색 등)에도 쓰므로
 * 컴포넌트에 숨기지 않고 별도 함수로 내보낸다.
 */
export function timerStageOf(ratio: number): TimerStage {
  return ratio <= 0.25 ? 'urgent' : ratio <= 0.5 ? 'warn' : 'ok';
}

interface Props {
  /** 남은 시간 비율(0~1). 0이면 꽉 참(시간 없음), 1이면 방금 시작. */
  ratio: number;
  /** 힌트가 공개되는 지점(0~1). 단체게임만 50%/75%에 눈금을 표시한다. */
  ticks?: number[];
}

/** QuizScreen·GroupQuizScreen이 똑같이 쓰던 타이머 바 JSX. 그룹만 힌트 눈금(ticks)이
 *  추가로 붙는다는 게 유일한 차이라 그 하나를 옵션 prop으로 흡수했다. */
export default function TimerBar({ ratio, ticks }: Props) {
  const stage = timerStageOf(ratio);
  return (
    <div className="timer-track">
      <div className={`timer-fill ${stage}`} style={{ transform: `scaleX(${ratio})` }} />
      {ticks?.map((t) => (
        <span key={t} className="timer-tick" style={{ left: `${t * 100}%` }} aria-hidden />
      ))}
    </div>
  );
}
