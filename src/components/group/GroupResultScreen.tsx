import { useEffect, useRef, useState } from 'react';
import { fetchAnswers, fetchPlayers, type RoomAnswer, type RoomPlayer } from '../../lib/groupApi';
import { rankPlayers } from '../../lib/groupScore';
import { claimGameReward, CLAIM_NOT_WINNER_MESSAGE } from '../../lib/decorApi';
import Icon, { type IconName } from '../Icon';

interface Props {
  roomId: string;
  gameNo: number;
  /** 게스트(익명)면 undefined — 재화가 실계정 전용이라 그때는 보상 수령 시도 자체를 안 한다. */
  myUserId: string | undefined;
  onBackToRoom: () => void;
  /** 1등 보상 지급 성공 시 호출 — App.tsx의 wallet.refresh를 그대로 받아, 프로필로
   *  돌아가지 않아도 잔액이 그 자리에서 바로 반영되게 한다. */
  onRewardClaimed?: () => void;
}

const MEDAL: { icon: IconName; rankClass: string }[] = [
  { icon: 'medalGold', rankClass: 'rank-gold' },
  { icon: 'medalSilver', rankClass: 'rank-silver' },
  { icon: 'medalBronze', rankClass: 'rank-bronze' },
];

/**
 * 최종 순위 화면. GroupQuizScreen이 들고 있던 live 상태를 그대로 넘겨받는 대신
 * (화면 전환 후 사라질 수 있는 상태에 기대지 않기 위해) roomId+gameNo로 독립적으로
 * 다시 조회한다 — 방 목록의 "결과 화면"과 같은 패턴이다.
 */
export default function GroupResultScreen({ roomId, gameNo, myUserId, onBackToRoom, onRewardClaimed }: Props) {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [answers, setAnswers] = useState<RoomAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewardNotice, setRewardNotice] = useState('');
  const claimedRef = useRef(false);

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

  // 게임 도중 나간 사람은 leave_room이 room_players 행을 지워버리지만, 그 전에 낸
  // room_answers는 그대로 남는다. players만 보면 "나가기 전까지 딴 점수"가 통째로
  // 사라지므로, 답안에 등장하는 모든 user_id를 참가자로 쳐서 순위에 포함시킨다 —
  // 그래야 남아 있던 사람이 아니라 실제 점수로 순위가 매겨진다.
  const knownIds = new Set(players.map((p) => p.userId));
  const missingIds = [...new Set(answers.map((a) => a.userId))].filter((id) => !knownIds.has(id));
  // 나간 사람의 실제 닉네임은 알 길이 없다(스냅샷이 지워졌으므로) — 첫 정답을 낸
  // 라운드가 빠른 순서대로 "플레이어1", "플레이어2"라는 자리표시 이름을 붙인다.
  missingIds.sort((a, b) => {
    const roundOf = (id: string) => Math.min(...answers.filter((x) => x.userId === id).map((x) => x.roundIndex));
    return roundOf(a) - roundOf(b);
  });

  const allIds = [...players.map((p) => p.userId), ...missingIds];
  const standings = rankPlayers(answers, allIds);
  const nameOf = (id: string) => {
    const p = players.find((x) => x.userId === id);
    if (p) return p.displayName;
    return `플레이어${missingIds.indexOf(id) + 1}`;
  };

  // 화면에 표시된 순위로 "내가 1등인지"를 먼저 판단한 뒤에만 서버에 물어본다 — 1등이
  // 아닌 사람(대다수)에게 매번 헛RPC를 안 쏘려는 것. 최종 판정은 어차피 서버가 room_answers를
  // 직접 재집계해서 하므로(claim_game_reward), 여기 판단이 틀려도 부정 지급으로 이어지진
  // 않는다 — 그냥 "받을 자격 있는데 시도를 안 하는" 정도의 오차만 가능하고, 그마저도
  // standings 계산이 서버와 같은 데이터(room_answers)를 보므로 실제로는 안 어긋난다.
  const iAmRankOne = Boolean(myUserId) && standings.some((s) => s.rank === 1 && s.userId === myUserId);

  useEffect(() => {
    if (loading || !iAmRankOne || !myUserId || claimedRef.current) return;
    claimedRef.current = true;
    void claimGameReward(roomId, gameNo).then((res) => {
      if (res.ok && res.data) {
        setRewardNotice(`🎉 1등 보상으로 씨앗 ${res.data}개를 받았습니다!`);
        onRewardClaimed?.();
      } else if (res.error && res.error !== CLAIM_NOT_WINNER_MESSAGE) {
        // "1등이 아닙니다"는 standings 판정과 서버 판정이 아주 드물게 어긋나는 경우
        // (동시 도착 등)라 조용히 넘긴다 — 그 밖의 사유(공동 1등·일일 한도 등)는
        // 실제로 1등인 사람이 왜 못 받는지 궁금해할 만하니 보여준다.
        setRewardNotice(res.error);
      }
    });
  }, [loading, iAmRankOne, myUserId, roomId, gameNo, onRewardClaimed]);

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">결과를 불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="hero">
        <h1>결과</h1>
      </header>

      {rewardNotice && (
        <p className="notice-bar" role="status">
          {rewardNotice}
        </p>
      )}

      {/* fetchAnswers/fetchPlayers는 실패해도 []를 돌려주므로(방금 방금 끝난 판이라
          일시적으로 못 불러왔거나, network 문제), 빈 목록만 덩그러니 두지 않는다. */}
      {standings.length === 0 && (
        <div className="empty-cta">
          <p>결과를 불러오지 못했습니다.</p>
          <p className="muted">네트워크 상태를 확인하고 방으로 돌아가 다시 시도해 보세요.</p>
        </div>
      )}

      <div className="room-list">
        {standings.map((s) => (
          <div key={s.userId} className="room-list-item" style={{ cursor: 'default' }}>
            <div className="room-list-title">
              {MEDAL[s.rank - 1] ? (
                <Icon name={MEDAL[s.rank - 1].icon} className={`inline-medal ${MEDAL[s.rank - 1].rankClass}`} />
              ) : (
                `${s.rank}위`
              )}{' '}
              {nameOf(s.userId)}
              {missingIds.includes(s.userId) && <span className="muted"> (나감)</span>}
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
