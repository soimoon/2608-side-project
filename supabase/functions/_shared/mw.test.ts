import { describe, expect, it } from 'vitest';
import { audioSubdirectory, audioUrl, extractPronunciation, lookupUrl } from './mw';

describe('audioSubdirectory (MW가 정한 규칙)', () => {
  it('bix로 시작하면 bix', () => {
    expect(audioSubdirectory('bixcuit01')).toBe('bix');
  });
  it('gg로 시작하면 gg', () => {
    expect(audioSubdirectory('ggabby01')).toBe('gg');
  });
  it('숫자나 기호로 시작하면 number', () => {
    expect(audioSubdirectory('3d000001')).toBe('number');
    expect(audioSubdirectory('_ampers')).toBe('number');
  });
  it('그 외에는 첫 글자', () => {
    expect(audioSubdirectory('pajama02')).toBe('p');
    expect(audioSubdirectory('synthe02')).toBe('s');
  });
});

describe('audioUrl', () => {
  it('MW 문서의 예시와 정확히 일치한다', () => {
    expect(audioUrl('pajama02')).toBe(
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/p/pajama02.mp3',
    );
  });
  it('number 디렉터리도 올바르게 만든다', () => {
    expect(audioUrl('3d000001')).toBe(
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/number/3d000001.mp3',
    );
  });
});

