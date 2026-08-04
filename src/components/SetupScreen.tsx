import { useMemo, useState } from 'react';
import type { QuizSettings, Strategy, Word } from '../types';
import { pickWords } from '../lib/select';
import { maskPreview } from '../lib/mask';

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
  const actualCount = Math.min(s.count, available.length);

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
    const picked = pickWords(words, s.decks, s.count, s.strategy);
    if (picked.length === 0) return;
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
              <input
                type="number"
                min={3}
                max={120}
                value={s.seconds}
                onChange={(e) =>
                  patch({ seconds: Math.min(120, Math.max(3, Number(e.target.value) || 3)) })
                }
              />
              <button
                className="btn ghost sm"
                onClick={() => patch({ seconds: Math.min(120, s.seconds + 1) })}
              >
                +
              </button>
            </div>
          </label>

          <label className="field">
            <span>문제 수</span>
            <div className="stepper">
              <button className="btn ghost sm" onClick={() => patch({ count: Math.max(1, s.count - 10) })}>
                −10
              </button>
              <input
                type="number"
                min={1}
                max={500}
                value={s.count}
                onChange={(e) => patch({ count: Math.max(1, Number(e.target.value) || 1) })}
              />
              <button className="btn ghost sm" onClick={() => patch({ count: s.count + 10 })}>
                +10
              </button>
            </div>
          </label>
        </div>
        <p className="muted">
          선택한 단어장에 <b>{available.length}개</b>가 있고, 이번에 <b>{actualCount}문제</b>가
          출제됩니다.
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
            <label key={st.value} className={`radio ${s.strategy === st.value ? 'on' : ''}`}>
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
