import { useState } from 'react';
import type { DeletedDeck, Word } from '../types';
import { download, exportCSV, exportWordsJSON } from '../lib/storage';
import CreateDeckModal from './CreateDeckModal';
import TrashModal from './TrashModal';

function nextAutoName(decks: string[]): string {
  let n = 1;
  while (decks.includes(`새 단어장${n}`)) n++;
  return `새 단어장${n}`;
}

interface Props {
  words: Word[];
  /** 소프트 삭제된 것까지 포함한 전체 단어 — 휴지통 미리보기에 필요하다. */
  allWords: Word[];
  decks: string[];
  deletedDecks: DeletedDeck[];
  /** 방금 이 화면으로 넘어오게 만든 동작(삭제 등)이 있으면 한 번 보여준다. */
  notice?: string;
  onCreateDeck: (name: string) => { ok: boolean; error?: string };
  onSelectDeck: (name: string) => void;
  onRestoreDeck: (name: string) => { ok: boolean; error?: string };
  onPurgeDeck: (name: string) => void;
  onBack: () => void;
}

/**
 * "단어장 관리" 진입점. 예전엔 여기서 바로 단어 추가·수정 폼이 다 보였는데, 단어장이
 * 여러 개면 뭘 고치는지 헷갈렸다 — 이제는 단어장을 먼저 블록으로 고르고, 실제 추가·
 * 수정은 DeckDetailScreen(단어장 하나 안)에서만 한다.
 */
export default function DeckListScreen({
  words,
  allWords,
  decks,
  deletedDecks,
  notice,
  onCreateDeck,
  onSelectDeck,
  onRestoreDeck,
  onPurgeDeck,
  onBack,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const countOf = (name: string) => words.filter((w) => w.deck === name).length;

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>단어장 관리</h2>
        <div className="topbar-right">
          <button className="btn ghost sm" onClick={() => setShowTrash(true)}>
            휴지통{deletedDecks.length > 0 ? ` (${deletedDecks.length})` : ''}
          </button>
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

      {notice && (
        <p className="notice-bar" role="status">
          {notice}
        </p>
      )}

      <div className="room-list">
        {decks.map((name) => (
          <button key={name} className="room-list-item" onClick={() => onSelectDeck(name)}>
            <div className="room-list-title">{name}</div>
            <div className="room-list-meta muted">단어 {countOf(name)}개</div>
          </button>
        ))}

        <button className="room-list-item add-new" onClick={() => setShowCreate(true)}>
          + 새 단어장 생성
        </button>
      </div>

      {showCreate && (
        <CreateDeckModal
          suggestedName={nextAutoName([...decks, ...deletedDecks.map((d) => d.name)])}
          onCreate={onCreateDeck}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showTrash && (
        <TrashModal
          deletedDecks={deletedDecks}
          words={allWords}
          onRestore={onRestoreDeck}
          onPurge={onPurgeDeck}
          onClose={() => setShowTrash(false)}
        />
      )}
    </div>
  );
}
