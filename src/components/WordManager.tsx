import { useMemo, useRef, useState } from 'react';
import type { Pronunciation, Word } from '../types';
import { guessSplit, parseBulk } from '../lib/parse';
import { DEFAULT_DECK, download, exportCSV, exportWordsJSON, makeWord } from '../lib/storage';
import { lookupCache, missingFromCache } from '../lib/pronounce';
import ImportReview, { type ReviewRow } from './ImportReview';
import PronounceButton from './PronounceButton';

const SAMPLE = `synthesize\t통합하다, 종합하다
ubiquitous\t어디에나 있는
2. mitigate - 완화하다
분명한  apparent`;

interface Props {
  words: Word[];
  setWords: (updater: (prev: Word[]) => Word[]) => void;
  /** 단어에서 드러나는 단어장 + 미리 만들어 둔 빈 단어장을 합친 전체 목록. */
  decks: string[];
  /** 단어 없이 빈 단어장만 미리 만들어 둔다. */
  onCreateDeck: (name: string) => void;
  /** "이 단어장 삭제" 시 목록에서도 완전히 지운다. */
  onRemoveDeckName: (name: string) => void;
  pronunciations: Record<string, Pronunciation>;
  /** 아직 캐시에 없는 단어의 발음을 받아온다. 로그인·설정이 없으면 아무 일도 하지 않는다. */
  onFetchPronunciations: (targets: Word[]) => Promise<void>;
  onBack: () => void;
}

