interface Props {
  wordCount: number;
  onStudy: () => void;
  onManage: () => void;
}

/** "단어장" 탭 진입점. 훑어보기(읽기 전용)와 관리(등록·수정)로 갈린다. */
export default function WordsHub({ wordCount, onStudy, onManage }: Props) {
  return (
    <div className="screen">
      <header className="hero">
        <h1>단어장</h1>
        <p className="sub">
          {wordCount > 0 ? `등록된 단어 ${wordCount}개` : '아직 등록된 단어가 없습니다.'}
        </p>
      </header>

      <div className="home-actions">
        <button className="btn primary lg" onClick={onStudy} disabled={wordCount === 0}>
          단어장 보기
        </button>
        <button className="btn ghost lg" onClick={onManage}>
          단어장 관리
        </button>
      </div>
    </div>
  );
}
