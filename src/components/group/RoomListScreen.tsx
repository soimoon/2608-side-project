import { useState } from 'react';
import type { CloudSync } from '../../lib/useCloudSync';
import { useRoomList } from '../../lib/useRoomList';
import { useNickname } from '../../lib/useNickname';
import CreateRoomModal from './CreateRoomModal';
import NicknameGateModal from './NicknameGateModal';

interface Props {
  sync: CloudSync;
  onEnterRoom: (roomId: string) => void;
}

const SPEED_LABEL: Record<string, string> = { fast: '빠름', normal: '보통', relaxed: '여유' };

/** "단체게임" 탭 진입점. 공개 방 목록 — 코드 입장이 아니라 그림퀴즈류 앱처럼 골라 들어간다. */
export default function RoomListScreen({ sync, onEnterRoom }: Props) {
  const [creating, setCreating] = useState(false);
  // 훅은 조건 분기보다 위에서 항상 호출한다 — enabled=false면 훅 내부에서 그냥 쉰다.
  const { rooms, loading, refresh } = useRoomList(Boolean(sync.session));
  const { displayName, nicknameSet, loading: nickLoading, save: saveNickname } = useNickname(
    sync.session?.user.id,
  );

  if (!sync.configured) {
    return (
      <div className="screen">
        <div className="empty-cta">
          <p className="empty-cta-icon">👥</p>
          <p>이 배포에서는 단체게임을 쓸 수 없습니다.</p>
        </div>
      </div>
    );
  }

  if (!sync.session) {
    return (
      <div className="screen">
        <header className="hero">
          <h1>단체게임</h1>
          <p className="sub">로그인하면 친구들과 실시간으로 단어 대결을 할 수 있어요.</p>
        </header>
        <div className="empty-cta">
          <p className="empty-cta-icon">👥</p>
          <button className="btn primary lg" onClick={sync.signInWithGoogle}>
            Google로 로그인
          </button>
        </div>
      </div>
    );
  }

  if (nickLoading) {
    return (
      <div className="screen">
        <p className="muted">확인하는 중…</p>
      </div>
    );
  }

  // 계정에 닉네임이 아직 없으면(로그인 제공자의 실명을 그대로 보여주지 않기 위해)
  // 강제로 설정하게 한다. 방 목록 자체는 뒤에서 로딩만 돼 있고 조작은 막혀 있다.
  if (!nicknameSet) {
    return (
      <div className="screen">
        <p className="muted">확인하는 중…</p>
        <NicknameGateModal onConfirm={saveNickname} />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <span />
        <h2>단체게임</h2>
        <div className="topbar-right">
          <button className="btn ghost sm" onClick={refresh}>
            새로고침
          </button>
        </div>
      </div>

      <button className="btn primary lg" onClick={() => setCreating(true)}>
        + 방 만들기
      </button>

      {loading ? (
        <p className="muted">방을 불러오는 중…</p>
      ) : rooms.length === 0 ? (
        <div className="empty-cta">
          <p className="empty-cta-icon">👥</p>
          <p>아직 열린 방이 없습니다.</p>
          <p className="muted">첫 방을 만들어 친구를 초대해 보세요.</p>
        </div>
      ) : (
        <div className="room-list">
          {rooms.map((r) => (
            <button key={r.id} className="room-list-item" onClick={() => onEnterRoom(r.id)}>
              <div className="room-list-title">{r.title}</div>
              <div className="room-list-meta muted">
                {r.hostName}님의 방 · {r.playerCount}/{r.maxPlayers} · {SPEED_LABEL[r.speed]}
                {r.status === 'playing' && ' · 게임 중'}
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateRoomModal
          displayName={displayName ?? '플레이어'}
          onClose={() => setCreating(false)}
          onCreated={(roomId) => {
            setCreating(false);
            onEnterRoom(roomId);
          }}
        />
      )}
    </div>
  );
}
