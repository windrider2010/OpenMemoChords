"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePitchDetector } from "../hooks/usePitchDetector";
import { LESSON_NOTES, NOTE_BY_ID, midiToLabel, type LessonNote } from "../lib/notes";
import {
  loadLessonProgress,
  memoryStrength,
  ratingForAnswer,
  recordMistake,
  recordSuccess,
  type NoteProgress,
} from "../lib/progress";
import { PianoKeyboard } from "./PianoKeyboard";
import { StaffNote } from "./StaffNote";

const ROUND_LENGTH = 10;
const SNOWFLAKES = ["❄", "✦", "❅", "✧", "❆", "✦", "❄", "✧", "❅", "✦", "❆", "❄"];

type PracticeMode = "acoustic" | "virtual";
type Feedback = { kind: "ready" | "correct" | "wrong"; message: string };
type RetryItem = { id: string; releaseAt: number };

function readyMessage(mode: PracticeMode | null) {
  return mode === "virtual" ? "Tap the matching key." : "Play the note on your piano.";
}

function chooseNextNote(
  progress: Map<string, NoteProgress>,
  currentId: string,
  completed: number,
  retryQueue: RetryItem[],
) {
  const eligibleRetry = retryQueue.find((item) => item.releaseAt <= completed && item.id !== currentId);
  if (eligibleRetry) return NOTE_BY_ID.get(eligibleRetry.id) ?? LESSON_NOTES[0];

  const now = Date.now();
  const ranked = LESSON_NOTES.filter((note) => note.id !== currentId)
    .map((note) => {
      const item = progress.get(note.id);
      if (!item) return { note, score: 100 };
      const overdueDays = Math.max(0, now - item.card.due.getTime()) / 86_400_000;
      const novelty = item.correctCount === 0 ? 18 : 0;
      return { note, score: novelty + item.mistakeCount * 5 + overdueDays - item.correctCount * 0.8 };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, Math.min(3, ranked.length));
  return top[completed % top.length]?.note ?? LESSON_NOTES[0];
}

function playVictoryChime() {
  try {
    const context = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.14;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.48);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.5);
    });
    window.setTimeout(() => void context.close(), 1200);
  } catch {
    // Celebration remains fully visual if audio is unavailable.
  }
}

