import { useEffect, useMemo, useRef, useState } from 'react';
import type { Verdict } from '../../types';
import type { CloudSync } from '../../lib/useCloudSync';
import { useGroupGame } from '../../lib/useGroupGame';
import { useLockstep } from '../../lib/useLockstep';
import type { Schedule } from '../../lib/lockstep';
import { judge } from '../../lib/judge';
import { hintStageAt, progressiveMask } from '../../lib/groupMask';
import { correctScore, fastestCorrectUserId, rankPlayers } from '../../lib/groupScore';
import { leaveRoom } from '../../lib/groupApi';
import Icon from '../Icon';

interface Props {
  roomId: string;
  sync: CloudSync;
  onEnded: (roomId: string, gameNo: number) => void;
  /** 진짜로 방을 나간 뒤(leave_room) 호출된다 — 방 목록으로 돌려보내야 한다.
   *  로비 화면으로만 돌려보내면 room.status가 여전히 'playing'이라 그 화면이
   *  바로 다시 게임 화면으로 튕겨 보낸다(실제로 있었던 버그). */
  onLeft: () => void;
}

const REACTION_EMOJIS = ['👍', '😂', '😮', '😢', '🔥'];

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: '정답!',
  near: '아깝다!',
  wrong: '오답',
  timeout: '시간 초과',
};

/**
 * 단체게임 실제 플레이 화면. QuizScreen.tsx는 한 글자도 건드리지 않는다 — 솔로 퀴즈는
 * 사용자 행동으로 전진하고(retype·requeue 등) 이 화면은 락스텝 스케줄(시계)로 강제
 * 전진한다. 제어 흐름이 근본적으로 다르므로 별도 컴포넌트로 뒀다(계획 문서 참고).
 * 마스크 슬롯·타이머 바 JSX만 QuizScreen과 같은 CSS 클래스를 그대로 재사용한다.
 */
