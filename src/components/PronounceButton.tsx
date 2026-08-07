import type { Pronunciation } from '../types';
import { playAudio } from '../lib/pronounce';
import Icon from './Icon';

interface Props {
  pron?: Pronunciation;
  /** 발음기호까지 함께 보여줄지. 좁은 표에서는 끈다. */
  showPhonetic?: boolean;
  size?: 'sm' | 'md';
}

/**
 * 발음 재생 버튼.
 *
 * 아직 조회 전(pron === undefined)이면 아무것도 그리지 않는다 — 로딩 자리표시자가
 * 깜빡이면 타이머 퀴즈에서 시선을 뺏는다.
 *
 * MW에 음원이 없으면(source === 'none' 또는 audioUrl 없음) TTS로 대체하지 않고
 * "발음 없음"이라고 밝힌다. 합성 발음을 진짜처럼 들려주면 사용자가 틀린 발음을
 * 외우게 되고, 그건 이 앱이 하려는 일과 정반대다.
 *
 * 다만 baseWord가 있으면 예외다 — successively처럼 "-ly/-ing로 규칙적으로 파생된
 * 단어라 MW조차 별도 녹음을 안 둔" 경우, 원형 단어(successive)의 진짜 MW 녹음을
 * 대신 들려준다. 합성음이 아니라 실제 사전 녹음이고, 어느 단어의 것인지 라벨로
 * 명확히 밝히므로 "틀린 발음을 진짜처럼" 들려주는 문제가 없다.
 */
export default function PronounceButton({ pron, showPhonetic = true, size = 'md' }: Props) {
  if (!pron) return null;

  const phonetic = showPhonetic && pron.ipa ? pron.ipa : null;
  // Learner's는 국제음성기호(IPA), Collegiate는 MW 자체 표기 — 어느 쪽인지 밝혀 준다.
  const notationLabel = pron.source === 'collegiate' ? 'MW 표기' : 'IPA';
  const baseNote = pron.baseWord ? `"${pron.baseWord}"의 발음` : null;

  if (!pron.audioUrl) {
    return (
      <span className={`pron ${size}`}>
        {phonetic && (
          <span className="pron-ipa" title={notationLabel}>
            {phonetic}
          </span>
        )}
        {/* correspondingly처럼 원형(corresponding) 자체도 MW에 음원 없이 발음기호만
         *  실려 있는 드문 경우 — 재생 버튼은 못 주지만 누구 발음기호인지는 밝혀 준다. */}
        {baseNote && (
          <span
            className="pron-base muted"
            title={`"${pron.en}"은(는) "${pron.baseWord}"에서 규칙적으로 파생된 단어라 발음도 사실상 같습니다`}
          >
            {baseNote}
          </span>
        )}
        <span
          className="pron-none muted"
          title="Merriam-Webster 사전에서 확인했지만 이 단어(숙어 등)는 별도 발음 녹음이 없습니다"
        >
          발음 없음
        </span>
      </span>
    );
  }

  return (
    <span className={`pron ${size}`}>
      <button
        type="button"
        className="pron-play"
        onClick={(e) => {
          // 퀴즈 화면에서 입력칸 포커스를 뺏기지 않도록.
          e.preventDefault();
          e.currentTarget.blur();
          playAudio(pron.audioUrl!);
        }}
        title={`발음 듣기 (미국식${phonetic ? ` · ${notationLabel} ${phonetic}` : ''}${baseNote ? ` · ${baseNote}` : ''})`}
        aria-label={`${pron.en} 발음 듣기${baseNote ? ` (${baseNote})` : ''}`}
      >
        <Icon name="speaker" />
      </button>
      {phonetic && (
        <span className="pron-ipa" title={notationLabel}>
          {phonetic}
        </span>
      )}
      {baseNote && (
        <span
          className="pron-base muted"
          title={`"${pron.en}"은(는) "${pron.baseWord}"에서 규칙적으로 파생된 단어라 발음도 사실상 같습니다`}
        >
          {baseNote}
        </span>
      )}
    </span>
  );
}
