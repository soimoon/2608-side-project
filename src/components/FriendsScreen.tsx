import { useState } from 'react';
import { type FriendSearchResult, searchUsers, sendFriendRequest } from '../lib/friendsApi';
import type { UseFriendsResult } from '../lib/useFriends';
import Icon from './Icon';

interface Props {
  friendsState: UseFriendsResult;
  onBack: () => void;
}

const SEARCH_PATTERN = /^[A-Za-z0-9가-힣]{2,10}$/;

const RELATION_LABEL: Record<FriendSearchResult['relation'], string | null> = {
  none: null,
  friend: '이미 친구',
  outgoing: '요청 보냄',
  incoming: '요청 받음',
};

/** 프로필 안에서 진입하는 친구 화면. 검색/요청 → 받은 요청 → 친구 목록 순서로 쌓는다.
 *  실계정 전용이라 여기 진입하는 시점엔 이미 isRealSession이 확인된 상태를 가정한다. */
export default function FriendsScreen({ friendsState, onBack }: Props) {
  const { friends, requests, loading, respond, remove } = friendsState;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  async function runSearch() {
    const trimmed = query.trim();
    if (!SEARCH_PATTERN.test(trimmed)) {
      setResults([]);
      setNotice('닉네임 앞 2~10자를 입력하세요 (영문·숫자·한글).');
      return;
    }
    setSearching(true);
    setNotice('');
    const found = await searchUsers(trimmed);
    setResults(found);
    setSearching(false);
    if (found.length === 0) setNotice('찾는 닉네임이 없습니다.');
  }

  async function request(target: FriendSearchResult) {
    setSendingTo(target.userId);
    const res = await sendFriendRequest(target.userId);
    setSendingTo(null);
    if (!res.ok) {
      setNotice(res.error ?? '요청하지 못했습니다.');
      return;
    }
    setNotice(res.data === 'friend' ? `${target.displayName}님과 친구가 되었습니다.` : '친구 요청을 보냈습니다.');
    setResults((prev) =>
      prev.map((r) => (r.userId === target.userId ? { ...r, relation: res.data === 'friend' ? 'friend' : 'outgoing' } : r)),
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 프로필
        </button>
        <h2>친구</h2>
        <div className="topbar-right" />
      </div>

      <section className="card">
        <h3>친구 찾기</h3>
        <div className="row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder="닉네임 앞 2자 이상"
            maxLength={10}
          />
          <button className="btn primary sm" onClick={runSearch} disabled={searching}>
            검색
          </button>
        </div>

        {results.length > 0 && (
          <ul className="player-list">
            {results.map((r) => {
              const label = RELATION_LABEL[r.relation];
              return (
                <li key={r.userId} className="player-row">
                  <span className="player-name">{r.displayName}</span>
                  {label ? (
                    <span className="muted player-source">{label}</span>
                  ) : (
                    <button
                      className="btn ghost sm"
                      disabled={sendingTo === r.userId}
                      onClick={() => request(r)}
                    >
                      친구 요청
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {notice && (
          <p className="notice-bar" role="status">
            {notice}
          </p>
        )}
      </section>

      {requests.length > 0 && (
        <section className="card">
          <h3>받은 요청 {requests.length}</h3>
          <ul className="player-list">
            {requests.map((r) => (
              <li key={r.fromId} className="player-row">
                <span className="player-name">{r.displayName}</span>
                <button className="btn primary sm" onClick={() => respond(r.fromId, true)}>
                  수락
                </button>
                <button className="btn ghost sm" onClick={() => respond(r.fromId, false)}>
                  거절
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>친구 {friends.length}</h3>
        {loading ? (
          <p className="muted">불러오는 중…</p>
        ) : friends.length === 0 ? (
          <div className="empty-cta">
            <p className="empty-cta-icon">
              <Icon name="people" />
            </p>
            <p>아직 친구가 없습니다.</p>
            <p className="muted">위에서 닉네임으로 찾아 요청해 보세요.</p>
          </div>
        ) : (
          <ul className="player-list">
            {friends.map((f) => (
              <li key={f.userId} className="player-row">
                <span className={`player-dot ${f.online ? 'online' : 'offline'}`} aria-hidden />
                <span className="player-name">{f.displayName}</span>
                <span className="muted player-source">
                  {f.inGame ? '게임 중' : f.online ? '접속 중' : '오프라인'}
                </span>
                <button className="btn ghost sm" onClick={() => remove(f.userId)}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
