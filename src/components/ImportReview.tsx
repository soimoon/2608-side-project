import { useMemo } from 'react';

export interface ReviewRow {
  id: string;
  en: string;
  ko: string;
  checked: boolean;
  /** parse.ts가 자동 보정했을 때 남긴 사람이 읽을 메모. 있으면 반드시 눈에 띄게 표시한다. */
  corrected?: string[];
  /** 자동 파싱에 실패해 guessSplit()로 초안만 채운 줄. 원문을 보여줘 직접 확인하게 한다. */
  raw?: string;
}

interface Props {
  rows: ReviewRow[];
  /** 이미 등록된 단어 (소문자). 중복 행은 등록 대상에서 제외한다. */
  existingLower: Set<string>;
  onChange: (rows: ReviewRow[]) => void;
  onCommit: (rows: { en: string; ko: string }[]) => void;
  onCancel: () => void;
}

/** 체크 여부와 무관하게, 지금 이 행이 등록 가능한 상태인지. */
function isValid(r: ReviewRow, existingLower: Set<string>): boolean {
  const en = r.en.trim();
  const ko = r.ko.trim();
  if (!en || !ko) return false;
  return !existingLower.has(en.toLowerCase());
}

export default function ImportReview({ rows, existingLower, onChange, onCommit, onCancel }: Props) {
  const correctedCount = useMemo(() => rows.filter((r) => r.corrected?.length).length, [rows]);
  const needsReviewCount = useMemo(() => rows.filter((r) => r.raw).length, [rows]);
  const dupCount = useMemo(
    () => rows.filter((r) => r.en.trim() && existingLower.has(r.en.trim().toLowerCase())).length,
    [rows, existingLower],
  );
  const selectedCount = useMemo(
    () => rows.filter((r) => r.checked && isValid(r, existingLower)).length,
    [rows, existingLower],
  );

  function patch(id: string, p: Partial<ReviewRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function selectAll(on: boolean) {
    onChange(rows.map((r) => ({ ...r, checked: on && isValid(r, existingLower) })));
  }

  function commit() {
    const chosen = rows.filter((r) => r.checked && isValid(r, existingLower));
    onCommit(chosen.map((r) => ({ en: r.en.trim(), ko: r.ko.trim() })));
  }

  return (
    <div className="review">
      <div className="review-summary">
        <span>
          <b>{rows.length}</b>줄 검토 중
        </span>
        {correctedCount > 0 && <span className="tag warn">자동 보정 {correctedCount}</span>}
        {needsReviewCount > 0 && <span className="tag err">직접 확인 필요 {needsReviewCount}</span>}
        {dupCount > 0 && <span className="tag">중복 {dupCount}</span>}
      </div>

      <div className="row">
        <button className="btn ghost sm" onClick={() => selectAll(true)}>
          전체 선택
        </button>
        <button className="btn ghost sm" onClick={() => selectAll(false)}>
          전체 해제
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="muted">남은 줄이 없습니다.</p>
      ) : (
        <div className="review-list">
          {rows.map((r) => {
            const dup = Boolean(r.en.trim() && existingLower.has(r.en.trim().toLowerCase()));
            const empty = !r.en.trim() || !r.ko.trim();
            const disabled = dup || empty;
            return (
              <div
                key={r.id}
                className={`review-row ${r.corrected?.length ? 'corrected' : ''} ${dup ? 'dup' : ''}`}
              >
                <div className="review-row-main">
                  <input
                    type="checkbox"
                    checked={r.checked && !disabled}
                    disabled={disabled}
                    onChange={(e) => patch(r.id, { checked: e.target.checked })}
                    title={dup ? '이미 등록된 단어입니다' : empty ? '영단어와 뜻을 모두 입력하세요' : ''}
                  />
                  <input
                    className="cell en"
                    value={r.en}
                    placeholder="영단어"
                    onChange={(e) => patch(r.id, { en: e.target.value })}
                  />
                  <input
                    className="cell"
                    value={r.ko}
                    placeholder="뜻"
                    onChange={(e) => patch(r.id, { ko: e.target.value })}
                  />
                  <div className="review-tags">
                    {dup && <span className="tag">중복</span>}
                    {r.corrected?.length ? <span className="tag warn">자동 보정</span> : null}
                    {r.raw && <span className="tag err">확인 필요</span>}
                  </div>
                  <button className="btn ghost sm" onClick={() => removeRow(r.id)}>
                    삭제
                  </button>
                </div>
                {r.raw && <p className="review-note muted">원문: {r.raw}</p>}
                {r.corrected?.length ? (
                  <p className="review-note muted">{r.corrected.join(' · ')}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="row between">
        <button className="btn ghost" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" disabled={selectedCount === 0} onClick={commit}>
          선택한 {selectedCount}개 등록
        </button>
      </div>
    </div>
  );
}
