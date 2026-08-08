import { useState } from 'react';
import type { Word } from '../types';
import { makeWord } from '../lib/storage';
import {
  fetchDefinition,
  formatWithReferences,
  isShowSynonymsEnabled,
  setShowSynonymsEnabled,
  stripReferences,
} from '../lib/defineApi';
import KoEditor from './KoEditor';

interface Props {
  /** 선택 가능한 단어장 목록. hideDeckPicker가 true면 화면에 안 보이지만 그래도 필요 없다. */
  decks: string[];
  /** 단어장 선택은 부모가 들고 있는다 — 단어장 관리에서는 붙여넣기 폼과 값을 공유해야 해서다. */
  deck: string;
  onDeckChange: (deck: string) => void;
  /** true면 단어장 선택 UI를 감추고 deck 값을 그대로 쓴다(이미 특정 단어장 화면 안이라 고를 필요가 없을 때). */
  hideDeckPicker?: boolean;
  /** 지금 넣을 단어장(deck) 안에 이미 있는 소문자 영단어 집합. 중복 등록을 막는 데 쓴다
   *  — 다른 단어장에 같은 단어가 있는 건 막지 않는다(호출부가 이미 deck으로 필터링해 넘김). */
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
  // "뜻 검색" 결과. 자동으로 안 채워진다 — 버튼을 눌러야만 조회된다(출시 전
  // 무료 테스트 단계라 외부 API 호출을 최소화하려는 의도적 설계).
  const [searching, setSearching] = useState(false);
  // 항상 원본(관련어·유의어·반의어 참조 포함)을 들고 있는다 — 토글을 바꿔도 재조회 없이
  // 그 자리에서 다시 정리해 보여줄 수 있게.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchError, setSearchError] = useState('');
  const [showSynonyms, setShowSynonyms] = useState(isShowSynonymsEnabled);

  function toggleShowSynonyms(v: boolean) {
    setShowSynonyms(v);
    setShowSynonymsEnabled(v);
  }

  /** en이 바뀌면 이전 단어의 검색 결과가 남아 헷갈리지 않게 지운다. */
  function updateEn(value: string) {
    setEn(value);
    setSuggestions([]);
    setSearchError('');
  }

  async function searchMeaning() {
    const enTrim = en.trim();
    if (!enTrim || searching) return;
    setSearching(true);
    setSearchError('');
    const res = await fetchDefinition(enTrim);
    setSearching(false);
    if (!res.ok) {
      setSuggestions([]);
      setSearchError(res.error ?? '뜻을 가져오지 못했습니다.');
      return;
    }
    setSuggestions(res.meanings);
  }

  /** 검색 결과 중 하나를 뜻 목록에 채워 넣는다 — 비어 있는 첫 칸을 채우고, 없으면
   *  새 줄을 만든다. 넣고 나면 그 후보는 목록에서 지운다(중복 추가 방지). raw는
   *  원본 그대로고, 실제로 넣는 텍스트는 지금 토글 상태에 맞춰 정리한다. */
  function addSuggestion(raw: string) {
    const text = showSynonyms ? formatWithReferences(raw) : stripReferences(raw);
    setKo((prev) => {
      const firstEmpty = prev.findIndex((m) => !m.trim());
      if (firstEmpty !== -1) return prev.map((m, i) => (i === firstEmpty ? text : m));
      return [...prev, text];
    });
    setSuggestions((prev) => prev.filter((s) => s !== raw));
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
    setSuggestions([]);
    setSearchError('');
    onNotice(`"${enTrim}" 추가됨 (뜻 ${koList.length}개)`);
  }

  return (
    <div className="add-word-form">
      <div className="row wrap">
        <label className="field">
          <span>영단어</span>
          <input value={en} onChange={(e) => updateEn(e.target.value)} placeholder="예: exploit" />
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
        <button
          type="button"
          className="btn ghost sm"
          disabled={!en.trim() || searching}
          onClick={() => void searchMeaning()}
        >
          {searching ? '검색 중…' : '뜻 검색'}
        </button>
      </div>

      {searchError && <p className="notice-bar muted">{searchError}</p>}

      {suggestions.length > 0 && (
        <div className="define-suggestions">
          <div className="row define-suggestions-head">
            <span className="muted small-label">검색 결과 — 누르면 뜻 칸에 채워집니다</span>
            <label className="check sm">
              <input
                type="checkbox"
                checked={showSynonyms}
                onChange={(e) => toggleShowSynonyms(e.target.checked)}
              />
              <span>관련어·유의어·반의어 함께 보기</span>
            </label>
          </div>
          {suggestions.map((raw, i) => (
            <button
              type="button"
              key={i}
              className="btn ghost sm define-suggestion"
              onClick={() => addSuggestion(raw)}
            >
              {showSynonyms ? formatWithReferences(raw) : stripReferences(raw)}
            </button>
          ))}
        </div>
      )}

      <KoEditor value={ko} onChange={setKo} />

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
