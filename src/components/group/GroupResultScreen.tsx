import { useEffect, useState } from 'react';
import { fetchAnswers, fetchPlayers, type RoomAnswer, type RoomPlayer } from '../../lib/groupApi';
import { rankPlayers } from '../../lib/groupScore';

interface Props {
  roomId: string;
  gameNo: number;
  onBackToRoom: () => void;
}

const MEDAL = ['🥇', '🥈', '🥉'];

/**
 * 최종 순위 화면. GroupQuizScreen이 들고 있던 live 상태를 그대로 넘겨받는 대신
 * (화면 전환 후 사라질 수 있는 상태에 기대지 않기 위해) roomId+gameNo로 독립적으로
 * 다시 조회한다 — 방 목록의 "결과 화면"과 같은 패턴이다.
 */
export default function GroupResultScreen({ roomId, gameNo, onBackToRoom }: Props) {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [answers, setAnswers] = useState<RoomAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchPlayers(roomId), fetchAnswers(roomId, gameNo)]).then(([p, a]) => {
      if (cancelled) return;
      setPlayers(p);
      setAnswers(a);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, gameNo]);

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">결과를 불러오는 중…</p>
      </div>
    );
  }

  const standings = rankPlayers(answers, players.map((p) => p.userId));
  const nameOf = (id: string) => players.find((p) => p.userId === id)?.displayName ?? '???';

  return (
    <div className="screen">
      <header className="hero">
        <h1>결과</h1>
      </header>

      <div className="room-list">
        {standings.map((s) => (
          <div key={s.userId} className="room-list-item" style={{ cursor: 'default' }}>
            <div className="room-list-title">
              {MEDAL[s.rank - 1] ?? `${s.rank}위`} {nameOf(s.userId)}
            </div>
            <div className="room-list-meta muted">
              {s.totalPoints}점 · 정답 {s.correctCount}개
            </div>
          </div>
        ))}
      </div>

      <button className="btn primary lg" onClick={onBackToRoom}>
        방으로 돌아가기
      </button>
    </div>
  );
}
