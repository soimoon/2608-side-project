import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, Pronunciation, QuizSettings, Verdict, Word } from '../types';
import { judge, normalize } from '../lib/judge';
import { maskWord } from '../lib/mask';
import { lookupCache, playAudio } from '../lib/pronounce';
import PronounceButton from './PronounceButton';

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

  const sessionStart = useRef(Date.now());
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

  // 제한 시간 카운트다운. 답을 제출하면 phase가 바뀌면서 정리된다.
  useEffect(() => {
    if (phase !== 'answering') return;
    questionStart.current = performance.now();
    setRemaining(settings.seconds);
    const deadline = performance.now() + settings.seconds * 1000;

    const tick = window.setInterval(() => {
      setRemaining(Math.max(0, (deadline - performance.now()) / 1000));
    }, 100);
    const expire = window.setTimeout(() => timeoutHandler.current(), settings.seconds * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(expire);
    };
  }, [idx, phase, settings.seconds]);

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
      if (confirm('퀴즈를 중단할까요? 이번 세션 기록은 저장되지 않습니다.')) onAbort();
      return;
    }
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
  const urgent = remaining <= 3;
  const retypeMatched = phase === 'retype' && normalize(input) === normalize(answer);

  return (
    <div className={`screen quiz ${verdict && phase !== 'answering' ? `v-${verdict}` : ''}`}>
      <div className="quiz-top">
        <button className="btn ghost sm" onClick={onAbort}>
          중단
        </button>
        <span className="progress-text">
          {idx + 1} / {total}
          {extra > 0 && <span className="muted"> (+{extra} 복습)</span>}
        </span>
        <span className={`clock ${urgent && phase === 'answering' ? 'urgent' : ''}`}>
          {phase === 'answering' ? remaining.toFixed(1) : (0).toFixed(1)}s
        </span>
      </div>

      <div className="timer-track">
        <div
          className={`timer-fill ${urgent ? 'urgent' : ''}`}
          style={{ transform: `scaleX(${phase === 'answering' ? ratio : 0})` }}
        />
      </div>

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

        <div className="mask" aria-label={`${answer.length}글자`}>
          {[...answer].map((ch, i) =>
            ch === ' ' ? (
              <span key={i} className="slot space" />
            ) : (
              <span key={i} className={`slot ${revealed[i] ? 'shown' : ''}`}>
                {phase === 'answering' ? (revealed[i] ? ch : '') : ch}
              </span>
            ),
          )}
        </div>
        <p className="len-hint muted">{answer.replace(/\s/g, '').length}글자</p>

        <input
          ref={inputRef}
          className={`answer-input ${verdict && phase !== 'answering' ? `v-${verdict}` : ''} ${
            retypeMatched ? 'matched' : ''
          }`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // disabled로 두면 포커스가 빠져 Enter로 다음 문제로 넘어갈 수 없다.
          readOnly={phase === 'feedback'}
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
          {phase === 'answering' && 'Enter로 제출 · Esc로 중단'}
          {phase === 'retype' && '정답을 그대로 입력한 뒤 Enter로 다음 문제'}
          {phase === 'feedback' && verdict !== 'correct' && 'Enter로 다음 문제'}
        </p>
      </div>
    </div>
  );
}
