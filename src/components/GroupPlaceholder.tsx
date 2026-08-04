/** "단체게임" 탭. 실시간 대결 방은 아직 없다 — 준비 중이라고 정직하게 밝혀 둔다. */
export default function GroupPlaceholder() {
  return (
    <div className="screen">
      <div className="empty-cta">
        <p className="empty-cta-icon">👥</p>
        <p>
          <b>단체게임 준비 중</b>
        </p>
        <p className="muted">
          최대 5명이 같은 단어로 누가 더 많이 맞히는지 겨루는 기능을 만들고 있습니다.
        </p>
      </div>
    </div>
  );
}
