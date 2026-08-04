import { useEffect, useState } from 'react';
import { suggestNickname } from '../../lib/groupApi';

interface Props {
  onConfirm: (nickname: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 단체게임에 처음 들어온 계정에게 뜨는 강제 닉네임 설정 모달. 닫기 버튼이 없다 —
 * 로그인 제공자의 실명을 그대로 보여주지 않기 위한 최소한의 장치라 건너뛸 수 없게
 * 했다. 다만 랜덤 제시안을 기본으로 채워 둬서, 그냥 확인만 눌러도 되게 마찰을 낮췄다.
 */
export default function NicknameGateModal({ onConfirm }: Props) {
  const [nickname, setNickname] = useState('');
  const [suggesting, setSuggesting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void suggestNickname().then((n) => {
      if (cancelled) return;
      if (n) setNickname(n);
      setSuggesting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function reroll() {
    setSuggesting(true);
    const n = await suggestNickname();
    if (n) setNickname(n);
    setSuggesting(false);
  }

  async function submit() {
    if (!nickname.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await onConfirm(nickname);
    setSubmitting(false);
    if (!res.ok) setError(res.error ?? '설정하지 못했습니다.');
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>닉네임</h3>
        <p className="muted">
          이 앱에서 회원님을 나타낼 이름입니다. 단체게임에서 다른 참가자에게도 보여요.
          마음에 안 들면 아래를 직접 바꿔도 됩니다.
        </p>

        <label className="field">
          <span>닉네임</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={suggesting ? '만드는 중…' : ''}
            maxLength={10}
            disabled={suggesting}
          />
          <span className="muted">영문·숫자·한글, 1~10자. 다른 사람과 겹칠 수 없어요.</span>
        </label>

        <div className="row">
          <button className="btn ghost sm" onClick={reroll} disabled={suggesting}>
            다른 이름 추천
          </button>
        </div>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn primary" disabled={!nickname.trim() || submitting || suggesting} onClick={submit}>
            {submitting ? '설정하는 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}
