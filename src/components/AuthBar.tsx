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

/**
 * 계정 상태 + 액션. 설정 모달 안에서만 쓰인다. 랜딩 화면을 지나면 항상 세션이
 * 있으므로(게스트 아니면 실계정) "로그인 안 함" 상태는 사실상 없다 — 두 상태만 다룬다.
 */
export default function AuthBar({ sync }: Props) {
  if (!sync.configured) return null;

  // 단체게임에서 쓰던 익명 세션(게스트)도 여기 들어온다 — 데이터가 기기에만 있다는
  // 걸 알리고 실계정 연결을 권한다.
  if (!isRealSession(sync.session)) {
    return (
      <div className="authbar authbar-guest">
        <p className="muted">
          게스트 모드로 이용 중입니다. 브라우저 데이터를 지우면 단어장을 잃을 수 있어요.
        </p>
        <button className="btn primary sm" onClick={sync.signInWithGoogle}>
          Google 계정 연결하기
        </button>
      </div>
    );
  }

  const email = sync.session.user.email ?? '';
  return (
    <div className="authbar">
      <span className={`sync-dot ${sync.status}`} aria-hidden />
      <span className="muted">{STATUS_TEXT[sync.status] || email}</span>
      {sync.message && <span className="muted authbar-hint">{sync.message}</span>}
      <button className="btn ghost sm" onClick={sync.signOut}>
        로그아웃
      </button>
    </div>
  );
}
