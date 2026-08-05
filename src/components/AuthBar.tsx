import { isRealSession, type CloudSync } from '../lib/useCloudSync';

const STATUS_TEXT: Record<CloudSync['status'], string> = {
  guest: '',
  syncing: '동기화 중…',
  confirming: '확인 대기 중…',
  synced: '동기화됨',
  offline: '오프라인 (다음에 다시 시도)',
  error: '동기화 실패 (다음에 다시 시도)',
};

interface Props {
  sync: CloudSync;
}

/** 클라우드 설정이 없으면(.env.local 미설정) 아무것도 그리지 않는다 — 게스트 전용 배포에서 UI가 늘어나지 않도록. */
export default function AuthBar({ sync }: Props) {
  if (!sync.configured) return null;

  // 단체게임용 익명 세션은 여기서 "로그인 안 함"으로 취급한다 — 단어장 동기화 기준으로는
  // 실제 계정이 아니기 때문이다(isRealSession 주석 참고).
  if (!isRealSession(sync.session)) {
    return (
      <div className="authbar">
        <button className="btn ghost sm" onClick={sync.signInWithGoogle}>
          Google로 로그인
        </button>
        <span className="muted authbar-hint">로그인하면 기기 간 단어장이 동기화됩니다</span>
      </div>
    );
  }

  const email = sync.session.user.email ?? '';
  return (
    <>
      <div className="authbar">
        <span className={`sync-dot ${sync.status}`} aria-hidden />
        <span className="muted">{STATUS_TEXT[sync.status] || email}</span>
        {sync.message && <span className="muted authbar-hint">{sync.message}</span>}
        <button className="btn ghost sm" onClick={sync.signOut}>
          로그아웃
        </button>
      </div>

      {sync.pendingMerge && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>이 기기의 단어를 계정에 동기화할까요?</h3>
            <p className="muted">
              이 기기에 <b>{sync.pendingMerge.localCount}개</b>, {email} 계정에{' '}
              <b>{sync.pendingMerge.remoteCount}개</b>의 단어가 있습니다.
            </p>
            <ul className="modal-list muted">
              <li>
                <b>동기화</b> — 두 목록을 합쳐 계정에 저장합니다. 같은 철자는 통계를 더하고 뜻을
                이어붙입니다.
              </li>
              <li>
                <b>계정 단어만 사용</b> — 이 기기에 있던 단어는 쓰지 않고, 계정에 이미 있는
                단어만 불러옵니다.
              </li>
              <li>
                <b>취소</b> — 로그아웃하고 아무것도 바꾸지 않습니다. 먼저 백업하려면 이걸
                누르고 단어장 관리 → JSON 백업을 이용하세요.
              </li>
            </ul>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => sync.confirmMerge('merge')}>
                동기화
              </button>
              <button className="btn ghost" onClick={() => sync.confirmMerge('cloudOnly')}>
                계정 단어만 사용
              </button>
              <button className="btn ghost" onClick={() => sync.confirmMerge('cancel')}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
