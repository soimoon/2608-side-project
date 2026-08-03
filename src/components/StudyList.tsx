import { useMemo, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { deckNames } from '../lib/select';
import { lookupCache } from '../lib/pronounce';
import PronounceButton from './PronounceButton';

interface Props {
  words: Word[];
  pronunciations: Record<string, Pronunciation>;
  onBack: () => void;
}

/** 퀴즈나 편집이 아니라, 그냥 훑어보며 외우기 위한 화면. */
export default function StudyList({ words, pronunciations, onBack }: Props) {
  const decks = useMemo(() => deckNames(words), [words]);
  const [deck, setDeck] = useState('');

  const list = useMemo(() => {
    const filtered = deck ? words.filter((w) => w.deck === deck) : words;
    // 등록한 순서(원서의 앞뒤 순서와 보통 일치)대로 — 알파벳순으로 섞으면 책 넘기듯 보기 어렵다.
    return filtered.slice().sort((a, b) => a.createdAt - b.createdAt);
  }, [words, deck]);

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>단어장 보기</h2>
        <div className="topbar-right" />
      </div>

      <div className="row">
        <select value={deck} onChange={(e) => setDeck(e.target.value)} className="deck-picker">
          <option value="">전체 단어장 ({words.length})</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d} ({words.filter((w) => w.deck === d).length})
            </option>
          ))}
        </select>
        <span className="muted">{list.length}개</span>
      </div>

      {list.length === 0 ? (
        <p className="muted">표시할 단어가 없습니다.</p>
      ) : (
        <div className="study-grid">
          {list.map((w) => (
            <div key={w.id} className="study-card">
              <div className="study-card-head">
                <span className="study-en">{w.en}</span>
                <PronounceButton pron={lookupCache(w.en, pronunciations)} size="sm" />
              </div>
              {w.ko.length > 1 ? (
                <ol className="study-ko-list">
                  {w.ko.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ol>
              ) : (
                <p className="study-ko">{w.ko[0]}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
