import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Attempt, DB, QuizSettings, SessionResult, Word } from './types';
import { loadDB, newId, saveDB } from './lib/storage';
import Home from './components/Home';
import WordManager from './components/WordManager';
import SetupScreen from './components/SetupScreen';
import QuizScreen from './components/QuizScreen';
import ResultScreen from './components/ResultScreen';

type Screen =
  | { name: 'home' }
  | { name: 'words' }
  | { name: 'setup' }
  | { name: 'quiz'; words: Word[]; settings: QuizSettings }
  | { name: 'result'; session: SessionResult };

export default function App() {
  const [db, setDB] = useState<DB>(() => loadDB());
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    saveDB(db);
  }, [db]);

  const setWords = useCallback((updater: (prev: Word[]) => Word[]) => {
    setDB((d) => ({ ...d, words: updater(d.words) }));
  }, []);

  const setSettings = useCallback((settings: QuizSettings) => {
    setDB((d) => ({ ...d, settings }));
  }, []);

  const startQuiz = useCallback((words: Word[], settings: QuizSettings) => {
    setDB((d) => ({ ...d, settings }));
    setScreen({ name: 'quiz', words, settings });
  }, []);

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
            onManageWords={() => setScreen({ name: 'words' })}
            onStart={() => setScreen({ name: 'setup' })}
          />
        );
      case 'words':
        return <WordManager words={db.words} setWords={setWords} onBack={home} />;
      case 'setup':
        return (
          <SetupScreen
            words={db.words}
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
            onFinish={finishQuiz}
            onAbort={home}
          />
        );
      case 'result':
        return (
          <ResultScreen
            session={screen.session}
            allWords={db.words}
            onRetryWrong={startQuiz}
            onHome={home}
          />
        );
    }
  }, [screen, db, setWords, setSettings, startQuiz, finishQuiz, home]);

  return <div className="app">{body}</div>;
}
