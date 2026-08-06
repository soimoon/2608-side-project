import { useCallback, useEffect, useState } from 'react';
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
 * 그대로 초대해도 되는 사람이다. 이 목록엔 postgres_changes 구독을 걸 테이블이 없어
 * (친구의 접속 상태·다른 방 참여 여부가 실시간으로 바뀌는 걸 감지할 단일 이벤트 소스가
 * 없다) 모달이 열려 있는 동안 5초 폴링으로 계속 다시 불러온다 — 안 그러면 모달을 켠
 * 채로는 방금 접속한 친구가 안 보이고, 껐다 켜야만 반영되는 문제가 있었다.
 */
export default function InviteFriendsModal({ roomId, onClose, onInvited }: Props) {
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const list = await listInvitableFriends(roomId);
      setFriends(list);
      setLoading(false);
    },
    [roomId],
  );

  useEffect(() => {
    void load();
    // 백그라운드 갱신은 loading을 건드리지 않는다 — 매번 "불러오는 중…"으로 목록이
    // 사라졌다 나타나면 오히려 더 거슬린다.
    const interval = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(interval);
  }, [load]);

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
          <button className="btn ghost sm" onClick={() => load()} disabled={loading}>
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
