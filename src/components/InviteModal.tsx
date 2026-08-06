import { useState } from 'react';

interface Props {
  fromName: string;
  roomTitle: string;
  onAccept: () => void;
  onDecline: (mute: boolean) => void;
}

/**
 * 단체게임 초대 확인창. ConfirmModal.tsx를 본뜨되(같은 .modal-overlay > .modal 골격),
 * 초대 특유의 "이 방의 초대 다시 받지 않기" 체크박스를 더한다 — 이 방에 한해서만
 * 차단이라는 뜻을 문구로도 명확히 한다(사람 자체를 차단하는 게 아니다).
 */
export default function InviteModal({ fromName, roomTitle, onAccept, onDecline }: Props) {
  const [mute, setMute] = useState(false);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>단체게임 초대</h3>
        <p>
          <b>{fromName}</b>님이 <b>"{roomTitle}"</b> 방에 초대했습니다. 참여하시겠습니까?
        </p>

        <label className="check">
          <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
          <span>
            이 방의 초대 다시 받지 않기
            <small>이 방에서 오는 초대만 그만 받습니다. {fromName}님의 다른 방 초대는 그대로 받아요.</small>
          </span>
        </label>

        <div className="modal-actions">
          <button className="btn primary" onClick={onAccept}>
            예
          </button>
          <button className="btn ghost" onClick={() => onDecline(mute)}>
            아니오
          </button>
        </div>
      </div>
    </div>
  );
}
