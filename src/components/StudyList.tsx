import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { lookupCache } from '../lib/pronounce';
import PronounceButton from './PronounceButton';
import AddWordForm from './AddWordForm';
import Icon from './Icon';
import { DEFAULT_DECK } from '../lib/storage';
import { byOrder, reorderWords } from '../lib/select';

interface Props {
  words: Word[];
  setWords: (updater: (prev: Word[]) => Word[]) => void;
  /** 단어에서 드러나는 단어장 + 미리 만들어 둔 빈 단어장을 합친 전체 목록. */
  decks: string[];
  pronunciations: Record<string, Pronunciation>;
  /** 아직 캐시에 없는 단어의 발음을 받아온다. 서버 공유 캐시부터 확인하므로
   *  로그인 없이도(이미 누군가 조회한 단어라면) 대부분 바로 채워진다. */
  onFetchPronunciations: (targets: Word[]) => Promise<void>;
  onBack: () => void;
}

/** 종이 단어장을 펼쳐보는 화면. 훑어보며 외우는 게 기본이지만, 편집 모드를
 *  켜면 펼친 자리에 바로 한 단어씩 적어 넣듯 등록할 수 있다. 여러 단어를
 *  한꺼번에 붙여넣거나 새 단어장을 만드는 건 여전히 단어장 관리 쪽 일이다.
 */