export default function WordManager({
  words,
  setWords,
  decks,
  onCreateDeck,
  onRemoveDeckName,
  pronunciations,
  onFetchPronunciations,
  onBack,
}: Props) {
  const [bulk, setBulk] = useState('');
  const [deck, setDeck] = useState(DEFAULT_DECK);
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [filterDeck, setFilterDeck] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingPron, setLoadingPron] = useState(false);
  const [manualEn, setManualEn] = useState('');
  // "+ 뜻 추가" 버튼을 누를 때마다 빈 칸이 하나씩 늘어난다.
  const [manualKo, setManualKo] = useState<string[]>(['']);
  const [newDeckName, setNewDeckName] = useState('');
  // 체크된 단어 id들. 여러 개를 한 번에 다른 단어장으로 옮기는 데 쓴다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => new Set(words.map((w) => w.en.toLowerCase())), [words]);

  // 검수 화면을 열기 전, 붙여넣은 텍스트에서 몇 줄이나 인식되는지 버튼에 미리 보여준다.
  const quickCount = useMemo(() => parseBulk(bulk), [bulk]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words
      .filter((w) => (filterDeck ? w.deck === filterDeck : true))
      .filter((w) =>
        q ? w.en.toLowerCase().includes(q) || w.ko.some((m) => m.includes(query.trim())) : true,
      )
      .slice()
      .reverse(); // 최근에 넣은 단어가 위로
  }, [words, query, filterDeck]);

  const allVisibleSelected = visible.length > 0 && visible.every((w) => selected.has(w.id));

  // 지금 보이는 목록 중 아직 발음을 안 받아온 단어 수.
  const pronMissing = useMemo(
    () => missingFromCache(visible.map((w) => w.en), pronunciations).length,
    [visible, pronunciations],
  );

  async function loadPronunciations() {
    setLoadingPron(true);
    setNotice('');
    try {
      await onFetchPronunciations(visible);
    } finally {
      setLoadingPron(false);
    }
  }

  /**
   * 붙여넣은 텍스트를 검수 테이블로 옮긴다. 이 시점부터 텍스트박스와는 분리된
   * 독립 상태가 되므로, 표에서 글자를 고쳐도 원본 붙여넣기 내용에는 영향이 없다.
   */
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
    const target = deck.trim() || DEFAULT_DECK;

    // 검수 표를 여는 사이 단어 관리 표에서 같은 단어가 등록됐을 수 있고,
    // 검수 표 안에서 두 줄을 같은 철자로 고쳤을 수도 있다. 등록 직전에 한 번 더 막는다.
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
      added.push(makeWord(r.en, [r.ko], target));
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
    e.target.value = ''; // 같은 파일을 다시 고를 수 있게 초기화
  }

  function update(id: string, patch: Partial<Word>) {
    setWords((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)),
    );
  }

  // 실제로 지우지 않고 deletedAt만 찍는다. 다른 기기가 아직 이 단어를 동기화하지
  // 못한 상태에서 push하면, 진짜 삭제는 그 기기가 다음에 pull할 때 되살려 버린다.
  function remove(id: string) {
    const now = Date.now();
    setWords((prev) =>
      prev.map((w) => (w.id === id ? { ...w, deletedAt: now, updatedAt: now } : w)),
    );
  }

  function removeDeck(name: string) {
    const n = words.filter((w) => w.deck === name).length;
    if (n > 0 && !confirm(`단어장 "${name}"의 단어 ${n}개를 모두 삭제합니다. 계속할까요?`)) return;
    if (n > 0) {
      const now = Date.now();
      setWords((prev) =>
        prev.map((w) => (w.deck === name ? { ...w, deletedAt: now, updatedAt: now } : w)),
      );
    }
    onRemoveDeckName(name);
    if (filterDeck === name) setFilterDeck('');
  }

  function createDeck() {
    const name = newDeckName.trim();
    if (!name) return;
    if (decks.includes(name)) {
      setNotice(`이미 있는 단어장입니다: ${name}`);
      return;
    }
    onCreateDeck(name);
    setNewDeckName('');
    setNotice(`단어장 "${name}" 생성됨 (아직 빈 단어장)`);
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

  function updateManualMeaning(i: number, value: string) {
    setManualKo((prev) => prev.map((m, idx) => (idx === i ? value : m)));
  }

  function addManualMeaning() {
    setManualKo((prev) => [...prev, '']);
  }

  function removeManualMeaning(i: number) {
    setManualKo((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function submitManualWord() {
    const en = manualEn.trim();
    const ko = manualKo.map((m) => m.trim()).filter(Boolean);
    if (!en || ko.length === 0) return;
    if (existing.has(en.toLowerCase())) {
      setNotice(`이미 등록된 단어입니다: ${en}`);
      return;
    }
    const target = deck.trim() || DEFAULT_DECK;
    setWords((prev) => [...prev, makeWord(en, ko, target)]);
    setManualEn('');
    setManualKo(['']);
    setNotice(`"${en}" 추가됨 (뜻 ${ko.length}개)`);
  }

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

      <section className="card">
        <h3>단어 추가</h3>
        <p className="muted">
          엑셀에서 두 열(영단어 / 뜻)을 복사해 그대로 붙여넣으세요. 구분자가 없거나 한글이 앞에
          와도, 폰 카메라로 찍은 종이 단어장을 OCR로 뽑은 텍스트라도 자동으로 분류합니다.{' '}
          <code>.csv</code> · <code>.txt</code> 파일도 됩니다.
        </p>

        <div className="row">
          <label className="field">
            <span>단어장</span>
            <input
              list="deck-list"
              value={deck}
              onChange={(e) => setDeck(e.target.value)}
              placeholder="예: 토플 초록책 Day 1"
            />
            <datalist id="deck-list">
              {decks.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
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
            {notice && <span className="notice">{notice}</span>}
          </>
        )}
      </section>

      <section className="card">
        <h3>단어 직접 추가</h3>
        <p className="muted">
          한 단어에 뜻을 여러 개 붙이고 싶을 때 쓴다. 퀴즈에서는 순서대로 1, 2, 3…으로 보여준다.
        </p>

        <div className="row wrap">
          <label className="field">
            <span>영단어</span>
            <input
              value={manualEn}
              onChange={(e) => setManualEn(e.target.value)}
              placeholder="예: exploit"
            />
          </label>
          <label className="field">
            <span>단어장</span>
            <input list="deck-list" value={deck} onChange={(e) => setDeck(e.target.value)} />
          </label>
        </div>

        <div className="manual-ko-list">
          {manualKo.map((m, i) => (
            <div className="row manual-ko-row" key={i}>
              <span className="ko-index">{i + 1}</span>
              <input
                className="cell"
                value={m}
                onChange={(e) => updateManualMeaning(i, e.target.value)}
                placeholder={i === 0 ? '뜻 (예: 이용하다)' : '또 다른 뜻'}
              />
              {manualKo.length > 1 && (
                <button className="btn ghost sm" onClick={() => removeManualMeaning(i)}>
                  삭제
                </button>
              )}
            </div>
          ))}
          <button className="btn ghost sm" onClick={addManualMeaning}>
            + 뜻 추가
          </button>
        </div>

        <button
          className="btn primary"
          disabled={!manualEn.trim() || manualKo.every((m) => !m.trim())}
          onClick={submitManualWord}
        >
          등록
        </button>
      </section>

      <section className="card">
        <h3>단어장 생성</h3>
        <p className="muted">단어를 등록하지 않고 빈 단어장만 미리 만들어 둘 수 있다.</p>
        <div className="row">
          <input
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            placeholder="예: 토플 초록책 Day 3"
          />
          <button className="btn ghost" disabled={!newDeckName.trim()} onClick={createDeck}>
            단어장 생성
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h3>등록된 단어 {words.length}개</h3>
          <div className="row wrap">
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색 (영단어 / 뜻)"
            />
            <select value={filterDeck} onChange={(e) => setFilterDeck(e.target.value)}>
              <option value="">전체 단어장</option>
              {decks.map((d) => (
                <option key={d} value={d}>
                  {d} ({words.filter((w) => w.deck === d).length})
                </option>
              ))}
            </select>
            {pronMissing > 0 && (
              <button className="btn ghost sm" disabled={loadingPron} onClick={loadPronunciations}>
                {loadingPron ? '발음 불러오는 중…' : `발음 불러오기 (${pronMissing})`}
              </button>
            )}
            {filterDeck && (
              <button className="btn danger sm" onClick={() => removeDeck(filterDeck)}>
                이 단어장 삭제
              </button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="muted">표시할 단어가 없습니다.</p>
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
            <option value="">단어장 선택</option>
            {decks.map((d) => (
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
