import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuizSettings, Strategy, Word } from '../types';
import { byOrder, pickWords } from '../lib/select';
import { maskPreview } from '../lib/mask';
import { primeAudio } from '../lib/sfx';

/**
 * 제한 시간·문제 수·범위 입력에 공통으로 쓰는 숫자 입력칸.
 *
 * 그냥 <input type="number" value={n} onChange={...}>로는 지우는 순간 onChange가
 * `Number('') || min` 같은 계산으로 즉시 최솟값을 다시 채워 넣어서, 사용자가 완전히
 * 빈 칸에서 새로 타이핑할 틈이 없다("30을 치려는데 130이 됨"의 진짜 원인). 그래서
 * 화면에 보이는 문자열은 별도 로컬 상태로 두고, 빈 칸인 동안은 그대로 비워 두다가
 * 포커스를 벗어날 때만(onBlur) min/max로 정리해서 커밋한다. 타이핑 중에도 숫자로
 * 유효할 때마다 onCommit을 불러 미리보기(문제 수·범위 단어 칩 등)는 계속 실시간으로
 * 갱신되게 한다.
 */
function NumberField({
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // 지금 이 칸을 편집 중인 동안은, 스텝퍼 버튼 등으로 바뀐 바깥 값이 타이핑 중인
  // 문자열을 덮어쓰지 않게 막는다.
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  function handleChange(raw: string) {
    editing.current = true;
    setText(raw);
    if (raw.trim() === '') return; // 비워 둔 채로는 커밋하지 않는다 — 빈 상태를 유지.
    const n = Number(raw);
    if (!Number.isNaN(n)) onCommit(n); // 아직 min/max로 조이지 않는다 — 자리 수를 더 치는 중일 수 있다.
  }

  function handleBlur() {
    editing.current = false;
    const n = Number(text);
    const clamped = text.trim() === '' || Number.isNaN(n) ? value : Math.min(max, Math.max(min, n));
    setText(String(clamped));
    onCommit(clamped);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      onFocus={(e) => e.target.select()}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

const PRESETS: { label: string; ratio: number; hint: string }[] = [
  { label: '쉬움', ratio: 0.4, hint: '40% 공개' },
  { label: '보통', ratio: 0.25, hint: '25% 공개' },
  { label: '어려움', ratio: 0.1, hint: '10% 공개' },
  { label: '지옥', ratio: 0, hint: '첫 글자만' },
];

const STRATEGIES: { value: Strategy; label: string; desc: string }[] = [
  {
    value: 'weak',
    label: '취약 단어 우선',
    // "우선"이라고 해서 약한 순으로 줄 세우는 건 아니다 — 매번 같은 단어만 나오지 않도록
    // 가중치를 준 뽑기다. 기대와 실제가 어긋나지 않게 방식까지 적어 둔다.
    desc: '정답률이 낮을수록, 오래 안 봤을수록 뽑힐 확률이 높아집니다. 연속으로 맞히면 점점 덜 나오고, 아직 한 번도 안 나온 단어가 가장 먼저 나옵니다. (순서대로 줄 세우는 게 아니라 확률을 높이는 방식)',
  },
  { value: 'random', label: '무작위', desc: '전부 동일한 확률' },
  {
    value: 'order',
    label: '등록 순서',
    desc: '단어장에 보이는 순서 그대로. 단어장 편집에서 순서를 바꿨다면 그 순서를 따릅니다.',
  },
  {
    value: 'range',
    label: '직접 범위 설정',
    desc: '등록 순서 기준으로 몇 번째부터 몇 번째까지만 골라 출제합니다. 예: 100개 중 앞 50개는 이미 했으니 뒤 50개만.',
  },
];

const SAMPLE_WORDS = ['synthesize', 'ubiquitous', 'mitigate'];

interface Props {
  words: Word[];
  /** 단어에서 드러나는 단어장 + 미리 만들어 둔 빈 단어장을 합친 전체 목록. */
  decks: string[];
  settings: QuizSettings;
  onSettingsChange: (s: QuizSettings) => void;
  onStart: (words: Word[], settings: QuizSettings) => void;
  onBack: () => void;
}

export default function SetupScreen({
  words,
  decks,
  settings,
  onSettingsChange,
  onStart,
  onBack,
}: Props) {
  const [s, setS] = useState<QuizSettings>(settings);

  const patch = (p: Partial<QuizSettings>) => setS((prev) => ({ ...prev, ...p }));

  const available = useMemo(
    () => (s.decks.length ? words.filter((w) => s.decks.includes(w.deck)) : words),
    [words, s.decks],
  );

  // '직접 범위 설정'에서 몇 번째 단어인지 보여주려면 등록 순서로 정렬된 목록이 필요하다
  // (단어장 편집 화면·'등록 순서' 전략과 같은 정렬 기준).
  const sortedAvailable = useMemo(() => available.slice().sort(byOrder), [available]);
  // 값을 한 번도 안 건드렸으면(undefined) 1번부터 최대 50개(또는 있는 만큼)를 기본으로 보여준다.
  const rangeFrom = s.rangeFrom ?? 1;
  const rangeTo = s.rangeTo ?? Math.min(50, sortedAvailable.length || 1);
  const fromWord = sortedAvailable[Math.min(rangeFrom, rangeTo) - 1];
  const toWord = sortedAvailable[Math.max(rangeFrom, rangeTo) - 1] ?? sortedAvailable[sortedAvailable.length - 1];

  const actualCount =
    s.strategy === 'range'
      ? pickWords(words, s.decks, 0, 'range', { from: rangeFrom, to: rangeTo }).length
      : Math.min(s.count, available.length);

  // 실제 출제될 단어로 미리보기를 만들어 난이도 체감이 정확하도록 한다.
  const samples = useMemo(() => {
    const src = available.length ? available.slice(0, 40).map((w) => w.en) : SAMPLE_WORDS;
    const longest = src.slice().sort((a, b) => b.length - a.length);
    return [longest[0], longest[Math.floor(longest.length / 2)], longest[longest.length - 1]]
      .filter((w, i, arr): w is string => Boolean(w) && arr.indexOf(w) === i)
      .slice(0, 3);
  }, [available]);

  function toggleDeck(name: string) {
    patch({ decks: s.decks.includes(name) ? s.decks.filter((d) => d !== name) : [...s.decks, name] });
  }

  function start() {
    const picked =
      s.strategy === 'range'
        ? pickWords(words, s.decks, 0, 'range', { from: rangeFrom, to: rangeTo })
        : pickWords(words, s.decks, s.count, s.strategy);
    if (picked.length === 0) return;
    // 지금이 실제 사용자 클릭 안이라 오디오 자동재생 잠금을 풀 수 있는 몇 안 되는
    // 기회다 — 여기서 풀어 두면 퀴즈 중 시간 초과처럼 사용자 조작 없이 걸리는
    // 재생(효과음·발음)도 브라우저가 계속 허용해 줄 가능성이 높아진다.
    primeAudio();
    onSettingsChange(s);
    onStart(picked, s);
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>퀴즈 설정</h2>
        <div className="topbar-right" />
      </div>

      <section className="card">
        <h3>난이도 — 몇 글자를 보여줄까요?</h3>
        <p className="muted">첫 글자는 항상 공개됩니다. 나머지는 글자 수 비율만큼 흩어서 공개돼요.</p>

        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`preset ${Math.abs(s.hintRatio - p.ratio) < 0.001 ? 'on' : ''}`}
              onClick={() => patch({ hintRatio: p.ratio })}
            >
              <b>{p.label}</b>
              <small>{p.hint}</small>
            </button>
          ))}
        </div>

        <label className="field slider">
          <span>
            공개 비율 <b>{Math.round(s.hintRatio * 100)}%</b>
          </span>
          <input
            type="range"
            min={0}
            max={40}
            step={5}
            value={Math.round(s.hintRatio * 100)}
            onChange={(e) => patch({ hintRatio: Number(e.target.value) / 100 })}
          />
        </label>

        <div className="mask-preview">
          {samples.map((w) => (
            <div key={w} className="mask-row">
              <code>{maskPreview(w, s.hintRatio, 7)}</code>
              <span className="muted">{w}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>제한 시간 &amp; 문제 수</h3>
        <div className="row wrap">
          <label className="field">
            <span>단어당 제한 시간(초)</span>
            <div className="stepper">
              <button className="btn ghost sm" onClick={() => patch({ seconds: Math.max(3, s.seconds - 1) })}>
                −
              </button>
              <NumberField
                min={3}
                max={120}
                value={s.seconds}
                onCommit={(n) => patch({ seconds: n })}
              />
              <button
                className="btn ghost sm"
                onClick={() => patch({ seconds: Math.min(120, s.seconds + 1) })}
              >
                +
              </button>
            </div>
          </label>

          <label className={`field ${s.strategy === 'range' ? 'disabled' : ''}`}>
            <span>문제 수</span>
            <div className="stepper">
              <button
                className="btn ghost sm"
                disabled={s.strategy === 'range'}
                onClick={() => patch({ count: Math.max(1, s.count - 10) })}
              >
                −10
              </button>
              <NumberField
                min={1}
                max={500}
                value={s.count}
                disabled={s.strategy === 'range'}
                onCommit={(n) => patch({ count: n })}
              />
              <button
                className="btn ghost sm"
                disabled={s.strategy === 'range'}
                onClick={() => patch({ count: s.count + 10 })}
              >
                +10
              </button>
            </div>
          </label>
        </div>
        <p className="muted">
          선택한 단어장에 <b>{available.length}개</b>가 있고, 이번에 <b>{actualCount}문제</b>가
          출제됩니다.
          {s.strategy === 'range' && ' (직접 범위 설정 중이라 문제 수는 범위 길이로 자동 결정됩니다.)'}
        </p>
      </section>

      <section className="card">
        <h3>출제 범위</h3>
        <div className="chip-row">
          <button className={`chip ${s.decks.length === 0 ? 'on' : ''}`} onClick={() => patch({ decks: [] })}>
            전체 ({words.length})
          </button>
          {decks.map((d) => (
            <button
              key={d}
              className={`chip ${s.decks.includes(d) ? 'on' : ''}`}
              onClick={() => toggleDeck(d)}
            >
              {d} ({words.filter((w) => w.deck === d).length})
            </button>
          ))}
        </div>

        <div className="radio-list">
          {STRATEGIES.map((st) => (
            <div key={st.value}>
              <label className={`radio ${s.strategy === st.value ? 'on' : ''}`}>
                <input
                  type="radio"
                  name="strategy"
                  checked={s.strategy === st.value}
                  onChange={() => patch({ strategy: st.value })}
                />
                <span>
                  <b>{st.label}</b>
                  <small>{st.desc}</small>
                </span>
              </label>

              {st.value === 'range' && s.strategy === 'range' && (
                <div className="range-picker">
                  <div className="range-inputs">
                    <NumberField
                      min={1}
                      max={sortedAvailable.length || 1}
                      value={rangeFrom}
                      onCommit={(n) => patch({ rangeFrom: n })}
                    />
                    <span>번째부터</span>
                    <NumberField
                      min={1}
                      max={sortedAvailable.length || 1}
                      value={rangeTo}
                      onCommit={(n) => patch({ rangeTo: n })}
                    />
                    <span>번째 단어까지 출제</span>
                  </div>
                  {sortedAvailable.length === 0 ? (
                    <p className="muted">선택한 단어장에 단어가 없습니다.</p>
                  ) : (
                    <div className="range-preview">
                      <span className="chip on">{fromWord?.en ?? '—'}</span>
                      <span className="muted">…</span>
                      <span className="chip on">{toWord?.en ?? '—'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>학습 옵션</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={s.retypeOnMiss}
            onChange={(e) => patch({ retypeOnMiss: e.target.checked })}
          />
          <span>
            <b>틀리면 정답 따라 치기</b>
            <small>정답을 보여주고 직접 한 번 타이핑해야 다음 문제로 넘어갑니다.</small>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.requeueWrong}
            onChange={(e) => patch({ requeueWrong: e.target.checked })}
          />
          <span>
            <b>틀린 단어 재출제</b>
            <small>같은 세션 뒷부분에 한 번 더 나옵니다. (통계에는 첫 시도만 반영)</small>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoPlayAudio}
            onChange={(e) => patch({ autoPlayAudio: e.target.checked })}
          />
          <span>
            <b>발음 자동 재생</b>
            <small>
              맞히든 틀리든 채점되는 순간 미국식 발음(Merriam-Webster 성우 녹음)이 자동으로
              나옵니다. 소리가 잘리지 않도록 정답 시 넘어가는 시간이 조금 길어집니다. 음원이
              없는 단어는 합성음으로 대체하지 않고 그냥 넘어갑니다.
            </small>
          </span>
        </label>
      </section>

      <div className="sticky-actions">
        <button className="btn primary lg" disabled={actualCount === 0} onClick={start}>
          {actualCount}문제 시작
        </button>
      </div>
    </div>
  );
}
