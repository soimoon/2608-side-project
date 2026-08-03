import type { CloudSync } from '../lib/useCloudSync';

const STATUS_TEXT: Record<CloudSync['status'], string> = {
  guest: '',
  syncing: '동기화 중…',
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

  if (!sync.session) {
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