export default function GroupQuizScreen({ roomId, sync, onEnded, onLeft }: Props) {
  const userId = sync.session?.user.id;
  const { room, players, answers, reactions, loading, submit, finish, sendReaction } = useGroupGame(roomId, userId);

  const schedule: Schedule = useMemo(
    () => ({
      startedAt: room?.startedAt ?? null,
      leadInMs: room?.leadInMs ?? 3000,
      answerMs: room?.answerMs ?? 12000,
      revealMs: room?.revealMs ?? 4000,
      roundCount: room?.words?.length ?? 0,
    }),
    [room?.startedAt, room?.leadInMs, room?.answerMs, room?.revealMs, room?.words?.length],
  );
  const { phase } = useLockstep(schedule);

  const [input, setInput] = useState('');
  const [submittedRounds, setSubmittedRounds] = useState<Set<number>>(new Set());
  // pendingRef는 동기 가드다 — submittedRounds(상태)는 리렌더를 기다려야 해서, 그 사이
  // 100ms 틱이 여러 번 더 지나가도 doSubmit이 중복 호출되지 않게 막는다.
  const pendingRef = useRef<Set<number>>(new Set());
  const lastRoundRef = useRef(-1);
  const endedRef = useRef(false);

  const activeIndex =
    phase.kind === 'answer' || phase.kind === 'reveal' ? phase.index : null;
  const word = activeIndex !== null ? (room?.words?.[activeIndex] ?? null) : null;

  // 라운드가 바뀌면 입력창을 비운다.
  useEffect(() => {
    if (phase.kind === 'answer' && phase.index !== lastRoundRef.current) {
      lastRoundRef.current = phase.index;
      setInput('');
    }
  }, [phase]);

  async function doSubmit(idx: number, value: string, verdict: Verdict) {
    if (pendingRef.current.has(idx)) return;
    pendingRef.current.add(idx);
    await submit(idx, value, verdict);
    setSubmittedRounds((prev) => new Set(prev).add(idx));
  }

  // 답을 안 낸 채로 reveal에 들어가면 시간 초과로 자동 제출한다.
  const revealIndex = phase.kind === 'reveal' ? phase.index : null;
  useEffect(() => {
    if (revealIndex === null) return;
    if (submittedRounds.has(revealIndex) || pendingRef.current.has(revealIndex)) return;
    void doSubmit(revealIndex, input, 'timeout');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIndex]);

  // 게임이 끝나면(스케줄상 종료) 한 번만 finish_game을 부르고 결과 화면으로 넘어간다.
  useEffect(() => {
    if (phase.kind !== 'ended' || !room || endedRef.current) return;
    endedRef.current = true;
    void finish().then(() => onEnded(roomId, room.gameNo));
  }, [phase.kind, room, finish, onEnded, roomId]);

  // 다른 사람이 다 나가도(또는 접속이 끊겨도) 혼자 조기 종료하지 않는다 — 끝까지
  // 스케줄대로 풀고, 나간 사람은 결과 화면에서 "플레이어N"으로 표시된 채 그때까지의
  // 점수로 순위에 들어간다(GroupResultScreen 참고). 방을 나가는 사람 자신은
  // leave_room이 처리한다(전원이 나가면 방 자체가 삭제됨 — schema.sql leave_room).

  async function handleLeave() {
    await leaveRoom(roomId);
    onLeft();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    if (phase.kind !== 'answer' || !word) return;
    if (submittedRounds.has(phase.index) || !input.trim()) return;
    const verdict = judge(input, word.en);
    const typed = input;
    setInput('');
    void doSubmit(phase.index, typed, verdict);
  }

  if (loading || !room || phase.kind === 'not-started') {
    return (
      <div className="screen">
        <p className="muted">시작하는 중…</p>
      </div>
    );
  }

  if (phase.kind === 'ended') {
    return (
      <div className="screen">
        <p className="muted">결과 정리 중…</p>
      </div>
    );
  }

  const answerMs = room.answerMs ?? 12000;
  const standings = rankPlayers(
    answers.map((a) => ({ userId: a.userId, roundIndex: a.roundIndex, verdict: a.verdict, elapsedMs: a.elapsedMs, points: a.points })),
    players.map((p) => p.userId),
  );
  const nameOf = (id: string) => players.find((p) => p.userId === id)?.displayName ?? '???';

  if (phase.kind === 'lead-in') {
    return (
      <div className="screen quiz">
        <div className="quiz-body" style={{ textAlign: 'center' }}>
          <p className="meaning">곧 시작합니다</p>
          <p className="mask" style={{ justifyContent: 'center', fontSize: '2rem' }}>
            {Math.ceil(phase.msLeft / 1000)}
          </p>
          <p className="muted">참가자 {players.length}명 · 문제 {room.words?.length ?? 0}개</p>
        </div>
      </div>
    );
  }

  if (phase.kind === 'reveal') {
    const roundIndex = phase.index;
    const roundAnswers = answers.filter((a) => a.roundIndex === roundIndex);
    const fastestId = fastestCorrectUserId(
      answers.map((a) => ({ userId: a.userId, roundIndex: a.roundIndex, verdict: a.verdict, elapsedMs: a.elapsedMs, points: a.points })),
      roundIndex,
    );
    // 리액션은 유저당 최신 것 하나만 보여준다 — 여러 번 눌러도 이름 옆에 하나만 뜬다.
    const latestReaction = new Map<string, string>();
    for (const r of reactions) latestReaction.set(r.userId, r.emoji);
    return (
      <div className="screen quiz">
        <div className="quiz-top">
          <span className="progress-text">
            {roundIndex + 1} / {room.words?.length ?? 0}
          </span>
          <span className="clock">{(phase.msLeft / 1000).toFixed(1)}s</span>
        </div>
        <div className="quiz-body">
          {word && (
            <>
              <p className="meaning">
                {word.ko.join(' / ')} {word.from && <span className="muted">· {word.from}이(가) 낸 단어</span>}
              </p>
              <p className="answer-reveal">
                정답: <b>{word.en}</b>
              </p>
            </>
          )}
          <ul className="player-list">
            {players.map((p) => {
              const a = roundAnswers.find((x) => x.userId === p.userId);
              return (
                <li key={p.userId} className="player-row">
                  <span className="player-name">
                    {p.displayName}
                    {p.userId === fastestId && <Icon name="medalGold" className="inline-medal rank-gold" />}
                    {latestReaction.has(p.userId) && (
                      <span className="reaction-badge">{latestReaction.get(p.userId)}</span>
                    )}
                  </span>
                  <span className={`verdict ${a?.verdict ?? 'wrong'}`}>
                    {a ? `${VERDICT_TEXT[a.verdict]} · ${a.points}점` : '미제출'}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="reaction-bar">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} className="reaction-btn" onClick={() => sendReaction(e)} aria-label={`${e} 리액션 보내기`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // phase.kind === 'answer'
  const elapsedMs = answerMs - phase.msLeft;
  const hintStage = hintStageAt(elapsedMs, answerMs);
  const revealed = word ? progressiveMask(word.en, room.hintRatio ?? 0.2, hintStage, (room.maskSeed ?? 0) + phase.index) : [];
  const previewScore = correctScore(elapsedMs, answerMs);
  const ratio = Math.max(0, phase.msLeft / answerMs);
  const timerStage = ratio <= 0.25 ? 'urgent' : ratio <= 0.5 ? 'warn' : 'ok';
  const already = submittedRounds.has(phase.index);

  return (
    <div className={`screen quiz`}>
      <div className="quiz-top">
        <button className="btn ghost sm" onClick={() => void handleLeave()}>
          나가기
        </button>
        <span className="progress-text">
          {phase.index + 1} / {room.words?.length ?? 0}
        </span>
        <span className={`clock ${timerStage}`}>{(phase.msLeft / 1000).toFixed(1)}s</span>
      </div>

      <div className="timer-track">
        <div className={`timer-fill ${timerStage}`} style={{ transform: `scaleX(${ratio})` }} />
        <span className="timer-tick" style={{ left: '50%' }} aria-hidden />
        <span className="timer-tick" style={{ left: '75%' }} aria-hidden />
      </div>

      <div className="quiz-body">
        {word && (
          <p className="meaning">{word.ko.join(' / ')}</p>
        )}

        {word && (
          <div className="mask" aria-label={`${word.en.length}글자`}>
            {[...word.en].map((ch, i) =>
              ch === ' ' ? (
                <span key={i} className="slot space" />
              ) : (
                <span key={i} className={`slot ${revealed[i] ? 'shown' : ''}`}>
                  {revealed[i] ? ch : ''}
                </span>
              ),
            )}
          </div>
        )}

        <input
          className="answer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          readOnly={already}
          placeholder="전체 단어를 입력"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
        />

        <p className="hint-line muted">
          {already ? '제출 완료 · 다음 힌트를 기다리는 중' : `지금 답하면 약 ${previewScore}점 · Enter로 제출`}
        </p>

        <div className="score-strip">
          {standings.slice(0, 5).map((s) => (
            <span key={s.userId} className="score-chip">
              {nameOf(s.userId)} {s.totalPoints}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
