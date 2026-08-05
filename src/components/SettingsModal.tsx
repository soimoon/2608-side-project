import { THEMES, type Theme } from '../types';
import type { CloudSync } from '../lib/useCloudSync';
import AuthBar from './AuthBar';

// Theme에 새 값을 추가하면 여기서 타입 에러가 나 라벨 추가를 잊지 않게 된다.
const THEME_LABELS: Record<Theme, string> = {
  blue: '기본 (파랑)',
  pink: '핑크',
};

interface Props {
  sync: CloudSync;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
}

/** 프로필 화면 우상단 ≡ 버튼으로 여는 설정. 폰 앱 관례대로 테마·계정 관리를 여기 모아 둔다. */
export default function SettingsModal({ sync, theme, onThemeChange, onClose }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>설정</h3>

        <label className="field">
          <span>테마</span>
          <select value={theme} onChange={(e) => onThemeChange(e.target.value as Theme)}>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        {sync.configured && (
          <div className="settings-section">
            <span className="muted small-label">계정</span>
            <AuthBar sync={sync} />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
