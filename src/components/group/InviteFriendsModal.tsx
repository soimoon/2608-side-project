import { useEffect, useState } from 'react';
import { type InvitableFriend, inviteFriend, listInvitableFriends } from '../../lib/friendsApi';
import Icon from '../Icon';

interface Props {
  roomId: string;
  onClose: () => void;
  /** 성공적으로 초대를 보내면 방 화면에 notice-bar로 띄울 문구를 올려보낸다. */
  onInvited: (message: string) => void;
}

/**
 * 방 로비의 "친구 초대" 목록. list_invitable_friends RPC가 이미 네 조건(개인 퀴즈 중
 * 아님·접속 중·다른 방 없음·이 방 차단 안 함)을 전부 걸러 주므로, 여기 뜨는 사람은
 * 그대로 초대해도 되는 사람이다. 목록은 모달을 여는 순간 한 번만 불러온다 — 상태가
 * 계속 실시간으로 바뀔 필요는 없고(초대 누를 때 서버가 다시 검증한다), 열 때마다
 * 새로고침 버튼으로 다시 불러올 수 있으면 충분하다.
 */
export default function InviteFriendsModal({ roomId, onClose, onInvited }: Props) {
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const list = await listInvitableFriends(roomId);
    setFriends(list);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function invite(friend: InvitableFriend) {
    setError('');
    const res = await inviteFriend(roomId, friend.userId);
    if (!res.ok) {
      setError(res.error ?? '초대하지 못했습니다.');
      return;
    }
    setInvitedIds((prev) => [...prev, friend.userId]);
    onInvited(`${friend.displayName}님을 초대했습니다.`);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>친구 초대</h3>

        {loading ? (
          <p className="muted">불러오는 중…</p>
        ) : friends.length === 0 ? (
          <div className="empty-cta">
            <p className="empty-cta-icon">
              <Icon name="people" />
            </p>
            <p>지금 초대할 수 있는 친구가 없습니다.</p>
            <p className="muted">접속 중이면서 퀴즈나 다른 게임 중이 아닌 친구만 뜹니다.</p>
          </div>
        ) : (
          <ul className="player-list">
            {friends.map((f) => {
              const invited = invitedIds.includes(f.userId);
              return (
                <li key={f.userId} className="player-row">
                  <span className="player-dot online" aria-hidden />
                  <span className="player-name">{f.displayName}</span>
                  <button className="btn ghost sm" disabled={invited} onClick={() => invite(f)}>
                    {invited ? '초대함' : '초대'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn ghost sm" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
