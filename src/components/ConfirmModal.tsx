interface Props {
  title?: string;
  message: string;
  confirmLabel?: string;
  /** 되돌리기 어렵거나 위험한 동작이면 확인 버튼을 danger 색으로. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 되돌리기 부담이 큰 동작(단어장 삭제·완전 삭제 등) 전에 반드시 거치는 확인창.
 *  브라우저 기본 confirm() 대신 써서 "예/아니오" 문구와 스타일을 앱에 맞게 통일한다. */
export default function ConfirmModal({ title, message, confirmLabel = '예', danger, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <div className="modal-actions">
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="btn ghost" onClick={onCancel}>
            아니오
          </button>
        </div>
      </div>
    </div>
  );
}
