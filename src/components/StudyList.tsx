import { useEffect, useMemo, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { lookupCache } from '../lib/pronounce';
import PronounceButton from './PronounceButton';
import AddWordForm from './AddWordForm';
import { DEFAULT_DECK } from '../lib/storage';

interface Props {
  words: Word[];
  setWords: (updater: (prev: Word[]) => Word[]) => void;
  /** 단어에서 드러나는 단어장 + 미리 만들어 둔 빈 단어장을 합친 전체 목록. */
  decks: string[];
  pronunciations: Record<string, Pronunciation>;
  /** 아직 캐시에 없는 단어의 발음을 받아온다. 서버 공유 캐시부터 확인하므로
   *  로그인 없이도(이미 누군가 조회한 단어라면) 대부분 바로 채워진다. */
  onFetchPronunciations: (targets: Word[]) => Promise<void>;
  onBack: () => void;
}

/** 종이 단어장을 펼쳐보는 화면. 훑어보며 외우는 게 기본이지만, 편집 모드를
 *  켜면 펼친 자리에 바로 한 단어씩 적어 넣듯 등록할 수 있다. 여러 단어를
 *  한꺼번에 붙여넣거나 새 단어장을 만드는 건 여전히 단어장 관리 쪽 일이다.
 */
export default function StudyList({
  words,
  setWords,
  decks,
  pronunciations,
  onFetchPronunciations,
  onBack,
}: Props) {
  const [filterDeck, setFilterDeck] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [notice, setNotice] = useState('');

  const list = useMemo(() => {
    const filtered = filterDeck ? words.filter((w) => w.deck === filterDeck) : words;
    // 등록한 순서(원서의 앞뒤 순서와 보통 일치)대로 — 알파벳순으로 섞으면 책 넘기듯 보기 어렵다.
    return filtered.slice().sort((a, b) => a.createdAt - b.createdAt);
  }, [words, filterDeck]);

  // 화면을 열거나 단어장을 바꿀 때마다 조용히 채운다 — 버튼을 눌러야만 발음이
  // 보이면 매번 다시 눌러야 하는 것처럼 느껴진다.
  useEffect(() => {
    void onFetchPronunciations(list);
  }, [list, onFetchPronunciations]);

  const existing = useMemo(() => new Set(words.map((w) => w.en.toLowerCase())), [words]);
  // "전체 단어장" 필터일 땐 넣을 단어장이 없으니 기본 단어장으로 떨어진다.
  const addDeck = filterDeck || DEFAULT_DECK;

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>단어장</h2>
        <div className="topbar-right">
          <button className="btn ghost sm" onClick={() => setEditMode((v) => !v)}>
            {editMode ? '완료' : '편집'}
          </button>
        </div>
      </div>

      <div className="row">
        <select value={filterDeck} onChange={(e) => setFilterDeck(e.target.value)} className="deck-picker">
          <option value="">전체 단어장 ({words.length})</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d} ({words.filter((w) => w.deck === d).length})
            </option>
          ))}
        </select>
        <span className="muted">{list.length}개</span>
      </div>

      {editMode && (
        <section className="card">
          <h3>단어 추가</h3>
          <p className="muted">
            {filterDeck
              ? `"${filterDeck}" 단어장에 바로 추가됩니다.`
              : '단어장을 고르지 않으면 기본 단어장에 추가됩니다.'}
          </p>
          {notice && (
            <p className="notice-bar" role="status">
              {notice}
            </p>
          )}
          <AddWordForm
            decks={decks}
            deck={addDeck}
            onDeckChange={setFilterDeck}
            hideDeckPicker
            existing={existing}
            onAdd={(word) => setWords((prev) => [...prev, word])}
            onNotice={setNotice}
          />
        </section>
      )}

      {list.length === 0 ? (
        <p className="muted">표시할 단어가 없습니다.</p>
      ) : (
        <div className="study-list">
          {list.map((w) => (
            <div key={w.id} className="study-row">
              <div className="study-row-en">
                <span className="study-en">{w.en}</span>
                <PronounceButton pron={lookupCache(w.en, pronunciations)} size="sm" />
              </div>
              <div className="study-row-ko">
                {w.ko.length > 1 ? (
                  <ol className="study-ko-list">
                    {w.ko.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ol>
                ) : (
                  w.ko[0]
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
