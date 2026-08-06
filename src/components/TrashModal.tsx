import { useState } from 'react';
import type { DeletedDeck, Word } from '../types';
import ConfirmModal from './ConfirmModal';

interface Props {
  deletedDecks: DeletedDeck[];
  /** 소프트 삭제된 것까지 포함한 전체 단어. 이름을 눌렀을 때 안에 뭐가 있었는지 보여주는 용도라
   *  여기서는 읽기 전용으로만 쓴다 — 고칠 일이 있으면 먼저 복원해서 단어장 안으로 들어가야 한다. */
  words: Word[];
  onRestore: (name: string) => { ok: boolean; error?: string };
  onPurge: (name: string) => void;
  onClose: () => void;
}

/** 삭제한 단어장이 모이는 휴지통. 완전 삭제 전까지는 언제든 복원할 수 있다. */
export default function TrashModal({ deletedDecks, words, onRestore, onPurge, onClose }: Props) {
  const [error, setError] = useState('');
  const [purging, setPurging] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function restore(name: string) {
    const res = onRestore(name);
    if (!res.ok) setError(res.error ?? '복원하지 못했습니다.');
    else setError('');
  }

  function wordsIn(name: string): Word[] {
    return words.filter((w) => w.deck === name && w.deletedAt);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>휴지통</h3>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        {deletedDecks.length === 0 ? (
          <p className="muted">휴지통이 비어 있습니다.</p>
        ) : (
          <div className="room-list">
            {deletedDecks
              .slice()
              .sort((a, b) => b.deletedAt - a.deletedAt)
              .map((d) => {
                const deckWords = wordsIn(d.name);
                const isOpen = expanded === d.name;
                return (
                  <div key={d.name} className="room-list-item trash-item-block">
                    <div className="trash-item">
                      <button
                        type="button"
                        className="room-list-title trash-item-name"
                        onClick={() => setExpanded(isOpen ? null : d.name)}
                        aria-expanded={isOpen}
                      >
                        {d.name}
                        <span className="muted trash-item-count"> 단어 {deckWords.length}개</span>
                      </button>
                      <div className="row wrap">
                        <button className="btn ghost sm" onClick={() => restore(d.name)}>
                          복원
                        </button>
                        <button className="btn danger sm" onClick={() => setPurging(d.name)}>
                          완전 삭제
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <ul className="trash-word-list">
                        {deckWords.length === 0 ? (
                          <li className="muted">단어가 없습니다.</li>
                        ) : (
                          deckWords.map((w) => (
                            <li key={w.id}>
                              <span className="en">{w.en}</span>
                              <span className="muted"> — {w.ko.join(' / ')}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {purging && (
        <ConfirmModal
          message={`"${purging}" 단어장을 완전히 삭제하시겠습니까? 이후에는 복원할 수 없습니다.`}
          danger
          onConfirm={() => {
            onPurge(purging);
            setPurging(null);
          }}
          onCancel={() => setPurging(null)}
        />
      )}
    </div>
  );
}
