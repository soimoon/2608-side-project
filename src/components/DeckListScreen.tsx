import { useState } from 'react';
import type { Word } from '../types';
import { download, exportCSV, exportWordsJSON } from '../lib/storage';
import CreateDeckModal from './CreateDeckModal';

/** "새 단어장1", "새 단어장2"… 자동 이름 패턴. 아직 안 바꿨으면 목록에서 회색으로 보여준다. */
const AUTO_NAME = /^새 단어장\d+$/;

function nextAutoName(decks: string[]): string {
  let n = 1;
  while (decks.includes(`새 단어장${n}`)) n++;
  return `새 단어장${n}`;
}

interface Props {
  words: Word[];
  decks: string[];
  onCreateDeck: (name: string) => { ok: boolean; error?: string };
  onSelectDeck: (name: string) => void;
  onBack: () => void;
}

/**
 * "단어장 관리" 진입점. 예전엔 여기서 바로 단어 추가·수정 폼이 다 보였는데, 단어장이
 * 여러 개면 뭘 고치는지 헷갈렸다 — 이제는 단어장을 먼저 블록으로 고르고, 실제 추가·
 * 수정은 DeckDetailScreen(단어장 하나 안)에서만 한다.
 */
export default function DeckListScreen({ words, decks, onCreateDeck, onSelectDeck, onBack }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const countOf = (name: string) => words.filter((w) => w.deck === name).length;

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>단어장 관리</h2>
        <div className="topbar-right">
          <button
            className="btn ghost sm"
            onClick={() =>
              download(
                `voca-backup-${new Date().toLocaleDateString('sv-SE')}.voca.json`,
                exportWordsJSON(words),
                'application/json',
              )
            }
          >
            JSON 백업
          </button>
          <button
            className="btn ghost sm"
            onClick={() => download('voca-words.csv', exportCSV(words), 'text/csv')}
          >
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="room-list">
        {decks.map((name) => (
          <button key={name} className="room-list-item" onClick={() => onSelectDeck(name)}>
            <div className={`room-list-title ${AUTO_NAME.test(name) ? 'unnamed' : ''}`}>{name}</div>
            <div className="room-list-meta muted">단어 {countOf(name)}개</div>
          </button>
        ))}

        <button className="room-list-item add-new" onClick={() => setShowCreate(true)}>
          + 새 단어장 생성
        </button>
      </div>

      {showCreate && (
        <CreateDeckModal
          suggestedName={nextAutoName(decks)}
          onCreate={onCreateDeck}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
