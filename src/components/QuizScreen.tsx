import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, Pronunciation, QuizSettings, Verdict, Word } from '../types';
import { judge, normalize } from '../lib/judge';
import { maskWord } from '../lib/mask';
import { lookupCache, playAudio } from '../lib/pronounce';
import PronounceButton from './PronounceButton';
import MaskSlots from './MaskSlots';
import TimerBar, { timerStageOf } from './TimerBar';

interface QItem {
  word: Word;
  /** 오답으로 인해 뒤에 다시 붙은 문제인지. 재출제 문제는 다시 재출제되지 않는다. */
  requeued: boolean;
}

type Phase = 'answering' | 'retype' | 'feedback';

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: '정답!',
  near: '아깝다! 한 글자 차이',
  wrong: '오답',
  timeout: '시간 초과',
};

interface Props {
  words: Word[];
  settings: QuizSettings;
  pronunciations: Record<string, Pronunciation>;
  onFinish: (attempts: Attempt[], settings: QuizSettings, startedAt: number) => void;
  onAbort: () => void;
}

export default function QuizScreen({
  words,
  settings,
  pronunciations,
  onFinish,
  onAbort,
}: Props) {
  const [queue, setQueue] = useState<QItem[]>(() => words.map((w) => ({ word: w, requeued: false })));
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('answering');
  const [input, setInput] = useState('');
  /** 채점 직후 입력칸은 비우므로, 피드백에 보여줄 원래 입력을 따로 들고 있는다. */
  const [submitted, setSubmitted] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [remaining, setRemaining] = useState(settings.seconds);
  /** true면 카운트다운·입력이 전부 멈추고 일시중지 모달이 뜬다. */
  const [paused, setPaused] = useState(false);

  const sessionStart = useRef(Date.now());
  /** 일시중지에 들어간 시각. 재개할 때 이 구간만큼 questionStart를 밀어서,
   *  멈춰 있던 시간이 elapsedMs(통계용 소요시간)에 안 끼게 한다. */
  const pauseStart = useRef<number | null>(null);
  const questionStart = useRef(performance.now());
  const inputRef = useRef<HTMLInputElement>(null);
  /** 상태 반영 전에 확정된 다음 큐/기록. setState 비동기성 때문에 ref로 넘긴다. */
  const pending = useRef<{ queue: QItem[]; attempts: Attempt[] } | null>(null);
  /** 세션마다 공개 위치가 달라지도록 하는 마스킹 시드. */
  const seed = useRef(Math.floor(Math.random() * 2 ** 31));
  /** 현재 문제에 이미 답을 기록했는지. Enter와 시간 초과의 이중 제출을 막는다. */
  const answered = useRef(false);

  const item = queue[idx];
  const answer = item?.word.en ?? '';
  const pron = lookupCache(answer, pronunciations);

  const revealed = useMemo(
    () => maskWord(answer, settings.hintRatio, seed.current + idx),
    [answer, settings.hintRatio, idx],
  );

  const advance = useCallback(() => {
    const q = pending.current?.queue ?? queue;
    const a = pending.current?.attempts ?? attempts;
    pending.current = null;

    if (idx + 1 >= q.length) {
      onFinish(a, settings, sessionStart.current);
      return;
    }
    answered.current = false;
    setIdx(idx + 1);
    setPhase('answering');
    setInput('');
    setVerdict(null);
  }, [idx, queue, attempts, onFinish, settings]);

  const submit = useCallback(
    (v: Verdict, typed: string) => {
      if (!item) return;
      // 제출과 시간 초과가 동시에 걸리는 경합을 막는다. 한 문제당 한 번만 기록한다.
      if (answered.current) return;
      answered.current = true;

      const attempt: Attempt = {
        wordId: item.word.id,
        en: item.word.en,
        ko: item.word.ko,
        input: typed,
        verdict: v,
        elapsedMs: Math.round(performance.now() - questionStart.current),
        requeued: item.requeued,
      };
      const nextAttempts = [...attempts, attempt];
      let nextQueue = queue;
      if (v !== 'correct' && settings.requeueWrong && !item.requeued) {
        nextQueue = [...queue, { word: item.word, requeued: true }];
        setQueue(nextQueue);
      }
      setAttempts(nextAttempts);
      pending.current = { queue: nextQueue, attempts: nextAttempts };
      setVerdict(v);
      setSubmitted(typed);

      if (v === 'correct') {
        setPhase('feedback');
        return;
      }
      setPhase(settings.retypeOnMiss ? 'retype' : 'feedback');
      setInput('');
    },
    [item, attempts, queue, settings],
  );

  // 최신 클로저를 타이머 콜백에서 쓰기 위한 ref.
  const timeoutHandler = useRef<() => void>(() => {});
  timeoutHandler.current = () => submit('timeout', input);

  // 카운트다운 시작 기준값을 ref로 들고 있는다 — setRemaining은 비동기라, 새 문제로
  // 넘어가는 순간 "리셋" 효과와 "틱 시작" 효과가 같은 커밋에서 같이 도는데, 틱 쪽이
  // state(remaining)를 읽으면 리셋이 아직 반영되기 전의(직전 문제가 끝났을 때 남아
  // 있던, 0에 가까울 수도 있는) 값을 그대로 잡아버린다. 그러면 새 문제가 시작하자마자
  // 곧장 시간 초과 처리되는 버그가 난다 — ref는 동기적으로 갱신되므로 이 경쟁을 없앤다.
  const remainingRef = useRef(settings.seconds);

  // 새 문제가 시작될 때만 제한 시간을 리셋한다 — 일시중지 토글은 이 효과를 안 건드린다.
  useEffect(() => {
    if (phase !== 'answering') return;
    questionStart.current = performance.now();
    remainingRef.current = settings.seconds;
    setRemaining(settings.seconds);
  }, [idx, phase, settings.seconds]);

  // 카운트다운 진행. paused가 true인 동안엔 그냥 멈춰 있는다. remainingRef.current를
  // 기준으로 deadline을 잡으므로, 위 리셋 효과가 먼저 갱신해 둔 값을 그대로 이어받는다
  // (선언 순서상 리셋 효과가 먼저 실행된다). 재개하면 멈췄던 그 지점부터 다시 잰다.
  useEffect(() => {
    if (phase !== 'answering' || paused) return;
    const deadline = performance.now() + remainingRef.current * 1000;

    const tick = window.setInterval(() => {
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      remainingRef.current = left; // 언제 멈추더라도 최신값을 들고 있게 계속 갱신.
      setRemaining(left);
    }, 100);
    const expire = window.setTimeout(() => timeoutHandler.current(), remainingRef.current * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(expire);
    };
  }, [idx, phase, paused]);

  /** 일시중지를 켜고 끈다. 재개 시 멈춰 있던 구간만큼 questionStart를 밀어 통계용
   *  소요시간(elapsedMs)에서 빠지게 한다. */
  const togglePaused = useCallback(() => {
    setPaused((p) => {
      if (p) {
        // 재개하는 순간.
        if (pauseStart.current !== null) {
          questionStart.current += performance.now() - pauseStart.current;
          pauseStart.current = null;
        }
        return false;
      }
      pauseStart.current = performance.now();
      return true;
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [idx, phase]);

  /** 이번 문제에서 실제로 소리가 날 것인지. 정답 후 대기 시간을 여기에 맞춘다. */
  const willPlayAudio = settings.autoPlayAudio && Boolean(pron?.audioUrl);

  /**
   * 채점되는 순간 발음을 들려준다 — 맞혔든 틀렸든. 방금 떠올린 철자와 소리를 같이
   * 넣어야 기억에 남는다.
   *
   * 문제당 한 번만 재생한다. 퀴즈 도중 발음 미리 받기가 끝나면 pronunciations가
   * 바뀌는데, 그때 이미 피드백 화면이면 같은 소리가 다시 나기 때문이다.
   */
  const audioPlayedFor = useRef(-1);
  useEffect(() => {
    if (!settings.autoPlayAudio) return;
    if (phase === 'answering' || verdict === null) return;
    if (!pron?.audioUrl) return;
    if (audioPlayedFor.current === idx) return;
    audioPlayedFor.current = idx;
    playAudio(pron.audioUrl);
  }, [idx, phase, verdict, pron, settings.autoPlayAudio]);

  // 정답이면 잠깐 보여주고 자동으로 넘어간다.
  useEffect(() => {
    if (phase !== 'feedback' || verdict !== 'correct') return;
    // 발음이 나가는 중이면 소리가 잘리지 않게 조금 더 기다린다 (단어 발음은 보통 1초 안쪽).
    const t = window.setTimeout(advance, willPlayAudio ? 1200 : 550);
    return () => window.clearTimeout(t);
  }, [phase, verdict, advance, willPlayAudio]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      togglePaused();
      return;
    }
    // 일시중지 중엔 Enter를 포함해 아무 입력도 안 받는다 — 모달이 위에 떠 있는 동안
    // 뒤의 입력칸이 몰래 채점되면 안 된다.
    if (paused) return;
    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (phase === 'answering') {
      // 아무것도 안 쳤는데 앞 문제에서 넘어온 Enter가 여기로 새어 들어오는 경우가
      // 있다 — 빈 채로 제출하면 무조건 오답이 되니, 아예 반응하지 않는다.
      if (!input.trim()) return;
      submit(judge(input, answer), input);
    } else if (phase === 'retype') {
      // 다 쳤어도 자동으로 넘어가지 않는다 — 넘어가자마자 눌린 Enter가 다음 문제의
      // 빈 입력을 오답으로 제출해 버리는 사고가 있었다. 맞게 쳤을 때만 Enter로 넘어간다.
      if (normalize(input) === normalize(answer)) advance();
    } else if (phase === 'feedback' && verdict !== 'correct') {
      advance();
    }
  }

  if (!item) return null;

  const total = queue.length;
  const extra = total - words.length;
  const ratio = Math.max(0, remaining / settings.seconds);
  const timerStage = timerStageOf(ratio);
  const retypeMatched = phase === 'retype' && normalize(input) === normalize(answer);

  return (
    <div className={`screen quiz ${verdict && phase !== 'answering' ? `v-${verdict}` : ''}`}>
      <div className="quiz-top">
        <button className="btn ghost sm" onClick={togglePaused}>
          일시중지
        </button>
        <span className="progress-text">
          {idx + 1} / {total}
          {extra > 0 && <span className="muted"> (+{extra} 복습)</span>}
        </span>
        <span className={`clock ${phase === 'answering' ? timerStage : ''}`}>
          {phase === 'answering' ? remaining.toFixed(1) : (0).toFixed(1)}s
        </span>
      </div>

      <TimerBar ratio={phase === 'answering' ? ratio : 0} />

      <div className="quiz-body">
        {item.word.ko.length > 1 ? (
          <div className="meaning-list">
            {item.word.ko.map((m, i) => (
              <p key={i} className="meaning multi">
                <span className="meaning-num">{i + 1}</span>
                {m}
              </p>
            ))}
          </div>
        ) : (
          <p className="meaning">{item.word.ko[0]}</p>
        )}

        <MaskSlots text={answer} revealed={revealed} revealAll={phase !== 'answering'} />
        <p className="len-hint muted">{answer.replace(/\s/g, '').length}글자</p>

        <input
          ref={inputRef}
          className={`answer-input ${verdict && phase !== 'answering' ? `v-${verdict}` : ''} ${
            retypeMatched ? 'matched' : ''
          }`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // disabled로 두면 포커스가 빠져 Esc로 재개할 때 다시 focus를 신경 써야 한다 —
          // readOnly는 포커스를 유지한 채로 입력만 막는다(피드백 화면과 같은 이유).
          readOnly={phase === 'feedback' || paused}
          placeholder={phase === 'retype' ? '정답을 그대로 입력하세요' : '전체 단어를 입력'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        <div className="feedback" role="status">
          {verdict && phase !== 'answering' && (
            <>
              <span className={`verdict ${verdict}`}>{VERDICT_TEXT[verdict]}</span>
              {verdict !== 'correct' && (
                <span className="answer-reveal">
                  정답: <b>{answer}</b>
                  {submitted.trim() && <span className="muted"> · 입력: {submitted.trim()}</span>}
                </span>
              )}
              {/* 맞혔을 때도 보여준다 — 자동 재생을 놓쳤으면 다시 들을 수 있게. */}
              <PronounceButton pron={pron} />
            </>
          )}
        </div>

        <p className="hint-line muted">
          {phase === 'answering' && 'Enter로 제출 · Esc로 일시중지'}
          {phase === 'retype' && '정답을 그대로 입력한 뒤 Enter로 다음 문제'}
          {phase === 'feedback' && verdict !== 'correct' && 'Enter로 다음 문제'}
        </p>
      </div>

      {paused && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>일시중지</h3>
            <p className="muted">잠깐 멈췄어요. 이어서 풀거나 그만둘 수 있어요.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={togglePaused}>
                계속하기
              </button>
              <button className="btn danger" onClick={onAbort}>
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
