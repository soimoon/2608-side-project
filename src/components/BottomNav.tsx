import Icon, { type IconName } from './Icon';

export type Tab = 'words' | 'quiz' | 'group' | 'profile';

const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'words', icon: 'book', label: '단어장' },
  { key: 'quiz', icon: 'pencil', label: '퀴즈' },
  { key: 'group', icon: 'people', label: '단체게임' },
  { key: 'profile', icon: 'smile', label: '프로필' },
];

interface Props {
  active: Tab;
  onNavigate: (tab: Tab) => void;
}

/** 화면 하단에 고정되는 4탭 네비게이션. 실제 퀴즈 풀이 중에는 App.tsx에서 아예 렌더링하지 않는다. */
export default function BottomNav({ active, onNavigate }: Props) {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`bottom-nav-item ${active === t.key ? 'on' : ''}`}
          onClick={() => onNavigate(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
        >
          <span className="bottom-nav-icon" aria-hidden>
            <Icon name={t.icon} />
          </span>
          <span className="bottom-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