export function PianoTrainer() {
  const [progress, setProgress] = useState<Map<string, NoteProgress>>(new Map());
  const [current, setCurrent] = useState<LessonNote>(LESSON_NOTES[0]);
  const [practiceMode, setPracticeMode] = useState<PracticeMode | null>(null);
  const [completed, setCompleted] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "ready", message: readyMessage(null) });
  const [showHint, setShowHint] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const retryQueueRef = useRef<RetryItem[]>([]);
  const questionStartedRef = useRef(0);
  const hadMistakeRef = useRef(false);
  const celebratedRef = useRef(false);
  const modeRef = useRef<PracticeMode | null>(null);
  const stateRef = useRef({ current, completed, progress, isLocked, streak });

  useEffect(() => {
    stateRef.current = { current, completed, progress, isLocked, streak };
  }, [current, completed, progress, isLocked, streak]);

  const advance = useCallback((nextCompleted: number, latestProgress: Map<string, NoteProgress>) => {
    const next = chooseNextNote(latestProgress, stateRef.current.current.id, nextCompleted, retryQueueRef.current);
    retryQueueRef.current = retryQueueRef.current.filter(
      (item) => !(item.id === next.id && item.releaseAt <= nextCompleted),
    );
    setCurrent(next);
    setShowHint(false);
    setFeedback({ kind: "ready", message: readyMessage(modeRef.current) });
    hadMistakeRef.current = false;
    questionStartedRef.current = performance.now();
    setIsLocked(false);
  }, []);

  const handlePlayedMidi = useCallback(async (playedMidi: number) => {
    const state = stateRef.current;
    if (state.isLocked || state.completed >= ROUND_LENGTH) return;
    setIsLocked(true);
    const responseMs = Math.max(250, performance.now() - questionStartedRef.current);
    const item = state.progress.get(state.current.id);
    if (!item) {
      setIsLocked(false);
      return;
    }

    if (playedMidi !== state.current.midi) {
      hadMistakeRef.current = true;
      setMistakeCount((value) => value + 1);
      setStreak(0);
      setFeedback({ kind: "wrong", message: `${midiToLabel(playedMidi)} is close—look once more and try again.` });
      if (!retryQueueRef.current.some((retry) => retry.id === state.current.id)) {
        retryQueueRef.current.push({ id: state.current.id, releaseAt: state.completed + 2 });
      }
      try {
        const updated = await recordMistake(item, playedMidi, responseMs);
        setProgress((previous) => new Map(previous).set(updated.id, updated));
      } catch {
        setStorageWarning("Progress could not be saved on this device, but this round can continue.");
      }
      window.setTimeout(() => setIsLocked(false), 650);
      return;
    }

    const nextCompleted = state.completed + 1;
    const nextStreak = hadMistakeRef.current ? 0 : state.streak + 1;
    setFeedback({ kind: "correct", message: nextStreak >= 3 ? `Yes—${state.current.spokenName}! Crystal streak!` : `Yes—${state.current.spokenName}!` });
    setCorrectCount((value) => value + 1);
    setCompleted(nextCompleted);
    setStreak(nextStreak);
    setBestStreak((value) => Math.max(value, nextStreak));
    let latestProgress = state.progress;
    try {
      const updated = await recordSuccess(
        item,
        playedMidi,
        responseMs,
        ratingForAnswer(responseMs, hadMistakeRef.current),
      );
      latestProgress = new Map(state.progress).set(updated.id, updated);
      setProgress(latestProgress);
    } catch {
      setStorageWarning("Progress could not be saved on this device, but this round can continue.");
    }
    if (nextCompleted < ROUND_LENGTH) window.setTimeout(() => advance(nextCompleted, latestProgress), 760);
  }, [advance]);

  const { status, error, reading, start, stop } = usePitchDetector((event) => {
    void handlePlayedMidi(event.midi);
  });

  useEffect(() => {
    let active = true;
    loadLessonProgress()
      .then((loaded) => {
        if (!active) return;
        setProgress(loaded);
        setCurrent(chooseNextNote(loaded, "", 0, []));
        questionStartedRef.current = performance.now();
      })
      .catch(() => setStorageWarning("Saved progress is unavailable. Check that private browsing is off."))
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (completed >= ROUND_LENGTH && !celebratedRef.current) {
      celebratedRef.current = true;
      playVictoryChime();
    }
  }, [completed]);

  const currentProgress = progress.get(current.id);
  const strength = currentProgress ? memoryStrength(currentProgress) : 0;
  const detectedLabel = reading ? midiToLabel(reading.midi) : "—";
  const accuracy = useMemo(
    () => Math.round((correctCount / Math.max(1, correctCount + mistakeCount)) * 100),
    [correctCount, mistakeCount],
  );

  async function selectMode(mode: PracticeMode) {
    modeRef.current = mode;
    setPracticeMode(mode);
    setFeedback({ kind: "ready", message: readyMessage(mode) });
    questionStartedRef.current = performance.now();
    if (mode === "acoustic") await start();
    else if (status === "listening") await stop();
  }

  async function changeMode() {
    if (status === "listening") await stop();
    modeRef.current = null;
    setPracticeMode(null);
    setShowHint(false);
  }

  function restartRound() {
    setCompleted(0);
    setCorrectCount(0);
    setMistakeCount(0);
    setStreak(0);
    setBestStreak(0);
    retryQueueRef.current = [];
    celebratedRef.current = false;
    setCurrent(chooseNextNote(progress, "", 0, []));
    setFeedback({ kind: "ready", message: readyMessage(practiceMode) });
    setShowHint(false);
    setIsLocked(false);
    hadMistakeRef.current = false;
    questionStartedRef.current = performance.now();
  }

  if (isLoading) {
    return <main className="trainer-shell loading-screen" aria-busy="true">Warming up the piano…</main>;
  }

  if (!practiceMode) {
    return (
      <main className="mode-shell">
        <div className="winter-orb orb-one" aria-hidden="true" />
        <div className="winter-orb orb-two" aria-hidden="true" />
        <section className="mode-picker">
          <div className="mode-brand"><span aria-hidden="true">♪</span> OpenMemoChords</div>
          <p className="level-pill">Level 1 · One note at a time</p>
          <h1>How would you like to play?</h1>
          <p className="mode-intro">Choose your setup. We’ll keep the music big and easy to see.</p>
          <div className="mode-options">
            <button className="mode-card acoustic-choice" type="button" onClick={() => void selectMode("acoustic")}>
              <span className="mode-icon" aria-hidden="true">♬</span>
              <span className="mode-card-copy"><strong>Have a Piano</strong><small>Play your real piano and we’ll listen</small></span>
              <span className="mode-arrow" aria-hidden="true">→</span>
            </button>
            <button className="mode-card virtual-choice" type="button" onClick={() => void selectMode("virtual")}>
              <span className="mode-icon keys-icon" aria-hidden="true">▥</span>
              <span className="mode-card-copy"><strong>No Piano</strong><small>Practice with large on-screen keys</small></span>
              <span className="mode-arrow" aria-hidden="true">→</span>
            </button>
          </div>
          <p className="adaptive-note"><span aria-hidden="true">✦</span> Missed notes return sooner, right when memory needs them.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`trainer-shell ${practiceMode}-mode`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <span className="brand-copy"><strong>OpenMemoChords</strong><small>Level 1 · Piano note reader</small></span>
        </div>
        <div className="topbar-actions">
          <span className="mode-chip">{practiceMode === "acoustic" ? "Have a Piano" : "No Piano"}</span>
          <button className="change-mode" type="button" onClick={() => void changeMode()}>Change setup</button>
        </div>
      </header>

      {completed >= ROUND_LENGTH ? (
        <section className="session-complete winter-celebration">
          <div className="snowfall" aria-hidden="true">
            {SNOWFLAKES.map((flake, index) => (
              <span
                key={index}
                style={{
                  "--flake-left": `${index * 8.4}%`,
                  "--flake-delay": `${index * -0.43}s`,
                  "--flake-duration": `${4.7 + (index % 4) * 0.35}s`,
                } as React.CSSProperties}
              >
                {flake}
              </span>
            ))}
          </div>
          <div className="crystal-halo" aria-hidden="true"><span>♛</span></div>
          <p className="eyebrow ice-eyebrow">Level 1 complete</p>
          <h1>Crystal Crown earned!</h1>
          <p className="celebration-copy">You read all {ROUND_LENGTH} notes. Your royal music garden is sparkling brighter.</p>
          <div className="crystal-stats">
            <div><strong>{accuracy}%</strong><span>accuracy</span></div>
            <div><strong>{bestStreak}</strong><span>best streak</span></div>
            <div><strong>{correctCount}</strong><span>crystals earned</span></div>
          </div>
          <div className="royal-cheer" aria-hidden="true">✦ ❄ ✦</div>
          <button className="ice-button" type="button" onClick={restartRound}>Play another royal round</button>
          <button className="celebration-mode-button" type="button" onClick={() => void changeMode()}>Choose another setup</button>
        </section>
      ) : (
        <section className="practice-card focus-card">
          <div className="practice-heading">
            <div>
              <p className="eyebrow">Level 1 · Treble clef · C4 to C5</p>
              <h1>Play this note</h1>
            </div>
            <div className="round-hud">
              <div className="streak-badge"><span aria-hidden="true">✦</span><strong>{streak}</strong><small>streak</small></div>
              <div className="crystal-progress" aria-label={`${completed} of ${ROUND_LENGTH} notes complete`}>
                {Array.from({ length: ROUND_LENGTH }, (_, index) => (
                  <span className={index < completed ? "earned" : ""} key={index} aria-hidden="true">◆</span>
                ))}
              </div>
            </div>
          </div>

          <div className="notation-stage">
            <span className="single-note-label">One note</span>
            <StaffNote note={current} />
          </div>

          <div className="response-row">
            <div className={`feedback ${feedback.kind}`} role="status" aria-live="polite">{feedback.message}</div>
            {practiceMode === "acoustic" ? (
              <div className={`ear-status ${status}`}>
                <span className="ear-dot" aria-hidden="true" />
                <span>{status === "listening" ? "Heard" : "Piano ear"}</span>
                <strong>{status === "listening" ? detectedLabel : "Off"}</strong>
              </div>
            ) : null}
          </div>

          {showHint ? <p className="hint-copy">Hint: look {current.hint}. Find {current.label} on the piano.</p> : null}
          <div className="controls">
            {practiceMode === "acoustic" ? (
              status === "listening" ? (
                <button className="secondary-button" type="button" onClick={() => void stop()}>Pause listening</button>
              ) : (
                <button className="primary-button" type="button" onClick={() => void start()}>
                  {status === "requesting" ? "Opening microphone…" : "Start listening"}
                </button>
              )
            ) : null}
            <button className="quiet-button" type="button" onClick={() => setShowHint((value) => !value)}>
              {showHint ? "Hide hint" : "Show me a hint"}
            </button>
          </div>

          {error ? <p className="error-copy">{error} <button type="button" onClick={() => void selectMode("virtual")}>Use on-screen keys</button></p> : null}
          {storageWarning ? <p className="error-copy">{storageWarning}</p> : null}

          {practiceMode === "virtual" ? (
            <div className="piano-area">
              <div className="piano-heading"><strong>Tap the note</strong><span>Labels appear with a hint</span></div>
              <PianoKeyboard onPlay={(midi) => void handlePlayedMidi(midi)} showLabels={showHint} targetId={current.id} />
            </div>
          ) : null}

          <div className="practice-footer">
            <span><strong>{strength}%</strong> memory strength</span>
            <span><strong>{currentProgress?.mistakeCount ?? 0}</strong> helpful retries</span>
            <span className="adaptive-mini"><strong>↻</strong> Missed notes return sooner</span>
          </div>
        </section>
      )}
    </main>
  );
}
