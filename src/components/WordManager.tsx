import { useMemo, useRef, useState } from 'react';
import type { Word } from '../types';
import { parseBulk } from '../lib/parse';
import { DEFAULT_DECK, download, exportCSV, exportWordsJSON, makeWord } from '../lib/storage';
import { deckNames } from '../lib/select';

const SAMPLE = `synthesize\t통합하다, 종합하다
ubiquitous\t어디에나 있는
2. mitigate - 완화하다
분명한  apparent`;

interface Props {
  words: Word[];
  setWords: (updater: (prev: Word[]) => Word[]) => void;
  onBack: () => void;
}

export default function WordManager({ words, setWords, onBack }: Props) {
  const [bulk, setBulk] = useState('');
  const [deck, setDeck] = useState(DEFAULT_DECK);
  const [query, setQuery] = useState('');
  const [filterDeck, setFilterDeck] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const decks = useMemo(() => deckNames(words), [words]);
  const existing = useMemo(() => new Set(words.map((w) => w.en.toLowerCase())), [words]);

  const preview = useMemo(() => parseBulk(bulk), [bulk]);
  const newRows = useMemo(
    () => preview.rows.filter((r) => !existing.has(r.en.toLowerCase())),
    [preview, existing],
  );
  const dupCount = preview.rows.length - newRows.length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words
      .filter((w) => (filterDeck ? w.deck === filterDeck : true))
      .filter((w) => (q ? w.en.toLowerCase().includes(q) || w.ko.includes(query.trim()) : true))
      .slice()
      .reverse(); // 최근에 넣은 단어가 위로
  }, [words, query, filterDeck]);

  function commitImport() {
    if (newRows.length === 0) return;
    const target = deck.trim() || DEFAULT_DECK;
    const added = newRows.map((r) => makeWord(r.en, r.ko, target));
    setWords((prev) => [...prev, ...added]);
    setBulk('');
    setNotice(
      `${added.length}개 추가${dupCount ? ` · 중복 ${dupCount}개 건너뜀` : ''}` +
        `${preview.skipped.length ? ` · 인식 실패 ${preview.skipped.length}줄` : ''}`,
    );
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
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  function remove(id: string) {
    setWords((prev) => prev.filter((w) => w.id !== id));
  }

  function removeDeck(name: string) {
    const n = words.filter((w) => w.deck === name).length;
    if (!confirm(`단어장 "${name}"의 단어 ${n}개를 모두 삭제합니다. 계속할까요?`)) return;
    setWords((prev) => prev.filter((w) => w.deck !== name));
    if (filterDeck === name) setFilterDeck('');
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
          와도 자동으로 분류합니다. <code>.csv</code> · <code>.txt</code> 파일도 됩니다.
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
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            파일 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            hidden
            onChange={onFile}
          />
        </div>

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

        {bulk.trim() && (
          <div className="preview">
            <div className="preview-head">
              <b>{newRows.length}개</b> 추가 예정
              {dupCount > 0 && <span className="tag warn">중복 {dupCount}</span>}
              {preview.skipped.length > 0 && (
                <span className="tag err">인식 실패 {preview.skipped.length}</span>
              )}
            </div>
            <ul className="preview-list">
              {newRows.slice(0, 8).map((r, i) => (
                <li key={i}>
                  <span className="en">{r.en}</span>
                  <span className="ko">{r.ko}</span>
                </li>
              ))}
              {newRows.length > 8 && <li className="muted">… 외 {newRows.length - 8}개</li>}
            </ul>
            {preview.skipped.length > 0 && (
              <details className="skipped">
                <summary>인식하지 못한 줄 보기</summary>
                <ul>
                  {preview.skipped.slice(0, 20).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <button className="btn primary" disabled={newRows.length === 0} onClick={commitImport}>
          {newRows.length}개 추가
        </button>
        {notice && <span className="notice">{notice}</span>}
      </section>

      <section className="card">
        <div className="row between">
          <h3>등록된 단어 {words.length}개</h3>
          <div className="row">
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
                <th>영단어</th>
                <th>뜻</th>
                <th>단어장</th>
                <th>정답률</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => (
                <tr key={w.id}>
                  <td>
                    <input
                      value={w.en}
                      onChange={(e) => update(w.id, { en: e.target.value })}
                      className="cell en"
                    />
                  </td>
                  <td>
                    <input
                      value={w.ko}
                      onChange={(e) => update(w.id, { ko: e.target.value })}
                      className="cell"
                    />
                  </td>
                  <td className="nowrap muted">{w.deck}</td>
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
    </div>
  );
}
