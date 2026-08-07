import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { guessSplit, parseBulk } from '../lib/parse';
import { makeWord } from '../lib/storage';
import { lookupCache, missingFromCache } from '../lib/pronounce';
import ImportReview, { type ReviewRow } from './ImportReview';
import PronounceButton from './PronounceButton';
import AddWordForm from './AddWordForm';
import ConfirmModal from './ConfirmModal';

const SAMPLE = `synthesize\t통합하다, 종합하다
ubiquitous\t어디에나 있는
2. mitigate - 완화하다
분명한  apparent`;

interface Props {
  deckName: string;
  /** 활성 단어 전체(이 단어장뿐 아니라) — 중복 등록 검사와 "다른 단어장으로 옮기기" 선택지에 필요하다. */
  words: Word[];
  setWords: (updater: (prev: Word[]) => Word[]) => void;
  decks: string[];
  onRenameDeck: (oldName: string, newName: string) => { ok: boolean; error?: string };
  /** 삭제 확인까지 마친 뒤 부른다. 목록 화면으로 돌려보내고 휴지통 이동 알림을 띄우는
   *  건 App.tsx 쪽 책임이라, 여기서는 단어 소프트 삭제만 하고 이걸 부르면 끝이다. */
  onDeleted: (deckName: string) => void;
  pronunciations: Record<string, Pronunciation>;
  onFetchPronunciations: (targets: Word[]) => Promise<void>;
  onBack: () => void;
}

/**
 * 단어장 하나의 상세 화면. 예전 WordManager는 모든 단어장의 단어 추가·수정을 한
 * 화면에서 다 했는데, 지금 보고 있는 단어가 어느 단어장 건지 헷갈린다는 피드백으로
 * DeckListScreen(목록) → 여기(단어장 하나) 2단계로 나눴다. 그래서 단어장 선택 UI가
 * 필요했던 자리(붙여넣기 대상, 단어 직접 추가 폼)는 전부 deckName으로 고정된다.
 */
