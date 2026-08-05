import { FRESH_WINDOW_MS, type RoomPlayer } from '../../lib/groupApi';

interface Props {
  players: RoomPlayer[];
  hostId: string;
  me: string;
  isHost: boolean;
  maxPlayers: number;
  onKick: (userId: string) => void;
}

/** 방 참가자 목록. 방장은 왕관, 나는 "(나)"로 표시하고, 방장에게만 강제퇴장 버튼이 보인다. */
export default function PlayerList({ players, hostId, me, isHost, maxPlayers, onKick }: Props) {
  return (
    <section className="card">
      <h3>
        참가자 {players.length}/{maxPlayers}
      </h3>
      <ul className="player-list">
        {players.map((p) => {
          const online = Date.now() - p.lastSeenAt < FRESH_WINDOW_MS;
          return (
            <li key={p.userId} className="player-row">
              <span className={`player-dot ${online ? 'online' : 'offline'}`} aria-hidden />
              <span className="player-name">
                {p.displayName}
                {p.userId === hostId && ' 👑'}
                {p.userId === me && ' (나)'}
              </span>
              <span className="muted player-source">{p.sourceLabel ? `✓ ${p.sourceLabel}` : '단어장 선택 전'}</span>
              {isHost && p.userId !== me && (
                <button className="btn ghost sm" onClick={() => onKick(p.userId)}>
                  강제퇴장
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
