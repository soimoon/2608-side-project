import { useState } from 'react';

interface Props {
  /** 입력칸에 회색으로 미리 보여줄 이름("새 단어장3" 등). 그냥 확인만 누르면 이 이름으로 만들어진다. */
  suggestedName: string;
  onClose: () => void;
  onCreate: (name: string) => { ok: boolean; error?: string };
}

/** 새 단어장 만들기 모달. 이름을 안 적어도 회색으로 보이던 제안 이름 그대로 만들어지고,
 *  적으면 그 이름으로 만들어진다 — 귀찮으면 그냥 확인만 눌러도 되게 하려는 것. */
export default function CreateDeckModal({ suggestedName, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const final = name.trim() || suggestedName;
    const res = onCreate(final);
    if (!res.ok) {
      setError(res.error ?? '만들지 못했습니다.');
      return;
    }
    onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>새 단어장</h3>

        <label className="field">
          <span>단어장 이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestedName}
            maxLength={40}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={submit}>
            만들기
          </button>
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
