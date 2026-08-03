import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, DB, QuizSettings, SessionResult, Theme, Word } from './types';
import { activeWords, loadDB, newId, saveDB } from './lib/storage';
import { useCloudSync } from './lib/useCloudSync';
import { fetchPronunciations, missingFromCache } from './lib/pronounce';
import { pullTheme, pushTheme } from './lib/sync';
import { allDeckNames } from './lib/select';
import Home from './components/Home';
import WordManager from './components/WordManager';
import StudyList from './components/StudyList';
import SetupScreen from './components/SetupScreen';
import QuizScreen from './components/QuizScreen';
import ResultScreen from './components/ResultScreen';

type Screen =
  | { name: 'home' }
  | { name: 'words' }
  | { name: 'study' }
  | { name: 'setup' }
  | { name: 'quiz'; words: Word[]; settings: QuizSettings }
  | { name: 'result'; session: SessionResult };

export default function App() {
  const [db, setDB] = useState<DB>(() => loadDB());
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

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

  /** 퀴즈 종료: 단어별 통계를 갱신하고 세션 기록을 남긴다. */
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

      setDB((d) => {
        const byId = new Map(d.words.map((w) => [w.id, { ...w, stats: { ...w.stats } }]));
        for (const a of attempts) {
          // 재출제(복습) 시도는 통계를 두 번 깎지 않도록 첫 시도만 반영한다.
          if (a.requeued) continue;
          const w = byId.get(a.wordId);
          if (!w) continue;
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
        return {
          ...d,
          words: d.words.map((w) => byId.get(w.id) ?? w),
          history: [...d.history, session].slice(-500),
        };
      });

      setScreen({ name: 'result', session });
    },
    [],
  );

  const home = useCallback(() => setScreen({ name: 'home' }), []);

  const body = useMemo(() => {
    switch (screen.name) {
      case 'home':
        return (
          <Home
            db={db}
            words={words}
            sync={sync}
            theme={db.theme}
            onThemeChange={setTheme}
            onManageWords={() => setScreen({ name: 'words' })}
            onStudy={() => setScreen({ name: 'study' })}
            onStart={() => setScreen({ name: 'setup' })}
          />
        );
      case 'study':
        return (
          <StudyList
            words={words}
            decks={decks}
            pronunciations={db.pronunciations}
            onFetchPronunciations={cachePronunciations}
            onBack={home}
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
            onBack={home}
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
            onBack={home}
          />
        );
      case 'quiz':
        return (
          <QuizScreen
            words={screen.words}
            settings={screen.settings}
            pronunciations={db.pronunciations}
            onFinish={finishQuiz}
            onAbort={home}
          />
        );
      case 'result':
        return (
          <ResultScreen
            session={screen.session}
            allWords={words}
            pronunciations={db.pronunciations}
            onRetryWrong={startQuiz}
            onHome={home}
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
    setWords,
    createDeck,
    removeDeckName,
    setSettings,
    startQuiz,
    finishQuiz,
    cachePronunciations,
    home,
  ]);

  return <div className="app">{body}</div>;
}