export default function StudyList({
  words,
  setWords,
  decks,
  pronunciations,
  onFetchPronunciations,
  onBack,
}: Props) {
  const [filterDeck, setFilterDeck] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [notice, setNotice] = useState('');

  const list = useMemo(() => {
    const filtered = filterDeck ? words.filter((w) => w.deck === filterDeck) : words;
    // 등록한 순서(원서의 앞뒤 순서와 보통 일치)대로 — 알파벳순으로 섞으면 책 넘기듯 보기 어렵다.
    // 직접 순서를 바꾼 단어가 있으면 그 순서를 따른다. 퀴즈의 "등록 순서" 전략과 같은 비교자다.
    return filtered.slice().sort(byOrder);
  }, [words, filterDeck]);

  // 드래그 재정렬 상태. liveOrderIds가 null이면 드래그 중이 아니고, list를 그대로 그린다.
  // 드래그 중엔 실제 order 값을 매 프레임 갱신하지 않는다(불필요한 쓰기) — 화면에는
  // liveOrderIds 순서로만 보여주고, 손을 뗄 때(endDrag) 딱 한 번 실제 순서로 반영한다.
  const [dragId, setDragId] = useState<string | null>(null);
  const [liveOrderIds, setLiveOrderIds] = useState<string[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const dragPointerId = useRef<number | null>(null);

  const listById = useMemo(() => new Map(list.map((w) => [w.id, w])), [list]);
  const displayList = liveOrderIds
    ? liveOrderIds.map((id) => listById.get(id)).filter((w): w is Word => Boolean(w))
    : list;

  // 화면을 열거나 단어장을 바꿀 때마다 조용히 채운다 — 버튼을 눌러야만 발음이
  // 보이면 매번 다시 눌러야 하는 것처럼 느껴진다.
  useEffect(() => {
    void onFetchPronunciations(list);
  }, [list, onFetchPronunciations]);

  // "전체 단어장" 필터일 땐 넣을 단어장이 없으니 기본 단어장으로 떨어진다.
  const addDeck = filterDeck || DEFAULT_DECK;
  // 같은 단어장 안에서만 중복을 막는다 — 다른 단어장에 이미 있어도 여기 추가는 허용.
  const existing = useMemo(
    () => new Set(words.filter((w) => w.deck === addDeck).map((w) => w.en.toLowerCase())),
    [words, addDeck],
  );

  /** 화면에 보이는 순서에서 from번째를 to번째로 옮긴다. 보통 한 단어의 order만 바뀐다. */
  function move(from: number, to: number) {
    const changes = reorderWords(list, from, to);
    if (changes.size === 0) return;
    const now = Date.now();
    setWords((prev) =>
      prev.map((w) => {
        const next = changes.get(w.id);
        return next === undefined ? w : { ...w, order: next, updatedAt: now };
      }),
    );
  }

  /** 손잡이를 누르면 시작 — 포인터를 손잡이에 캡처해 손가락이 다른 행 위로 지나가도
   *  move/up 이벤트가 계속 이 손잡이로 온다(별도 window 리스너가 필요 없다). */
  function handleDragPointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    e.preventDefault();
    setDragId(id);
    setLiveOrderIds(list.map((w) => w.id));
    dragPointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  /** 포인터가 걸쳐 있는 행을 찾아, 끌고 있는 단어를 그 자리로 화면상에서만 옮긴다.
   *  실제 order는 안 건드린다 — endDrag에서 최종 위치로 딱 한 번만 반영한다. */
  function handleDragPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragPointerId.current !== e.pointerId) return;
    e.preventDefault();
    const draggedId = dragId;
    if (!draggedId) return;
    setLiveOrderIds((prev) => {
      if (!prev) return prev;
      const currentIndex = prev.indexOf(draggedId);
      if (currentIndex === -1) return prev;
      let hoverIndex = currentIndex;
      for (let i = 0; i < prev.length; i++) {
        const el = rowRefs.current.get(prev[i]);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          hoverIndex = i;
          break;
        }
      }
      if (hoverIndex === currentIndex) return prev;
      const next = prev.slice();
      next.splice(currentIndex, 1);
      next.splice(hoverIndex, 0, draggedId);
      return next;
    });
  }

  /** 원래 순서(list) 기준 시작 위치와 드래그가 끝난 최종 위치를 비교해 한 번만 커밋한다.
   *  중간에 몇 번을 오갔든 최종 자리만 중요하므로 move()도 한 번만 부르면 된다. */
  function endDrag() {
    if (dragId && liveOrderIds) {
      const from = list.findIndex((w) => w.id === dragId);
      const to = liveOrderIds.indexOf(dragId);
      if (from !== -1 && to !== -1) move(from, to);
    }
    setDragId(null);
    setLiveOrderIds(null);
    dragPointerId.current = null;
  }

  function handleDragPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragPointerId.current !== e.pointerId) return;
    endDrag();
  }

  /** 포인터 없이(스크린리더·키보드)도 순서를 바꿀 수 있게 손잡이에 방향키를 남겨 둔다. */
  function handleDragKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, index - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, index + 1);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 홈
        </button>
        <h2>단어장</h2>
        <div className="topbar-right">
          <button className="btn ghost sm" onClick={() => setEditMode((v) => !v)}>
            {editMode ? '완료' : '편집'}
          </button>
        </div>
      </div>

      <div className="row">
        <select value={filterDeck} onChange={(e) => setFilterDeck(e.target.value)} className="deck-picker">
          <option value="">전체 단어장 ({words.length})</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d} ({words.filter((w) => w.deck === d).length})
            </option>
          ))}
        </select>
        <span className="muted">{list.length}개</span>
      </div>

      {editMode && (
        <section className="card">
          <h3>단어 추가</h3>
          <p className="muted">
            {filterDeck
              ? `"${filterDeck}" 단어장에 바로 추가됩니다.`
              : '단어장을 고르지 않으면 기본 단어장에 추가됩니다.'}{' '}
            아래 목록 왼쪽의 ≡ 손잡이를 꾹 눌러 끌면 순서를 바꿀 수 있고, 그 순서는 퀴즈의
            "등록 순서" 출제에도 그대로 쓰입니다.
          </p>
          {notice && (
            <p className="notice-bar" role="status">
              {notice}
            </p>
          )}
          <AddWordForm
            decks={decks}
            deck={addDeck}
            onDeckChange={setFilterDeck}
            hideDeckPicker
            existing={existing}
            onAdd={(word) => setWords((prev) => [...prev, word])}
            onNotice={setNotice}
          />
        </section>
      )}

      {list.length === 0 ? (
        <p className="muted">표시할 단어가 없습니다.</p>
      ) : (
        <div className="study-list">
          {displayList.map((w, i) => (
            <div
              key={w.id}
              ref={(el) => {
                if (el) rowRefs.current.set(w.id, el);
                else rowRefs.current.delete(w.id);
              }}
              className={`study-row${editMode ? ' editing' : ''}${dragId === w.id ? ' dragging' : ''}`}
            >
              {editMode && (
                <button
                  className="study-drag-handle"
                  aria-label={`${w.en} 순서 이동 — 눌러서 끌거나 방향키로 이동`}
                  onPointerDown={(e) => handleDragPointerDown(e, w.id)}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={handleDragPointerUp}
                  onKeyDown={(e) => handleDragKeyDown(e, i)}
                >
                  <Icon name="grip" />
                </button>
              )}
              <div className="study-row-en">
                <span className="study-en">{w.en}</span>
                <PronounceButton pron={lookupCache(w.en, pronunciations)} size="sm" />
              </div>
              <div className="study-row-ko">
                {w.ko.length > 1 ? (
                  <ol className="study-ko-list">
                    {w.ko.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ol>
                ) : (
                  w.ko[0]
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
