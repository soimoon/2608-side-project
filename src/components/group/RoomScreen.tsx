import { useMemo } from 'react';
import type { CloudSync } from '../../lib/useCloudSync';
import { displayNameFrom } from '../../lib/groupApi';
import { useGroupRoom } from '../../lib/useGroupRoom';
import PlayerList from './PlayerList';
import ChatPanel from './ChatPanel';

interface Props {
  roomId: string;
  sync: CloudSync;
  onBack: () => void;
}

/** 방 화면. 참가자 목록 + 채팅. 게임 시작(다음 단계)이 붙기 전까지는 로비 상태로만 존재한다. */
export default function RoomScreen({ roomId, sync, onBack }: Props) {
  const session = sync.session;
  const userId = session?.user.id;
  const displayName = useMemo(() => displayNameFrom(session ?? null), [session]);
  const { room, players, messages, loading, joinError, roomGone, kickedOut, isHost, send, kick, exit } =
    useGroupRoom(roomId, userId, displayName);

  async function handleLeave() {
    await exit();
    onBack();
  }

  if (!session) {
    return (
      <div className="screen">
        <div className="empty-cta">
          <p>로그인이 필요합니다.</p>
          <button className="btn ghost" onClick={onBack}>
            ← 목록으로
          </button>
        </div>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="screen">
        <div className="empty-cta">
          <p>{joinError}</p>
          <button className="btn primary" onClick={onBack}>
            목록으로
          </button>
        </div>
      </div>
    );
  }

  if (roomGone) {
    return (
      <div className="screen">
        <div className="empty-cta">
          <p>이 방은 사라졌습니다.</p>
          <p className="muted">참가자가 전부 나가면 방이 자동으로 정리됩니다.</p>
          <button className="btn primary" onClick={onBack}>
            목록으로
          </button>
        </div>
      </div>
    );
  }

  if (kickedOut) {
    return (
      <div className="screen">
        <div className="empty-cta">
          <p>방장이 회원님을 내보냈습니다.</p>
          <button className="btn primary" onClick={onBack}>
            목록으로
          </button>
        </div>
      </div>
    );
  }

  if (loading || !room) {
    return (
      <div className="screen">
        <p className="muted">입장하는 중…</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={handleLeave}>
          ← 나가기
        </button>
        <h2>{room.title}</h2>
        <div className="topbar-right" />
      </div>

      <PlayerList
        players={players}
        hostId={room.hostId}
        me={userId ?? ''}
        isHost={isHost}
        maxPlayers={room.maxPlayers}
        onKick={kick}
      />

      {isHost ? (
        <p className="muted">방장만 게임을 시작할 수 있습니다. (게임 모드는 곧 추가됩니다)</p>
      ) : (
        <p className="muted">방장이 게임을 시작하기를 기다리는 중입니다.</p>
      )}

      <ChatPanel messages={messages} me={userId ?? ''} onSend={send} />
    </div>
  );
}
