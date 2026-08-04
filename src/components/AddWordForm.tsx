import { useState } from 'react';
import type { Word } from '../types';
import { makeWord } from '../lib/storage';

interface Props {
  /** 선택 가능한 단어장 목록. hideDeckPicker가 true면 화면에 안 보이지만 그래도 필요 없다. */
  decks: string[];
  /** 단어장 선택은 부모가 들고 있는다 — 단어장 관리에서는 붙여넣기 폼과 값을 공유해야 해서다. */
  deck: string;
  onDeckChange: (deck: string) => void;
  /** true면 단어장 선택 UI를 감추고 deck 값을 그대로 쓴다(이미 특정 단어장 화면 안이라 고를 필요가 없을 때). */
  hideDeckPicker?: boolean;
  /** 소문자 영단어 집합. 중복 등록을 막는 데 쓴다. */
  existing: Set<string>;
  onAdd: (word: Word) => void;
  onNotice: (message: string) => void;
}

/**
 * 영단어 하나 + 뜻 여러 개를 등록하는 폼. 단어장 관리(붙여넣기 옆)와 단어장(편집 모드)
 * 양쪽에서 그대로 재사용한다 — 로직이 완전히 같아 따로 둘 이유가 없다.
 */
export default function AddWordForm({
  decks,
  deck,
  onDeckChange,
  hideDeckPicker,
  existing,
  onAdd,
  onNotice,
}: Props) {
  const [en, setEn] = useState('');
  // "+ 뜻 추가" 버튼을 누를 때마다 빈 칸이 하나씩 늘어난다.
  const [ko, setKo] = useState<string[]>(['']);

  function updateKo(i: number, value: string) {
    setKo((prev) => prev.map((m, idx) => (idx === i ? value : m)));
  }

  function addKo() {
    setKo((prev) => [...prev, '']);
  }

  function removeKo(i: number) {
    setKo((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function submit() {
    const enTrim = en.trim();
    const koList = ko.map((m) => m.trim()).filter(Boolean);
    if (!enTrim || koList.length === 0) return;
    if (existing.has(enTrim.toLowerCase())) {
      onNotice(`이미 등록된 단어입니다: ${enTrim}`);
      return;
    }
    onAdd(makeWord(enTrim, koList, deck));
    setEn('');
    setKo(['']);
    onNotice(`"${enTrim}" 추가됨 (뜻 ${koList.length}개)`);
  }

  return (
    <div className="add-word-form">
      <div className="row wrap">
        <label className="field">
          <span>영단어</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} placeholder="예: exploit" />
        </label>
        {!hideDeckPicker && (
          <label className="field">
            <span>단어장</span>
            <select value={deck} onChange={(e) => onDeckChange(e.target.value)}>
              {decks.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="manual-ko-list">
        {ko.map((m, i) => (
          <div className="row manual-ko-row" key={i}>
            <span className="ko-index">{i + 1}</span>
            <input
              className="cell"
              value={m}
              onChange={(e) => updateKo(i, e.target.value)}
              placeholder={i === 0 ? '뜻 (예: 이용하다)' : '또 다른 뜻'}
            />
            {ko.length > 1 && (
              <button className="btn ghost sm" onClick={() => removeKo(i)}>
                삭제
              </button>
            )}
          </div>
        ))}
        <button className="btn ghost sm" onClick={addKo}>
          + 뜻 추가
        </button>
      </div>

      <button
        className="btn primary"
        disabled={!en.trim() || ko.every((m) => !m.trim())}
        onClick={submit}
      >
        등록
      </button>
    </div>
  );
}
