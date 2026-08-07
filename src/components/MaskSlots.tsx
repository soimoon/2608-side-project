interface Props {
  /** 마스킹할 원문(영단어). 공백은 별도 slot.space로, 나머지 글자는 슬롯 하나씩. */
  text: string;
  /** text와 같은 길이. i번째 글자가 공개돼 있는지. */
  revealed: boolean[];
  /** true면 revealed와 무관하게 전부 글자를 보여준다 — 솔로 퀴즈가 채점 후(retype·
   *  feedback 단계) 정답을 그 자리에 그대로 드러낼 때 쓴다. 단체게임은 안 쓴다
   *  (정답 공개는 별도 reveal 화면이 담당하고, 문제 풀이 중엔 항상 마스킹 유지). */
  revealAll?: boolean;
}

/**
 * QuizScreen(솔로)과 GroupQuizScreen(단체게임)이 글자 단위로 똑같이 쓰던 마스크 슬롯
 * JSX를 뽑아낸 표현 컴포넌트. 타이밍·힌트 계산(mask.ts/groupMask.ts)은 각 화면에
 * 그대로 남아 있다 — 여기는 결과만 그린다.
 */
export default function MaskSlots({ text, revealed, revealAll }: Props) {
  return (
    <div className="mask" aria-label={`${text.length}글자`}>
      {[...text].map((ch, i) =>
        ch === ' ' ? (
          <span key={i} className="slot space" />
        ) : (
          <span key={i} className={`slot ${revealed[i] ? 'shown' : ''}`}>
            {revealAll || revealed[i] ? ch : ''}
          </span>
        ),
      )}
    </div>
  );
}