export default function DeckDetailScreen({
  deckName,
  words,
  setWords,
  decks,
  onRenameDeck,
  onDeleted,
  pronunciations,
  onFetchPronunciations,
  onBack,
}: Props) {
  const [bulk, setBulk] = useState('');
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingPron, setLoadingPron] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState(deckName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 체크된 단어 id들. 여러 개를 한 번에 다른 단어장으로 옮기는 데 쓴다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 이 단어장이 다른 곳(동기화 등)에서 지워지면 목록으로 돌려보낸다.
  useEffect(() => {
    if (!decks.includes(deckName)) onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks, deckName]);

  // 같은 단어장 안에서만 중복을 막는다 — 다른 단어장에 이미 있어도 여기 추가는
  // 허용한다(schema.sql의 words_user_deck_en_uniq와 같은 기준).
  const existing = useMemo(
    () => new Set(words.filter((w) => w.deck === deckName).map((w) => w.en.toLowerCase())),
    [words, deckName],
  );

  const quickCount = useMemo(() => parseBulk(bulk), [bulk]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words
      .filter((w) => w.deck === deckName)
      .filter((w) =>
        q ? w.en.toLowerCase().includes(q) || w.ko.some((m) => m.includes(query.trim())) : true,
      )
      .slice()
      .reverse(); // 최근에 넣은 단어가 위로
  }, [words, deckName, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((w) => selected.has(w.id));

  const pronMissing = useMemo(
    () => missingFromCache(visible.map((w) => w.en), pronunciations).length,
    [visible, pronunciations],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void onFetchPronunciations(visible), 400);
    return () => window.clearTimeout(t);
  }, [visible, onFetchPronunciations]);

  async function loadPronunciations() {
    setLoadingPron(true);
    setNotice('');
    try {
      await onFetchPronunciations(visible);
    } finally {
      setLoadingPron(false);
    }
  }

  function openReview() {
    const parsed = parseBulk(bulk);
    const rows: ReviewRow[] = [
      ...parsed.rows.map((r, i) => ({
        id: `p${i}`,
        en: r.en,
        ko: r.ko,
        checked: !existing.has(r.en.toLowerCase()),
        corrected: r.corrected,
      })),
      ...parsed.skipped.map((raw, i) => {
        const guess = guessSplit(raw);
        return {
          id: `s${i}`,
          en: guess.en,
          ko: guess.ko,
          checked: false,
          raw,
        };
      }),
    ];
    setReviewRows(rows);
    setNotice('');
  }

  function commitReview(selectedRows: { en: string; ko: string }[]) {
    if (selectedRows.length === 0) return;

    const seen = new Set(existing);
    const added: Word[] = [];
    let blocked = 0;
    for (const r of selectedRows) {
      const key = r.en.toLowerCase();
      if (seen.has(key)) {
        blocked++;
        continue;
      }
      seen.add(key);
      added.push(makeWord(r.en, [r.ko], deckName));
    }

    setWords((prev) => [...prev, ...added]);
    setBulk('');
    setReviewRows(null);
    setNotice(`${added.length}개 추가${blocked ? ` · 중복 ${blocked}개 건너뜀` : ''}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulk(String(reader.result ?? ''));
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function update(id: string, patch: Partial<Word>) {
    setWords((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)),
    );
  }

  function remove(id: string) {
    const now = Date.now();
    setWords((prev) =>
      prev.map((w) => (w.id === id ? { ...w, deletedAt: now, updatedAt: now } : w)),
    );
  }

  const wordCountInDeck = words.filter((w) => w.deck === deckName).length;

  function doDeleteDeck() {
    if (wordCountInDeck > 0) {
      const now = Date.now();
      setWords((prev) =>
        prev.map((w) => (w.deck === deckName ? { ...w, deletedAt: now, updatedAt: now } : w)),
      );
    }
    setConfirmingDelete(false);
    onDeleted(deckName);
  }

  function startRename() {
    setRenameInput(deckName);
    setNotice('');
    setRenaming(true);
  }

  function submitRename() {
    const res = onRenameDeck(deckName, renameInput);
    if (!res.ok) {
      setNotice(res.error ?? '이름을 바꾸지 못했습니다.');
      return;
    }
    setRenaming(false);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const w of visible) next.delete(w.id);
      } else {
        for (const w of visible) next.add(w.id);
      }
      return next;
    });
  }

  function bulkMove() {
    if (selected.size === 0 || !bulkTarget) return;
    const count = selected.size;
    setWords((prev) =>
      prev.map((w) =>
        selected.has(w.id) ? { ...w, deck: bulkTarget, updatedAt: Date.now() } : w,
      ),
    );
    setNotice(`${count}개를 "${bulkTarget}"(으)로 옮겼습니다`);
    setSelected(new Set());
    setBulkTarget('');
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 단어장
        </button>
        {renaming ? (
          <div className="row deck-rename-row">
            <input
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
              autoFocus
            />
            <button className="btn primary sm" onClick={submitRename}>
              저장
            </button>
            <button className="btn ghost sm" onClick={() => setRenaming(false)}>
              취소
            </button>
          </div>
        ) : (
          <h2 className="deck-detail-title" onClick={startRename} title="눌러서 이름 바꾸기">
            {deckName}
          </h2>
        )}
        <div className="topbar-right">
          <button className="btn danger sm" onClick={() => setConfirmingDelete(true)}>
            단어장 삭제
          </button>
        </div>
      </div>

      {notice && (
        <p className="notice-bar" role="status">
          {notice}
        </p>
      )}

      {confirmingDelete && (
        <ConfirmModal
          message={`"${deckName}" 단어장을 삭제하시겠습니까?${
            wordCountInDeck > 0 ? ` 단어 ${wordCountInDeck}개도 함께 휴지통으로 이동합니다.` : ''
          }`}
          danger
          onConfirm={doDeleteDeck}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <section className="card">
        <h3>단어 추가</h3>
        <p className="muted">
          엑셀에서 두 열(영단어 / 뜻)을 복사해 그대로 붙여넣으세요. 구분자가 없거나 한글이 앞에
          와도, 폰 카메라로 찍은 종이 단어장을 OCR로 뽑은 텍스트라도 자동으로 분류합니다.{' '}
          <code>.csv</code> · <code>.txt</code> 파일도 됩니다.
        </p>

        <div className="row">
          {!reviewRows && (
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              파일 불러오기
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            hidden
            onChange={onFile}
          />
        </div>

        {reviewRows ? (
          <ImportReview
            rows={reviewRows}
            existingLower={existing}
            onChange={setReviewRows}
            onCommit={commitReview}
            onCancel={() => setReviewRows(null)}
          />
        ) : (
          <>
            <textarea
              className="bulk"
              rows={8}
              value={bulk}
              onChange={(e) => {
                setBulk(e.target.value);
                setNotice('');
              }}
              placeholder={SAMPLE}
              spellCheck={false}
            />
            <button className="btn primary" disabled={!bulk.trim()} onClick={openReview}>
              {bulk.trim()
                ? `검토하기 (${quickCount.rows.length}줄 인식${
                    quickCount.skipped.length ? ` · ${quickCount.skipped.length}줄 확인 필요` : ''
                  })`
                : '검토하기'}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h3>단어 직접 추가</h3>
        <p className="muted">
          한 단어에 뜻을 여러 개 붙이고 싶을 때 쓴다. 퀴즈에서는 순서대로 1, 2, 3…으로 보여준다.
        </p>

        <AddWordForm
          decks={decks}
          deck={deckName}
          onDeckChange={() => {}}
          hideDeckPicker
          existing={existing}
          onAdd={(word) => setWords((prev) => [...prev, word])}
          onNotice={setNotice}
        />
      </section>

      <section className="card">
        <div className="row between">
          <h3>등록된 단어 {visible.length}개</h3>
          <div className="row wrap">
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색 (영단어 / 뜻)"
            />
            {pronMissing > 0 && (
              <button
                className="btn ghost sm"
                disabled={loadingPron}
                onClick={loadPronunciations}
                title="이미 조회된 적 있는 단어는 화면을 열 때 자동으로 채워진다. 이 버튼은 아직 아무도 조회한 적 없는 새 단어를 위한 것이다(로그인 필요)."
              >
                {loadingPron ? '확인 중…' : `새 단어 발음 확인 (${pronMissing})`}
              </button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="muted">아직 등록된 단어가 없습니다.</p>
        ) : (
          <table className="word-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="보이는 단어 전체 선택"
                  />
                </th>
                <th>영단어</th>
                <th>발음</th>
                <th>뜻</th>
                <th>단어장</th>
                <th>정답률</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => (
                <tr key={w.id} className={selected.has(w.id) ? 'row-selected' : ''}>
                  <td className="checkbox-col">
                    <input
                      type="checkbox"
                      checked={selected.has(w.id)}
                      onChange={() => toggleSelected(w.id)}
                      aria-label={`${w.en} 선택`}
                    />
                  </td>
                  <td>
                    <input
                      value={w.en}
                      onChange={(e) => update(w.id, { en: e.target.value })}
                      className="cell en"
                    />
                  </td>
                  <td className="nowrap">
                    <PronounceButton pron={lookupCache(w.en, pronunciations)} size="sm" />
                  </td>
                  <td>
                    <input
                      value={w.ko.join(' / ')}
                      onChange={(e) =>
                        update(w.id, {
                          ko: e.target.value
                            .split('/')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="cell"
                      title="뜻이 여러 개면 / 로 구분 (예: 이용하다 / 위업, 공적)"
                    />
                  </td>
                  <td className="nowrap">
                    <select value={w.deck} onChange={(e) => update(w.id, { deck: e.target.value })}>
                      {decks.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="nowrap muted">
                    {w.stats.seen === 0
                      ? '—'
                      : `${Math.round((w.stats.correct / w.stats.seen) * 100)}% (${w.stats.seen})`}
                  </td>
                  <td>
                    <button className="btn danger sm" onClick={() => remove(w.id)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected.size > 0 && (
        <div className="bulk-move-bar">
          <span>
            <b>{selected.size}개</b> 선택됨
          </span>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>
            <option value="">다른 단어장으로 이동</option>
            {decks
              .filter((d) => d !== deckName)
              .map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
          </select>
          <button className="btn primary sm" disabled={!bulkTarget} onClick={bulkMove}>
            이동
          </button>
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}
    </div>
  );
}
