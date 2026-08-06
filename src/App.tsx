import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, ClaimKind, DB, QuizSettings, SessionResult, Theme, Word } from './types';
import { activeWords, dedupeWordsById, loadDB, newId, saveDB } from './lib/storage';
import { isRealSession, useCloudSync } from './lib/useCloudSync';
import { fetchPronunciations, missingFromCache } from './lib/pronounce';
import {
  deleteWordsPermanently,
  pullDailyClaims,
  pullRevivalEvents,
  pullTheme,
  pushDailyClaim,
  pushRevivalEvents,
  pushTheme,
} from './lib/sync';
import { REVIVAL_STREAK_GOAL, claimKey, kstDateKey } from './lib/attendance';
import { allDeckNames, pickRevivalWords, revivalPool } from './lib/select';
import BottomNav, { type Tab } from './components/BottomNav';
import LandingScreen from './components/LandingScreen';
import MergeDialog from './components/MergeDialog';
import ProfileScreen from './components/ProfileScreen';
import WordsHub from './components/WordsHub';
import DeckListScreen from './components/DeckListScreen';
import DeckDetailScreen from './components/DeckDetailScreen';
import StudyList from './components/StudyList';
import RoomListScreen from './components/group/RoomListScreen';
import RoomScreen from './components/group/RoomScreen';
import GroupQuizScreen from './components/group/GroupQuizScreen';
import GroupResultScreen from './components/group/GroupResultScreen';
import QuizHub from './components/QuizHub';
import SetupScreen from './components/SetupScreen';
import QuizScreen from './components/QuizScreen';
import ResultScreen from './components/ResultScreen';

type Screen =
  | { name: 'profile' }
  | { name: 'wordsHub' }
  | { name: 'words'; notice?: string }
  | { name: 'deckDetail'; deckName: string }
  | { name: 'study' }
  | { name: 'group' }
  | { name: 'room'; roomId: string }
  | { name: 'groupQuiz'; roomId: string }
  | { name: 'groupResult'; roomId: string; gameNo: number }
  | { name: 'quizHub' }
  | { name: 'setup' }
  | { name: 'quiz'; words: Word[]; settings: QuizSettings }
  | { name: 'result'; session: SessionResult };

// 브라우저 주소창 색(<meta name="theme-color">)에 쓸 값 — styles.css의 테마별 --accent와 동일하게.
const THEME_ACCENTS: Record<Theme, string> = {
  blue: '#2f6fd0',
  pink: '#d6336c',
  cream: '#b8875a',
  mint: '#14b892',
  lavender: '#8462c7',
  'bw-light': '#1a1a1a',
  'bw-dark': '#f0f0ee',
};

function tabOf(name: Screen['name']): Tab {
  switch (name) {
    case 'wordsHub':
    case 'words':
    case 'deckDetail':
    case 'study':
      return 'words';
    case 'quizHub':
    case 'setup':
    case 'quiz':
    case 'result':
      return 'quiz';
    case 'group':
    case 'room':
    case 'groupQuiz':
    case 'groupResult':
      return 'group';
    case 'profile':
      return 'profile';
  }
}

