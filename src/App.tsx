import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, ClaimKind, DB, QuizSettings, SessionResult, Theme, Word } from './types';
import { activeWords, loadDB, newId, saveDB } from './lib/storage';
import { useCloudSync } from './lib/useCloudSync';
import { fetchPronunciations, missingFromCache } from './lib/pronounce';
import {
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
import ProfileScreen from './components/ProfileScreen';
import WordsHub from './components/WordsHub';
import WordManager from './components/WordManager';
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
  | { name: 'words' }
  | { name: 'study' }
  | { name: 'group' }
  | { name: 'room'; roomId: string }
  | { name: 'groupQuiz'; roomId: string }
  | { name: 'groupResult'; roomId: string; gameNo: number }
  | { name: 'quizHub' }
  | { name: 'setup' }
  | { name: 'quiz'; words: Word[]; settings: QuizSettings }
  | { name: 'result'; session: SessionResult };

function tabOf(name: Screen['name']): Tab {
  switch (name) {
    case 'wordsHub':
    case 'words':
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

  /** 단어 없이 미리 만들어 두는 빈 단어장. */
  const createDeck = useCallback((name: string) => {
    setDB((d) => (d.decks.includes(name) ? d : { ...d, decks: [...d.decks, name] }));
  }, []);

  /** "이 단어장 삭제"에서 함께 부른다 — 단어를 옮겨서 비워진 뒤에도 목록에 남지 않도록. */
  const removeDeckName = useCallback((name: string) => {
    setDB((d) => ({ ...d, decks: d.decks.filter((x) => x !== name) }));
  }, []);

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
          <WordManager
            words={words}
            setWords={setWords}
            decks={decks}
            onCreateDeck={createDeck}
            onRemoveDeckName={removeDeckName}
            pronunciations={db.pronunciations}
            onFetchPronunciations={cachePronunciations}
            onBack={goWordsHub}
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
    removeDeckName,
    setSettings,
    startQuiz,
    finishQuiz,
    cachePronunciations,
    goWordsHub,
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

  return (
    <div className="app">
      {body}
      {screen.name !== 'quiz' && screen.name !== 'groupQuiz' && (
        <BottomNav active={tabOf(screen.name)} onNavigate={navigate} />
      )}
    </div>
  );
}
