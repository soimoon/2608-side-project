interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** 좁은 자리(단어장 관리 표 안 등)에서는 살짝 더 촘촘하게. */
  size?: 'md' | 'sm';
}

/**
 * 뜻 여러 개를 "1. 2. 3…" 번호 매긴 줄로 넣고 빼는 공용 에디터. AddWordForm(새로
 * 등록할 때)·단어장 관리 표(이미 있는 단어 수정)·단어장 보기 편집 모드, 세 곳에서
 * 그대로 재사용한다 — 예전엔 단어장 관리 표만 "이용하다 / 위업, 공적"처럼 "/"로
 * 구분한 한 줄 입력이었는데, 사용자에게 구분자 규칙을 설명해야 하고("/"가 뭔지
 * 몰라도 되게) 매 입력마다 join/split/trim이 도는 통에 문장 중간에 스페이스를
 * 쳐도 그 자리에서 바로 지워지는 버그(trim이 방금 친 공백까지 지움)까지 있어서,
 * 등록 폼과 완전히 같은 방식으로 통일했다.
 */
export default function KoEditor({ value, onChange, size = 'md' }: Props) {
  // 빈 배열이 넘어올 일은 없어야 하지만(단어는 항상 뜻이 하나 이상), 방어적으로 처리.
  const list = value.length > 0 ? value : [''];

  function updateAt(i: number, v: string) {
    onChange(list.map((m, idx) => (idx === i ? v : m)));
  }

  function add() {
    onChange([...list, '']);
  }

  function removeAt(i: number) {
    if (list.length <= 1) return;
    onChange(list.filter((_, idx) => idx !== i));
  }

  return (
    <div className={`manual-ko-list ${size === 'sm' ? 'sm' : ''}`}>
      {list.map((m, i) => (
        <div className="row manual-ko-row" key={i}>
          <span className="ko-index">{i + 1}</span>
          <input
            className="cell"
            value={m}
            onChange={(e) => updateAt(i, e.target.value)}
            placeholder={i === 0 ? '뜻 (예: 이용하다)' : '또 다른 뜻'}
          />
          {list.length > 1 && (
            <button type="button" className="btn ghost sm" onClick={() => removeAt(i)}>
              삭제
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={add}>
        + 뜻 추가
      </button>
    </div>
  );
}
