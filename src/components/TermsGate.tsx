import { useState } from 'react';
import type { ApiResult } from '../lib/termsApi';

interface Props {
  onAgree: () => Promise<ApiResult<void>>;
}

/**
 * 구글/카카오 등 실계정으로 처음 로그인한 계정에게 앱 진입 전 한 번 뜨는 동의 게이트.
 * 게스트(익명) 계정은 개인정보를 수집하지 않으므로 App.tsx가 애초에 이 컴포넌트를
 * 그 경우엔 렌더하지 않는다. 닫기 버튼이 없다 — NicknameGateModal.tsx와 같은 관례로,
 * 필수 동의 항목이라 건너뛸 수 없게 했다.
 */
export default function TermsGate({ onAgree }: Props) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!checked) return;
    setSubmitting(true);
    setError('');
    const res = await onAgree();
    setSubmitting(false);
    if (!res.ok) setError(res.error ?? '처리하지 못했습니다.');
  }

  const base = import.meta.env.BASE_URL;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>약관 동의</h3>
        <p className="muted">말싹을 시작하기 전에 아래 내용에 동의해 주세요. 처음 한 번만 확인하면 됩니다.</p>

        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            <b>이용약관 및 개인정보처리방침에 동의합니다 (필수)</b>
            <small>
              <a href={`${base}terms.html`} target="_blank" rel="noopener noreferrer">
                이용약관
              </a>
              {' · '}
              <a href={`${base}privacy.html`} target="_blank" rel="noopener noreferrer">
                개인정보처리방침
              </a>
              {' 전문을 확인할 수 있어요.'}
            </small>
          </span>
        </label>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn primary" disabled={!checked || submitting} onClick={submit}>
            {submitting ? '처리하는 중…' : '동의하고 시작하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
