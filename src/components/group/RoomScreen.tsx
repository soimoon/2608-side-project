import { useEffect, useState } from 'react';
import type { Word } from '../../types';
import type { CloudSync } from '../../lib/useCloudSync';
import { useGroupRoom } from '../../lib/useGroupRoom';
import { useNickname } from '../../lib/useNickname';
import { startGame } from '../../lib/groupApi';
import PlayerList from './PlayerList';
import ChatPanel from './ChatPanel';
import NicknameGateModal from './NicknameGateModal';
import SourcePicker from './SourcePicker';

const SPEED_LABEL: Record<string, string> = { fast: '빠름(8초)', normal: '보통(12초)', relaxed: '여유(16초)' };

interface Props {
  roomId: string;
  sync: CloudSync;
  words: Word[];
  decks: string[];
  onBack: () => void;
  /** 게임이 시작되면(room.status === 'playing') 호출된다 — App.tsx가 GroupQuizScreen으로 넘긴다. */
  onGameStart: (roomId: string) => void;
}

/** 방 화면. 참가자 목록 + 단어장 선택 + 채팅. 게임이 시작되면 GroupQuizScreen으로 넘어간다. */
export default function RoomScreen({ roomId, sync, words, decks, onBack, onGameStart }: Props) {
  const session = sync.session;
  const userId = session?.user.id;
  const { displayName, nicknameSet, loading: nickLoading, save: saveNickname } = useNickname(userId);
  // 닉네임이 준비되기 전까지는 join_room을 부르지 않는다 — 직접 진입 등으로 방 목록의
  // 게이트를 우회한 경우까지 방어한다(보통은 목록 화면에서 이미 확정되어 있다).
  const effectiveUserId = nicknameSet ? userId : undefined;
  const { room, players, messages, loading, joinError, roomGone, kickedOut, isHost, send, kick, exit } =
    useGroupRoom(roomId, effectiveUserId, displayName ?? '플레이어');
  const [authError, setAuthError] = useState('');
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);

  function trySignIn() {
    setAuthError('');
    void sync.signInAnonymously().then((res) => {
      if (!res.ok) setAuthError(res.error ?? '로그인하지 못했습니다.');
    });
  }

  // RoomListScreen을 거치지 않고 바로 들어온 경우까지 방어한다(보통은 이미 로그인돼 있다).
  useEffect(() => {
    if (sync.configured && !session) trySignIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.configured, session, sync.signInAnonymously]);

  // 방장이 시작을 누르면(또는 다른 사람이 시작한 걸 감지하면) 전원이 같은 순간에 넘어간다.
  useEffect(() => {
    if (room?.status === 'playing') onGameStart(roomId);
  }, [room?.status, roomId, onGameStart]);

  async function handleLeave() {
    await exit();
    onBack();
  }

  async function handleStart() {
    setStarting(true);
    setStartError('');
    const res = await startGame(roomId);
    setStarting(false);
    if (!res.ok) setStartError(res.error ?? '시작하지 못했습니다.');
    // 성공하면 room.status가 realtime으로 'playing'이 되어 위 useEffect가 알아서 넘긴다.
  }

  if (!session) {
    return (
      <div className="screen">
        {authError ? (
          <div className="empty-cta">
            <p>입장하지 못했습니다.</p>
            <p className="muted">{authError}</p>
            <button className="btn primary" onClick={trySignIn}>
              다시 시도
            </button>
            <button className="btn ghost" onClick={onBack}>
              ← 목록으로
            </button>
          </div>
        ) : (
          <p className="muted">입장 준비 중…</p>
        )}
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

  const me = players.find((p) => p.userId === userId);
  const freshCount = players.length; // fetchPlayers는 신선한 참가자만 돌려주지 않으므로, 표시는 전체 인원 기준.
  const allSelected = players.length > 0 && players.every((p) => Boolean(p.sourceLabel));
  const canStart = isHost && freshCount >= 2 && allSelected && !starting;
  const startBlockedReason = !allSelected
    ? '전원이 단어장을 골라야 시작할 수 있습니다.'
    : freshCount < 2
      ? '최소 2명이 있어야 시작할 수 있습니다.'
      : '';

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={handleLeave}>
          ← 나가기
        </button>
        <h2>{room.title}</h2>
        <div className="topbar-right" />
      </div>

      <p className="muted">
        {SPEED_LABEL[room.speed]} · {room.roundCount}문제
      </p>

      <PlayerList
        players={players}
        hostId={room.hostId}
        me={userId ?? ''}
        isHost={isHost}
        maxPlayers={room.maxPlayers}
        onKick={kick}
      />

      <SourcePicker
        roomId={roomId}
        words={words}
        decks={decks}
        currentLabel={me?.sourceLabel ?? null}
        onSelected={() => {
          /* room_players 갱신은 realtime 구독이 알아서 반영한다 */
        }}
      />

      {isHost ? (
        <div className="sticky-actions">
          {startBlockedReason && <p className="muted">{startBlockedReason}</p>}
          {startError && (
            <p className="notice-bar" role="status">
              {startError}
            </p>
          )}
          <button className="btn primary lg" disabled={!canStart} onClick={handleStart}>
            {starting ? '시작하는 중…' : '게임 시작'}
          </button>
        </div>
      ) : (
        <p className="muted">방장이 게임을 시작하기를 기다리는 중입니다.</p>
      )}

      <ChatPanel messages={messages} me={userId ?? ''} onSend={send} />
    </div>
  );
}