export default function App() {
  const [db, setDB] = useState<DB>(() => loadDB());
  const [screen, setScreen] = useState<Screen>({ name: 'profile' });

  useEffect(() => {
    saveDB(db);
  }, [db]);

  // 방어적 자가 치유: 클라우드 동기화 경쟁 상태 등 드문 경로로 같은 단어(id)가
  // db.words에 두 번 들어가는 일이 생기면, 다음 렌더에서 조용히 하나로 합친다.
  // dedupeWordsById는 중복이 없으면 같은 배열 참조를 그대로 돌려주므로 평소엔
  // 이 setDB가 아예 안 불린다.
  useEffect(() => {
    const deduped = dedupeWordsById(db.words);
    if (deduped !== db.words) setDB((d) => ({ ...d, words: deduped }));
  }, [db.words]);

  // 콜백이 최신 db를 읽되 db가 바뀔 때마다 새로 만들어지지 않도록 하는 참조.
  const dbRef = useRef(db);
  dbRef.current = db;

  // 소프트 삭제된 단어는 어느 화면에도 보이면 안 된다. 여기서 한 번만 걸러 아래로 흘려보낸다.
  const words = useMemo(() => activeWords(db.words), [db.words]);

  // 단어에서 드러나는 단어장 + 아직 단어가 없어 존재만 하는 단어장(미리 만들어 둔 것)을 합친다.
  const decks = useMemo(() => allDeckNames(words, db.decks), [words, db.decks]);

  // 로그인 안 해도(.env.local 미설정 포함) 완전히 잠들어 있는 훅. 게스트 모드에 영향 없음.
  const sync = useCloudSync(db, setDB);

  // 테마는 <html data-theme="..."> 로 CSS에 반영한다. 오프라인에서도 즉시 적용되도록
  // 로컬 db.theme을 정본으로 쓰고, 로그인 상태면 바뀔 때마다 계정에도 올린다.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', db.theme);
  }, [db.theme]);

  // 탭 아이콘(파비콘)도 테마 배경색에 맞춘 버전으로 바꾼다. public/icons/{theme}-{size}.png.
  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const set = (id: string, href: string) => {
      const el = document.getElementById(id) as HTMLLinkElement | null;
      if (el) el.href = `${base}icons/${href}`;
    };
    set('favicon-32', `${db.theme}-32.png`);
    set('favicon-512', `${db.theme}-512.png`);
    set('apple-touch-icon', `${db.theme}-180.png`);
    const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null;
    if (meta) meta.content = THEME_ACCENTS[db.theme];
  }, [db.theme]);

  const setTheme = useCallback(
    (theme: Theme) => {
      setDB((d) => ({ ...d, theme }));
      if (sync.session) void pushTheme(sync.session.user.id, theme);
    },
    [sync.session],
  );

  // 로그인 직후 한 번, 계정에 저장된 마지막 테마를 가져와 적용한다. 이후로는
  // 로컬 값이 정본이고, 테마를 바꿀 때마다 setTheme이 계정에 반영한다.
  const themePulledFor = useRef<string | null>(null);
  useEffect(() => {
    const userId = sync.session?.user.id;
    if (!userId || themePulledFor.current === userId) return;
    themePulledFor.current = userId;
    void pullTheme(userId).then((remote) => {
      if (remote && remote !== dbRef.current.theme) setDB((d) => ({ ...d, theme: remote }));
    });
  }, [sync.session]);

  // 로그인 직후 한 번, 계정에 저장된 출석·미션 수령 기록을 가져와 로컬과 합친다.
  // append-only라 words처럼 복잡한 병합 로직 없이 합집합이면 충분하다.
  const claimsPulledFor = useRef<string | null>(null);
  useEffect(() => {
    const userId = sync.session?.user.id;
    if (!userId || claimsPulledFor.current === userId) return;
    claimsPulledFor.current = userId;
    void pullDailyClaims(userId).then((remote) => {
      if (remote.length === 0) return;
      setDB((d) => ({ ...d, dailyClaims: [...new Set([...d.dailyClaims, ...remote])] }));
    });
  }, [sync.session]);

  // 로그인 직후 + 창 포커스를 되찾을 때마다, 오늘 다른 기기에서 되살린 단어를 가져와
  // 합친다. 테마·출석과 달리 미션 진행률은 하루 안에서 계속 바뀌므로 로그인 시
  // 1회만으로는 부족하다 — revival_events가 append-only라 그냥 합집합이면 된다.
  useEffect(() => {
    const userId = sync.session?.user.id;
    if (!userId) return;
    const pull = () => {
      const today = kstDateKey(Date.now());
      void pullRevivalEvents(userId, today).then((remoteIds) => {
        if (remoteIds.length === 0) return;
        setDB((d) => {
          const base = d.dailyMission.date === today ? d.dailyMission.revivedWordIds : [];
          const merged = [...new Set([...base, ...remoteIds])];
          if (merged.length === base.length && d.dailyMission.date === today) return d;
          return { ...d, dailyMission: { date: today, revivedWordIds: merged } };
        });
      });
    };
    pull();
    window.addEventListener('focus', pull);
    return () => window.removeEventListener('focus', pull);
  }, [sync.session]);

  /** 출석·미션 보상 수령. 로컬에 즉시 반영하고, 로그인 상태면 계정에도 올린다. */
  const claim = useCallback(
    (kind: ClaimKind) => {
      const today = kstDateKey(Date.now());
      const key = claimKey(today, kind);
      setDB((d) => (d.dailyClaims.includes(key) ? d : { ...d, dailyClaims: [...d.dailyClaims, key] }));
      if (sync.session) void pushDailyClaim(sync.session.user.id, today, kind);
    },
    [sync.session],
  );

  const setWords = useCallback((updater: (prev: Word[]) => Word[]) => {
    setDB((d) => ({ ...d, words: updater(d.words) }));
  }, []);

  const setSettings = useCallback((settings: QuizSettings) => {
    setDB((d) => ({ ...d, settings }));
  }, []);

  /** 단어장 삭제 시 db.decks에서 빼고 휴지통(deletedDecks)에 담는다. 소속 단어들의
   *  소프트 삭제(deletedAt)는 호출부(DeckDetailScreen)가 미리 해 둔다. */
  const trashDeck = useCallback((name: string) => {
    const now = Date.now();
    setDB((d) => ({
      ...d,
      decks: d.decks.filter((x) => x !== name),
      deletedDecks: [...d.deletedDecks.filter((x) => x.name !== name), { name, deletedAt: now }],
    }));
  }, []);

  /** 삭제 확인까지 마친 뒤 실제로 부르는 조합 — 데이터를 휴지통으로 옮기고, 목록
   *  화면으로 돌아가며, "휴지통으로 이동했다"는 알림을 그 화면에 실어 보낸다. */
  const deleteDeckAndGoBack = useCallback(
    (name: string) => {
      trashDeck(name);
      setScreen({ name: 'words', notice: `"${name}" 단어장이 휴지통으로 이동했습니다.` });
    },
    [trashDeck],
  );

  /** 휴지통에서 복원. 그새 같은 이름의 단어장이 다시 생겼으면 막는다. */
  const restoreDeck = useCallback(
    (name: string): { ok: boolean; error?: string } => {
      if (decks.includes(name)) {
        return { ok: false, error: `"${name}" 이름의 단어장이 이미 있어 복원할 수 없습니다.` };
      }
      const now = Date.now();
      setDB((d) => ({
        ...d,
        decks: d.decks.includes(name) ? d.decks : [...d.decks, name],
        deletedDecks: d.deletedDecks.filter((x) => x.name !== name),
        words: d.words.map((w) =>
          w.deck === name && w.deletedAt ? { ...w, deletedAt: undefined, updatedAt: now } : w,
        ),
      }));
      return { ok: true };
    },
    [decks],
  );

  /**
   * 휴지통에서 완전 삭제 — words 배열에서도 실제로 지운다. 처음엔 "소프트 삭제
   * 상태로 그냥 두고 목록에서만 뺀다"로 했었는데, 그러면 나중에 같은 이름의
   * 단어장을 새로 만들었을 때 그 유령 단어들이 deck 필드가 같다는 이유만으로
   * 새 단어장 것과 섞여 보이는 버그가 있었다(휴지통 미리보기에서 발견됨) —
   * "완전 삭제"라는 이름값대로 진짜 지워야 이 문제 자체가 안 생긴다.
   * 로그인 상태면 서버 행도 같이 지운다(sync.ts deleteWordsPermanently 주석 참고).
   */
  const purgeDeck = useCallback(
    (name: string) => {
      const idsToRemove = db.words.filter((w) => w.deck === name && w.deletedAt).map((w) => w.id);
      setDB((d) => ({
        ...d,
        deletedDecks: d.deletedDecks.filter((x) => x.name !== name),
        words: d.words.filter((w) => !(w.deck === name && w.deletedAt)),
      }));
      if (isRealSession(sync.session) && idsToRemove.length > 0) {
        void deleteWordsPermanently(sync.session.user.id, idsToRemove);
      }
    },
    [db.words, sync.session],
  );

  /** 단어 없이 미리 만들어 두는 빈 단어장. 이름 충돌이면 만들지 않고 에러를 돌려준다
   *  (DeckListScreen이 "새 단어장N" 제안 이름을 여기로 그대로 넘길 수도 있다). 휴지통에
   *  있는 이름도 막는다 — 안 막으면 같은 이름의 단어장이 휴지통과 목록에 동시에 있게
   *  되고, 나중에 휴지통 걸 복원하려 할 때만 뒤늦게 막혀서 헷갈린다. */
  const createDeck = useCallback(
    (name: string): { ok: boolean; error?: string } => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: '이름을 입력하세요.' };
      if (decks.includes(trimmed)) return { ok: false, error: `이미 있는 단어장입니다: ${trimmed}` };
      if (db.deletedDecks.some((x) => x.name === trimmed)) {
        return { ok: false, error: `"${trimmed}"은(는) 휴지통에 있습니다. 복원하거나 다른 이름을 쓰세요.` };
      }
      setDB((d) => (d.decks.includes(trimmed) ? d : { ...d, decks: [...d.decks, trimmed] }));
      return { ok: true };
    },
    [decks, db.deletedDecks],
  );

  /** 단어장 이름을 바꾼다 — db.decks 항목과 그 단어장 소속 단어 전체의 deck 필드를 같이 옮긴다. */
  const renameDeck = useCallback(
    (oldName: string, newName: string): { ok: boolean; error?: string } => {
      const trimmed = newName.trim();
      if (!trimmed) return { ok: false, error: '이름을 입력하세요.' };
      if (trimmed === oldName) return { ok: true };
      if (decks.includes(trimmed)) return { ok: false, error: `이미 있는 단어장입니다: ${trimmed}` };
      const now = Date.now();
      setDB((d) => ({
        ...d,
        decks: d.decks.map((x) => (x === oldName ? trimmed : x)),
        words: d.words.map((w) => (w.deck === oldName ? { ...w, deck: trimmed, updatedAt: now } : w)),
      }));
      return { ok: true };
    },
    [decks],
  );

  /** 지금 보고 있는 단어장이 이름을 바꾼 그 단어장이면, 화면 상태도 새 이름을 따라가게 한다. */
  const renameDeckAndFollow = useCallback(
    (oldName: string, newName: string): { ok: boolean; error?: string } => {
      const res = renameDeck(oldName, newName);
      if (res.ok) {
        const trimmed = newName.trim();
        setScreen((s) => (s.name === 'deckDetail' && s.deckName === oldName ? { name: 'deckDetail', deckName: trimmed } : s));
      }
      return res;
    },
    [renameDeck],
  );

  /**
   * 아직 캐시에 없는 단어의 발음을 받아 로컬 캐시에 넣는다.
   * 실패해도 조용히 넘어간다 — 발음은 부가 기능이라 학습을 막으면 안 된다.
   */
  const cachePronunciations = useCallback(async (targets: Word[]) => {
    const missing = missingFromCache(
      targets.map((w) => w.en),
      dbRef.current.pronunciations,
    );
    if (missing.length === 0) return;

    const fetched = await fetchPronunciations(missing);
    if (fetched.length === 0) return;

    setDB((d) => {
      const next = { ...d.pronunciations };
      for (const p of fetched) next[p.en] = p;
      return { ...d, pronunciations: next };
    });
  }, []);

  const startQuiz = useCallback(
    (words: Word[], settings: QuizSettings) => {
      setDB((d) => ({ ...d, settings }));
      setScreen({ name: 'quiz', words, settings });
      // 퀴즈 시작과 동시에 미리 받아 둔다. 문제 중간에 네트워크를 기다리지 않도록.
      void cachePronunciations(words);
    },
    [cachePronunciations],
  );

  /** 퀴즈 종료: 단어별 통계를 갱신하고 세션 기록·오늘의 미션 진행도를 남긴다. */
  const finishQuiz = useCallback(
    (attempts: Attempt[], settings: QuizSettings, startedAt: number) => {
      const finishedAt = Date.now();
      const session: SessionResult = {
        id: newId(),
        date: new Date(finishedAt).toLocaleDateString('sv-SE'), // YYYY-MM-DD (로컬 기준)
        startedAt,
        finishedAt,
        settings,
        attempts,
      };

      const today = kstDateKey(finishedAt);
      // setDB 업데이터 밖(계정에 올리는 push 호출)에서도 필요해서 지역 변수로 빼 둔다.
      let newlyRevivedIds: string[] = [];

      setDB((d) => {
        const byId = new Map(d.words.map((w) => [w.id, { ...w, stats: { ...w.stats } }]));
        const prevIds = d.dailyMission.date === today ? d.dailyMission.revivedWordIds : [];
        const revivedIds = new Set(prevIds);
        for (const a of attempts) {
          // 재출제(복습) 시도는 통계를 두 번 깎지 않도록 첫 시도만 반영한다.
          if (a.requeued) continue;
          const w = byId.get(a.wordId);
          if (!w) continue;
          // "오답 부활전" 대상(revivalPool)이었던 단어가 이번에 맞았는지. wrong>0만
          // 보면 이미 다 되살린(streak>=REVIVAL_STREAK_GOAL) 단어를 나중에 다시
          // 맞힐 때마다 계속 세는 버그가 있었다 — streak 조건까지 같이 봐야 한다.
          if (w.stats.wrong > 0 && w.stats.streak < REVIVAL_STREAK_GOAL && a.verdict === 'correct') {
            revivedIds.add(w.id);
          }
          w.stats.seen += 1;
          w.stats.lastSeenAt = finishedAt;
          w.updatedAt = finishedAt;
          if (a.verdict === 'correct') {
            w.stats.correct += 1;
            w.stats.streak += 1;
          } else {
            w.stats.wrong += 1;
            w.stats.streak = 0;
          }
        }

        newlyRevivedIds = [...revivedIds].filter((id) => !prevIds.includes(id));

        return {
          ...d,
          words: d.words.map((w) => byId.get(w.id) ?? w),
          history: [...d.history, session].slice(-500),
          dailyMission: { date: today, revivedWordIds: [...revivedIds] },
        };
      });

      if (sync.session && newlyRevivedIds.length > 0) {
        void pushRevivalEvents(sync.session.user.id, today, newlyRevivedIds);
      }

      setScreen({ name: 'result', session });
    },
    [sync.session],
  );

  const navigate = useCallback((tab: Tab) => {
    switch (tab) {
      case 'words':
        setScreen({ name: 'wordsHub' });
        return;
      case 'quiz':
        setScreen({ name: 'quizHub' });
        return;
      case 'group':
        setScreen({ name: 'group' });
        return;
      case 'profile':
        setScreen({ name: 'profile' });
        return;
    }
  }, []);

  const goWordsHub = useCallback(() => setScreen({ name: 'wordsHub' }), []);
  const goWords = useCallback(() => setScreen({ name: 'words' }), []);
  const goDeckDetail = useCallback((deckName: string) => setScreen({ name: 'deckDetail', deckName }), []);
  const goProfile = useCallback(() => setScreen({ name: 'profile' }), []);
  const goQuizHub = useCallback(() => setScreen({ name: 'quizHub' }), []);
  const goSetup = useCallback(() => setScreen({ name: 'setup' }), []);
  const goGroupList = useCallback(() => setScreen({ name: 'group' }), []);
  const goRoom = useCallback((roomId: string) => setScreen({ name: 'room', roomId }), []);
  const goGroupQuiz = useCallback((roomId: string) => setScreen({ name: 'groupQuiz', roomId }), []);
  const goGroupResult = useCallback(
    (roomId: string, gameNo: number) => setScreen({ name: 'groupResult', roomId, gameNo }),
    [],
  );

  // 지금 부활전에 나올 수 있는 단어 수. 허브에서 "몇 개가 기다리는지" 보여주는 데 쓴다.
  // 전체 단어장 대상 — 부활전은 특정 단어장이 아니라 "내가 틀린 것 전부"가 자연스럽다.
  const revivalCount = useMemo(() => revivalPool(words, []).length, [words]);

  const revivedToday =
    db.dailyMission.date === kstDateKey(Date.now()) ? db.dailyMission.revivedWordIds.length : 0;

  /** 오답 부활전 시작: 저장된 난이도·시간 설정은 그대로 쓰고 출제 단어만 부활전 풀에서 뽑는다. */
  const startRevival = useCallback(() => {
    const picked = pickRevivalWords(words, [], dbRef.current.settings.count, dbRef.current.history);
    if (picked.length === 0) return;
    startQuiz(picked, dbRef.current.settings);
  }, [words, startQuiz]);

  const body = useMemo(() => {
    switch (screen.name) {
      case 'profile':
        return (
          <ProfileScreen
            words={words}
            history={db.history}
            sync={sync}
            theme={db.theme}
            onThemeChange={setTheme}
            dailyMission={db.dailyMission}
            dailyClaims={db.dailyClaims}
            onClaim={claim}
            onGoWords={goWordsHub}
          />
        );
      case 'wordsHub':
        return (
          <WordsHub
            wordCount={words.length}
            onStudy={() => setScreen({ name: 'study' })}
            onManage={() => setScreen({ name: 'words' })}
          />
        );
      case 'study':
        return (
          <StudyList
            words={words}
            setWords={setWords}
            decks={decks}
            pronunciations={db.pronunciations}
            onFetchPronunciations={cachePronunciations}
            onBack={goWordsHub}
          />
        );
      case 'words':
        return (
          <DeckListScreen
            words={words}
            allWords={db.words}
            decks={decks}
            deletedDecks={db.deletedDecks}
            notice={screen.notice}
            onCreateDeck={createDeck}
            onSelectDeck={goDeckDetail}
            onRestoreDeck={restoreDeck}
            onPurgeDeck={purgeDeck}
            onBack={goWordsHub}
          />
        );
      case 'deckDetail':
        return (
          <DeckDetailScreen
            deckName={screen.deckName}
            words={words}
            setWords={setWords}
            decks={decks}
            onRenameDeck={renameDeckAndFollow}
            onDeleted={deleteDeckAndGoBack}
            pronunciations={db.pronunciations}
            onFetchPronunciations={cachePronunciations}
            onBack={goWords}
          />
        );
      case 'group':
        return <RoomListScreen sync={sync} onEnterRoom={goRoom} />;
      case 'room':
        return (
          <RoomScreen
            roomId={screen.roomId}
            sync={sync}
            words={words}
            decks={decks}
            onBack={goGroupList}
            onGameStart={goGroupQuiz}
          />
        );
      case 'groupQuiz':
        return (
          <GroupQuizScreen
            roomId={screen.roomId}
            sync={sync}
            onEnded={goGroupResult}
            onLeft={goGroupList}
          />
        );
      case 'groupResult':
        return (
          <GroupResultScreen
            roomId={screen.roomId}
            gameNo={screen.gameNo}
            onBackToRoom={() => goRoom(screen.roomId)}
          />
        );
      case 'quizHub':
        return (
          <QuizHub
            wordCount={words.length}
            revivalCount={revivalCount}
            revivedToday={revivedToday}
            onNormal={goSetup}
            onRevival={startRevival}
          />
        );
      case 'setup':
        return (
          <SetupScreen
            words={words}
            decks={decks}
            settings={db.settings}
            onSettingsChange={setSettings}
            onStart={startQuiz}
            onBack={goQuizHub}
          />
        );
      case 'quiz':
        return (
          <QuizScreen
            words={screen.words}
            settings={screen.settings}
            pronunciations={db.pronunciations}
            onFinish={finishQuiz}
            onAbort={goQuizHub}
          />
        );
      case 'result':
        return (
          <ResultScreen
            session={screen.session}
            allWords={words}
            pronunciations={db.pronunciations}
            onRetryWrong={startQuiz}
            onHome={goProfile}
          />
        );
    }
  }, [
    screen,
    db,
    words,
    decks,
    sync,
    setTheme,
    claim,
    setWords,
    createDeck,
    renameDeckAndFollow,
    deleteDeckAndGoBack,
    restoreDeck,
    purgeDeck,
    setSettings,
    startQuiz,
    finishQuiz,
    cachePronunciations,
    goWordsHub,
    goWords,
    goDeckDetail,
    goProfile,
    goQuizHub,
    goSetup,
    goGroupList,
    goRoom,
    goGroupQuiz,
    goGroupResult,
    revivalCount,
    revivedToday,
    startRevival,
  ]);

  // Supabase 응답을 기다리는 아주 짧은 순간 — 여기서 아무것도 안 그려야, 이미 로그인해
  // 둔 사용자도 앱을 열 때마다 랜딩 화면이 잠깐 번쩍이는 걸 피할 수 있다.
  if (sync.configured && !sync.sessionChecked) {
    return <div className="app" />;
  }

  // 게스트든 실계정이든 세션이 있어야 앱을 쓸 수 있다 — 로그인 없이 흘러가다 나중에
  // 데이터를 잃는 경로 자체를 없앤다(게스트도 명시적 선택이라 이 조건에 안 걸린다).
  if (sync.configured && !sync.session) {
    return (
      <div className="app">
        <LandingScreen sync={sync} />
      </div>
    );
  }

  return (
    <div className="app">
      {body}
      {screen.name !== 'quiz' && screen.name !== 'groupQuiz' && (
        <BottomNav active={tabOf(screen.name)} onNavigate={navigate} />
      )}
      <MergeDialog sync={sync} />
    </div>
  );
}