describe('extractPronunciation', () => {
  // dictionaryapi.com에 실제로 조회해 받은 응답 그대로 (2026-08, Learner's Dictionary).
  const realAcuteEntry = {
    meta: { id: 'acute' },
    hwi: { hw: 'acute', prs: [{ ipa: 'əˈkjuːt', sound: { audio: 'acute001' } }] },
  };

  // "synthesize" 실제 응답: hwi에는 prs가 아예 없고, 철자 변형(vrs, 영국식 "synthesise")
  // 쪽에만 발음이 실려 있다 — 처음엔 이걸 놓쳐서 흔한 단어가 통째로 "발음 없음"이 됐다.
  const realSynthesizeEntry = {
    meta: { id: 'synthesize' },
    hwi: { hw: 'syn*the*size' },
    vrs: [
      {
        vl: 'also British',
        va: 'syn*the*sise',
        prs: [{ ipa: 'ˈsɪnθəˌsaɪz', sound: { audio: 'synthe04' } }],
      },
    ],
  };

  const learnersEntry = realSynthesizeEntry;

  it('Learner\'s 응답에서 IPA와 음원 URL을 뽑는다', () => {
    const got = extractPronunciation([realAcuteEntry], 'acute');
    expect(got).toEqual({
      phonetic: 'əˈkjuːt',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/a/acute001.mp3',
    });
  });

  it('본표제어(hwi)에 발음이 없으면 철자 변형(vrs)의 발음으로 대체한다', () => {
    // 이미 headwordOf()로 "이 항목 = synthesize"를 확인한 뒤라, vrs를 써도
    // 엉뚱한 단어 위험 없이 커버리지만 늘어난다. 실제로 -ize/-ise는 소리가 같다.
    const got = extractPronunciation([realSynthesizeEntry], 'synthesize');
    expect(got).toEqual({
      phonetic: 'ˈsɪnθəˌsaɪz',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/synthe04.mp3',
    });
  });

  it('본표제어에 발음이 있으면 vrs보다 그쪽을 우선한다', () => {
    const data = [
      {
        meta: { id: 'acute' },
        hwi: { hw: 'acute', prs: [{ ipa: 'əˈkjuːt', sound: { audio: 'acute001' } }] },
        vrs: [{ va: 'akute', prs: [{ ipa: 'WRONG', sound: { audio: 'wrong' } }] }],
      },
    ];
    expect(extractPronunciation(data, 'acute')?.phonetic).toBe('əˈkjuːt');
  });

  it('Collegiate 응답(mw 표기)도 표기 체계를 붙여 뽑는다', () => {
    const data = [
      {
        meta: { id: 'acute' },
        hwi: { hw: 'acute', prs: [{ mw: 'ə-ˈkyüt', sound: { audio: 'acute001' } }] },
      },
    ];
    const got = extractPronunciation(data, 'acute');
    expect(got?.notation).toBe('mw');
    expect(got?.phonetic).toBe('ə-ˈkyüt');
  });

  it('표제어의 음절 구분 "*"를 무시하고 일치시킨다', () => {
    expect(extractPronunciation([learnersEntry], 'SYNTHESIZE')).not.toBeNull();
  });

  it('동형이의어 번호(meta.id "battle:2")를 떼고 비교한다', () => {
    const data = [
      { meta: { id: 'battle:2' }, hwi: { prs: [{ ipa: 'ˈbætl̟', sound: { audio: 'battle01' } }] } },
    ];
    expect(extractPronunciation(data, 'battle')?.phonetic).toBe('ˈbætl̟');
  });

  // 이 앱에서 가장 나쁜 실패는 "엉뚱한 단어의 발음을 알려주는 것"이라, 아래 경우는
  // 반드시 null이어야 한다. 발음이 없는 것보다 틀린 발음이 훨씬 해롭다.
  it('표제어가 정확히 일치하지 않으면 발음을 주지 않는다', () => {
    const got = extractPronunciation([learnersEntry], 'synthesis');
    expect(got).toBeNull();
  });

  it('철자 추천(문자열 배열)이 오면 발음을 주지 않는다', () => {
    expect(extractPronunciation(['synthesize', 'synthesis'], 'sinthesize')).toBeNull();
  });

  it('빈 응답·잘못된 응답에도 죽지 않고 null을 준다', () => {
    expect(extractPronunciation([], 'acute')).toBeNull();
    expect(extractPronunciation(null, 'acute')).toBeNull();
    expect(extractPronunciation({ nope: true }, 'acute')).toBeNull();
  });

  it('발음 정보가 아예 없는 항목은 건너뛴다', () => {
    const data = [{ meta: { id: 'acute' }, hwi: { hw: 'acute' } }];
    expect(extractPronunciation(data, 'acute')).toBeNull();
  });

  it('음원 없이 발음기호만 있어도 가져온다', () => {
    const data = [{ meta: { id: 'acute' }, hwi: { hw: 'acute', prs: [{ ipa: 'əˈkjut' }] } }];
    const got = extractPronunciation(data, 'acute');
    expect(got?.phonetic).toBe('əˈkjut');
    expect(got?.audioUrl).toBeUndefined();
  });

  it('숙어(공백 포함)도 그대로 일치시킨다', () => {
    const data = [
      { meta: { id: 'give up' }, hwi: { hw: 'give up', prs: [{ ipa: 'ɡɪv ˈʌp' }] } },
    ];
    expect(extractPronunciation(data, 'give up')?.phonetic).toBe('ɡɪv ˈʌp');
  });

  // "quickly"처럼 규칙적으로 파생된 부사는 별도 표제어 없이 기본형(quick)의
  // 굴절형(ins)으로만 실리는 경우가 많다. 이걸 못 읽으면 흔한 -ly 부사가 전부
  // "발음 없음"이 된다.
  it('표제어의 굴절형(ins)에 자체 발음이 있으면 그걸 가져온다', () => {
    const data = [
      {
        meta: { id: 'quick' },
        hwi: { hw: 'quick', prs: [{ ipa: 'ˈkwɪk' }] },
        ins: [{ if: 'quick*ly', prs: [{ ipa: 'ˈkwɪkli', sound: { audio: 'quickl01' } }] }],
      },
    ];
    const got = extractPronunciation(data, 'quickly');
    expect(got).toEqual({
      phonetic: 'ˈkwɪkli',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/q/quickl01.mp3',
    });
  });

  // "successively"/"astoundingly"류 실제 응답 패턴: 굴절형(ins)엔 발음이 없고
  // 표제어(원형)에만 있다. AHD 등 다른 사전도 마찬가지라 이 단어들 자체는 원래
  // 별도 녹음이 없다 — 원형 발음을 baseWord와 함께 폴백으로 준다.
  it('굴절형에 자체 발음이 없으면 표제어(원형) 발음을 baseWord와 함께 폴백으로 준다', () => {
    const data = [
      {
        meta: { id: 'successive' },
        hwi: { hw: 'suc*ces*sive', prs: [{ ipa: 'səkˈsɛsɪv', sound: { audio: 'success03' } }] },
        ins: [{ if: 'suc*ces*sive*ly' }],
      },
    ];
    const got = extractPronunciation(data, 'successively');
    expect(got).toEqual({
      phonetic: 'səkˈsɛsɪv',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/success03.mp3',
      baseWord: 'successive',
    });
  });

  it('굴절형 자체에 발음이 있으면(quickly류) baseWord 폴백보다 그쪽을 우선한다', () => {
    const data = [
      {
        meta: { id: 'quick' },
        hwi: { hw: 'quick', prs: [{ ipa: 'ˈkwɪk' }] },
        ins: [{ if: 'quick*ly', prs: [{ ipa: 'ˈkwɪkli', sound: { audio: 'quickl01' } }] }],
      },
    ];
    const got = extractPronunciation(data, 'quickly');
    expect(got?.baseWord).toBeUndefined();
    expect(got?.phonetic).toBe('ˈkwɪkli');
  });

  it('굴절형도 표제어도 둘 다 발음이 없으면 여전히 null이다', () => {
    const data = [{ meta: { id: 'foo' }, hwi: { hw: 'foo' }, ins: [{ if: 'foo*ly' }] }];
    expect(extractPronunciation(data, 'fooly')).toBeNull();
  });

  // 실제 Collegiate 응답(2026-08, "irrevocably" 조회): 파생 부사가 ins(굴절형)가
  // 아니라 uros("undefined run-on")에 실려 있었다 — 처음엔 이걸 놓쳐서
  // successively/astoundingly/irrevocably류가 전부 "발음 없음"이 됐다. ins와 달리
  // uros는 자기 자신의 음원(irrevo05)을 따로 갖고 있다 — 표제어(irrevo01)와 다르다.
  const realIrrevocableEntry = {
    meta: { id: 'irrevocable', stems: ['irrevocable', 'irrevocably'] },
    hwi: {
      hw: 'ir*rev*o*ca*ble',
      prs: [{ mw: 'i-ˈre-və-kə-bəl', sound: { audio: 'irrevo01' } }],
    },
    uros: [
      {
        ure: 'ir*rev*o*ca*bly',
        prs: [{ mw: 'i-ˈre-və-kə-blē', sound: { audio: 'irrevo05' } }],
      },
    ],
  };

  it('파생어가 uros(run-on)에 실려 있고 자체 발음이 있으면 그걸 바로 가져온다', () => {
    const got = extractPronunciation([realIrrevocableEntry], 'irrevocably');
    expect(got).toEqual({
      phonetic: 'i-ˈre-və-kə-blē',
      notation: 'mw',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/i/irrevo05.mp3',
    });
  });

  it('uros 항목에 자체 발음이 없으면 표제어(원형) 발음을 baseWord와 함께 폴백으로 준다', () => {
    const data = [
      {
        meta: { id: 'successive' },
        hwi: { hw: 'suc*ces*sive', prs: [{ ipa: 'səkˈsɛsɪv', sound: { audio: 'success03' } }] },
        uros: [{ ure: 'suc*ces*sive*ly' }],
      },
    ];
    const got = extractPronunciation(data, 'successively');
    expect(got).toEqual({
      phonetic: 'səkˈsɛsɪv',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/success03.mp3',
      baseWord: 'successive',
    });
  });

  it('uros 파생어 문자열이 정확히 일치하지 않으면 발음을 주지 않는다', () => {
    const data = [
      {
        meta: { id: 'quick' },
        hwi: { hw: 'quick' },
        uros: [{ ure: 'quick*ness', prs: [{ ipa: 'ˈkwɪknəs' }] }],
      },
    ];
    expect(extractPronunciation(data, 'quickly')).toBeNull();
  });

  // 실제 Learner's 응답(2026-08, "account for" 조회): 구동사가 dros(defined run-on
  // phrase)에 실려 있고, hwi엔 prs가 아니라 altprs만 있다(동형이의어 "account"의 동사
  // 항목이라 명사 항목과 발음을 공유하는 형태). dros 자체엔 발음이 없다 — 구동사
  // 발음이 핵심 동사와 다르지 않기 때문으로 보인다. "account"의 발음을 baseWord와
  // 함께 폴백으로 준다.
  it('구동사가 dros에 있고 altprs만 있으면 그걸 baseWord 폴백으로 쓴다', () => {
    const data = [
      {
        meta: { id: 'account:2' },
        hom: 2,
        hwi: { hw: 'account', altprs: [{ ipa: 'əˈkaʊnt' }] },
        fl: 'verb',
        dros: [{ drp: 'account for', gram: 'phrasal verb' }],
      },
    ];
    const got = extractPronunciation(data, 'account for');
    expect(got).toEqual({ phonetic: 'əˈkaʊnt', notation: 'ipa', baseWord: 'account' });
  });

  // 실제 Learner's 응답: "depend on/upon"처럼 "/"로 대체 형태를 묶어 쓴다.
  it('dros의 "/" 대체 표기를 펼쳐서 일치시킨다("depend on/upon" → "depend on")', () => {
    const data = [
      {
        meta: { id: 'depend' },
        hwi: { hw: 'de*pend', prs: [{ ipa: 'dɪˈpɛnd', sound: { audio: 'depend01' } }] },
        dros: [{ drp: 'depend on/upon' }],
      },
    ];
    const got = extractPronunciation(data, 'depend on');
    expect(got).toEqual({
      phonetic: 'dɪˈpɛnd',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/d/depend01.mp3',
      baseWord: 'depend',
    });
    expect(extractPronunciation(data, 'depend upon')?.baseWord).toBe('depend');
  });

  it('dros 숙어 문자열이 정확히 일치하지 않으면 발음을 주지 않는다', () => {
    const data = [
      {
        meta: { id: 'stamp:2' },
        hwi: { hw: 'stamp', altprs: [{ ipa: 'ˈstæmp' }] },
        dros: [{ drp: 'stamp on' }, { drp: 'stamp as' }],
      },
    ];
    expect(extractPronunciation(data, 'stamp out')).toBeNull();
  });

  it('굴절형 문자열이 정확히 일치하지 않으면 발음을 주지 않는다', () => {
    const data = [
      {
        meta: { id: 'quick' },
        hwi: { hw: 'quick' },
        ins: [{ if: 'quick*er', prs: [{ ipa: 'ˈkwɪkər' }] }],
      },
    ];
    expect(extractPronunciation(data, 'quickly')).toBeNull();
  });
});

describe('lookupUrl', () => {
  it('사전별 경로와 키를 붙인다', () => {
    expect(lookupUrl('learners', 'synthesize', 'KEY')).toBe(
      'https://www.dictionaryapi.com/api/v3/references/learners/json/synthesize?key=KEY',
    );
    expect(lookupUrl('collegiate', 'acute', 'K2')).toContain('/references/collegiate/json/acute');
  });

  it('공백이 든 숙어를 URL 인코딩한다', () => {
    expect(lookupUrl('learners', 'give up', 'KEY')).toContain('/json/give%20up?key=KEY');
  });
});
