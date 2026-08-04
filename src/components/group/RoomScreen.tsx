import type { CloudSync } from '../../lib/useCloudSync';
import { useGroupRoom } from '../../lib/useGroupRoom';
import { useNickname } from '../../lib/useNickname';
import PlayerList from './PlayerList';
import ChatPanel from './ChatPanel';
import NicknameGateModal from './NicknameGateModal';
import DebugLockstepStrip from './DebugLockstepStrip';

interface Props {
  roomId: string;
  sync: CloudSync;
  onBack: () => void;
}

/** 방 화면. 참가자 목록 + 채팅. 게임 시작(다음 단계)이 붙기 전까지는 로비 상태로만 존재한다. */
export default function RoomScreen({ roomId, sync, onBack }: Props) {
  const session = sync.session;
  const userId = session?.user.id;
  const { displayName, nicknameSet, loading: nickLoading, save: saveNickname } = useNickname(userId);
  // 닉네임이 준비되기 전까지는 join_room을 부르지 않는다 — 직접 진입 등으로 방 목록의
  // 게이트를 우회한 경우까지 방어한다(보통은 목록 화면에서 이미 확정되어 있다).
  const effectiveUserId = nicknameSet ? userId : undefined;
  const { room, players, messages, loading, joinError, roomGone, kickedOut, isHost, send, kick, exit } =
    useGroupRoom(roomId, effectiveUserId, displayName ?? '플레이어');

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

  if (nickLoading) {
    return (
      <div className="screen">
        <p className="muted">확인하는 중…</p>
      </div>
    );
  }

  if (!nicknameSet) {
    return (
      <div className="screen">
        <p className="muted">확인하는 중…</p>
        <NicknameGateModal onConfirm={saveNickname} />
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
          <p>방장이 회원님을 강제퇴장시켰습니다.</p>
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

      {/* Phase 2 검증용. 진짜 게임 스케줄이 붙으면(Phase 3) 지운다. */}
      <DebugLockstepStrip />
    </div>
  );
}
