import type { CloudSync } from '../lib/useCloudSync';

interface Props {
  sync: CloudSync;
}

/**
 * 계정을 새로 연결했을 때(랜딩 화면에서 처음 Google 로그인, 또는 설정에서 게스트 →
 * 실계정 전환) 이 기기의 로컬 단어를 계정과 합칠지 묻는 다이얼로그. 어느 화면에
 * 있든 뜰 수 있어(설정 모달이 열려 있든 아니든) App.tsx에 항상 마운트해 둔다.
 */
export default function MergeDialog({ sync }: Props) {
  if (!sync.pendingMerge) return null;
  const email = sync.session?.user.email ?? '';

  return (
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
            <b>계정 단어만 사용</b> — 이 기기에 있던 단어는 쓰지 않고, 계정에 이미 있는 단어만
            불러옵니다.
          </li>
          <li>
            <b>취소</b> — 로그아웃하고 아무것도 바꾸지 않습니다. 먼저 백업하려면 이걸 누르고
            단어장 관리 → JSON 백업을 이용하세요.
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
  );
}
