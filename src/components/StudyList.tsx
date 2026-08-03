import { useEffect, useMemo, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { lookupCache } from '../lib/pronounce';
import PronounceButton from './PronounceButton';

interface Props {
  words: Word[];
  /** 단어에서 드러나는 단어장 + 미리 만들어 둔 빈 단어장을 합친 전체 목록. */
  decks: string[];
  pronunciations: Record<string, Pronunciation>;
  /** 아직 캐시에 없는 단어의 발음을 받아온다. 서버 공유 캐시부터 확인하므로
   *  로그인 없이도(이미 누군가 조회한 단어라면) 대부분 바로 채워진다. */
  onFetchPronunciations: (targets: Word[]) => Promise<void>;
  onBack: () => void;
}

/** 퀴즈나 편집이 아니라, 그냥 훑어보며 외우기 위한 화면. */
export default function StudyList({
  words,
  decks,
  pronunciations,
  onFetchPronunciations,
  onBack,
}: Props) {
  const [deck, setDeck] = useState('');

  const list = useMemo(() => {
    const filtered = deck ? words.filter((w) => w.deck === deck) : words;
    // 등록한 순서(원서의 앞뒤 순서와 보통 일치)대로 — 알파벳순으로 섞으면 책 넘기듯 보기 어렵다.
    return filtered.slice().sort((a, b) => a.createdAt - b.createdAt);
  }, [words, deck]);

  // 화면을 열거나 단어장을 바꿀 때마다 조용히 채운다 — 버튼을 눌러야만 발음이
  // 보이면 매번 다시 눌러야 하는 것처럼 느껴진다.
  useEffect(() => {
    void onFetchPronunciations(list);
  }, [list, onFetchPronunciations]);

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
