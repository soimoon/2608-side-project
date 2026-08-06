import { useState } from 'react';
import type { DeletedDeck } from '../types';
import ConfirmModal from './ConfirmModal';

interface Props {
  deletedDecks: DeletedDeck[];
  onRestore: (name: string) => { ok: boolean; error?: string };
  onPurge: (name: string) => void;
  onClose: () => void;
}

/** 삭제한 단어장이 모이는 휴지통. 완전 삭제 전까지는 언제든 복원할 수 있다. */
export default function TrashModal({ deletedDecks, onRestore, onPurge, onClose }: Props) {
  const [error, setError] = useState('');
  const [purging, setPurging] = useState<string | null>(null);

  function restore(name: string) {
    const res = onRestore(name);
    if (!res.ok) setError(res.error ?? '복원하지 못했습니다.');
    else setError('');
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
              .map((d) => (
                <div key={d.name} className="room-list-item trash-item">
                  <div className="room-list-title">{d.name}</div>
                  <div className="row wrap">
                    <button className="btn ghost sm" onClick={() => restore(d.name)}>
                      복원
                    </button>
                    <button className="btn danger sm" onClick={() => setPurging(d.name)}>
                      완전 삭제
                    </button>
                  </div>
                </div>
              ))}
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
