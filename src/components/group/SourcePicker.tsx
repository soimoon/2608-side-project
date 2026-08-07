import { useState } from 'react';
import type { Word } from '../../types';
import { GAME_DECKS } from '../../data/decks';
import { setSource } from '../../lib/groupApi';

interface Props {
  roomId: string;
  /** 로컬 단어장 전체(게스트 상태여도 그대로 쓸 수 있다 — 단체게임은 익명 로그인만 있으면 된다). */
  words: Word[];
  decks: string[];
  /** 이미 골랐다면 그 라벨(내 단어장 이름 또는 공식 덱 이름). */
  currentLabel: string | null;
  onSelected: () => void;
  /** 방 화면에서 "지금 이게 주인공 화면"일 때(아직 선택 전) flex:1로 넓게 펴는 용도. */
  className?: string;
}

/**
 * 참가자 각자 단어장을 하나 고르는 화면. 방장 것만 쓰면 형평성이 무너지고 관리자
 * 덱만 쓰면 재미가 없어서, 내 단어장 + 공식 덱을 한 목록에 섞어 보여준다 — 단어장이
 * 비어 있는 신규 사용자도 공식 덱을 고르면 되므로 모드 분기가 없다.
 */
export default function SourcePicker({ roomId, words, decks, currentLabel, onSelected, className }: Props) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const myDecks = decks
    .map((name) => ({ name, count: words.filter((w) => w.deck === name).length }))
    .filter((d) => d.count > 0);

  async function pickMine(deckName: string) {
    const list = words
      .filter((w) => w.deck === deckName)
      .slice(0, 300)
      .map((w) => ({ en: w.en, ko: w.ko }));
    if (list.length === 0) return;
    setSubmitting(deckName);
    setError('');
    const res = await setSource(roomId, 'mine', deckName, list);
    setSubmitting(null);
    if (!res.ok) {
      setError(res.error ?? '등록하지 못했습니다.');
      return;
    }
    onSelected();
  }

  async function pickOfficial(deckId: string) {
    const deck = GAME_DECKS.find((d) => d.id === deckId);
    if (!deck) return;
    setSubmitting(deckId);
    setError('');
    const res = await setSource(roomId, 'official', deck.name, deck.words);
    setSubmitting(null);
    if (!res.ok) {
      setError(res.error ?? '등록하지 못했습니다.');
      return;
    }
    onSelected();
  }

  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      <h3>내가 낼 단어장</h3>
      <p className="muted">
        {currentLabel
          ? `"${currentLabel}" 선택됨 — 다른 걸로 바꿀 수 있어요.`
          : '내 단어장 또는 공식 단어장에서 하나 고르세요. 전원이 골라야 시작할 수 있어요.'}
      </p>

      {myDecks.length > 0 && (
        <>
          <p className="muted small-label">내 단어장</p>
          <div className="chip-row">
            {myDecks.map((d) => (
              <button
                key={d.name}
                className={`chip ${currentLabel === d.name ? 'on' : ''}`}
                disabled={submitting !== null}
                onClick={() => pickMine(d.name)}
              >
                {submitting === d.name ? '등록 중…' : `${d.name} (${d.count})`}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="muted small-label">공식 단어장</p>
      <div className="chip-row">
        {GAME_DECKS.map((d) => (
          <button
            key={d.id}
            className={`chip ${currentLabel === d.name ? 'on' : ''}`}
            disabled={submitting !== null}
            onClick={() => pickOfficial(d.id)}
            title={d.description}
          >
            {submitting === d.id ? '등록 중…' : `${d.name} (${d.words.length})`}
          </button>
        ))}
      </div>

      {error && (
        <p className="notice-bar" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
