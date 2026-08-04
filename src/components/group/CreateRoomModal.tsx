import { useState } from 'react';
import { createRoom, type RoundCount, type Speed } from '../../lib/groupApi';

const MAX_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
const SPEED_OPTIONS: { value: Speed; label: string; hint: string }[] = [
  { value: 'fast', label: '빠름', hint: '8초' },
  { value: 'normal', label: '보통', hint: '12초' },
  { value: 'relaxed', label: '여유', hint: '16초' },
];
const ROUND_OPTIONS: RoundCount[] = [10, 20, 30];

interface Props {
  displayName: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}

/** 방 만들기 모달. 자유 입력 없이 프리셋만 고르게 한다 — 락스텝에서 제한 시간은
 *  전원의 대기 시간이라, 값이 방마다 제각각이면 목록에서 뭘 고를지 감이 안 온다. */
export default function CreateRoomModal({ displayName, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [max, setMax] = useState(5);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [rounds, setRounds] = useState<RoundCount>(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError('');
    const res = await createRoom(trimmed, max, speed, rounds, displayName);
    setSubmitting(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? '방을 만들지 못했습니다.');
      return;
    }
    onCreated(res.data.id);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>방 만들기</h3>

        <label className="field">
          <span>방 제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 토플 단어 대결할사람"
            maxLength={40}
          />
        </label>

        <label className="field">
          <span>최대 인원</span>
          <div className="chip-row">
            {MAX_OPTIONS.map((n) => (
              <button key={n} className={`chip ${max === n ? 'on' : ''}`} onClick={() => setMax(n)}>
                {n}명
              </button>
            ))}
          </div>
        </label>

        <label className="field">
          <span>제한 시간</span>
          <div className="chip-row">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s.value}
                className={`chip ${speed === s.value ? 'on' : ''}`}
                onClick={() => setSpeed(s.value)}
              >
                {s.label} ({s.hint})
              </button>
            ))}
          </div>
        </label>

        <label className="field">
          <span>문제 수</span>
          <div className="chip-row">
            {ROUND_OPTIONS.map((n) => (
              <button key={n} className={`chip ${rounds === n ? 'on' : ''}`} onClick={() => setRounds(n)}>
                {n}문제
              </button>
            ))}
          </div>
        </label>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn primary" disabled={!title.trim() || submitting} onClick={submit}>
            {submitting ? '만드는 중…' : '방 만들기'}
          </button>
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
