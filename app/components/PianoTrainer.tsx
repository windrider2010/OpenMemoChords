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
type Feedback = { kind: "ready" | "correct" | "wrong"; message: string };
type RetryItem = { id: string; releaseAt: number };

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

export function PianoTrainer() {
  const [progress, setProgress] = useState<Map<string, NoteProgress>>(new Map());
  const [current, setCurrent] = useState<LessonNote>(LESSON_NOTES[0]);
  const [completed, setCompleted] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "ready", message: "Play the note you see." });
  const [showHint, setShowHint] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const retryQueueRef = useRef<RetryItem[]>([]);
  const questionStartedRef = useRef(0);
  const hadMistakeRef = useRef(false);
  const stateRef = useRef({ current, completed, progress, isLocked });

  useEffect(() => {
    stateRef.current = { current, completed, progress, isLocked };
  }, [current, completed, progress, isLocked]);

  const advance = useCallback((nextCompleted: number, latestProgress: Map<string, NoteProgress>) => {
    const next = chooseNextNote(latestProgress, stateRef.current.current.id, nextCompleted, retryQueueRef.current);
    retryQueueRef.current = retryQueueRef.current.filter(
      (item) => !(item.id === next.id && item.releaseAt <= nextCompleted),
    );
    setCurrent(next);
    setShowHint(false);
    setFeedback({ kind: "ready", message: "Play the note you see." });
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
      setFeedback({ kind: "wrong", message: `${midiToLabel(playedMidi)} is close—have another look and try again.` });
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
    setFeedback({ kind: "correct", message: `Yes—${state.current.spokenName}!` });
    setCorrectCount((value) => value + 1);
    setCompleted(nextCompleted);
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
        const first = chooseNextNote(loaded, "", 0, []);
        setCurrent(first);
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

  const currentProgress = progress.get(current.id);
  const strength = currentProgress ? memoryStrength(currentProgress) : 0;
  const progressPercent = (completed / ROUND_LENGTH) * 100;
  const detectedLabel = reading ? midiToLabel(reading.midi) : "—";
  const accuracy = useMemo(
    () => Math.round((correctCount / Math.max(1, correctCount + mistakeCount)) * 100),
    [correctCount, mistakeCount],
  );

  function restartRound() {
    setCompleted(0);
    setCorrectCount(0);
    setMistakeCount(0);
    retryQueueRef.current = [];
    setCurrent(chooseNextNote(progress, "", 0, []));
    setFeedback({ kind: "ready", message: "Play the note you see." });
    setShowHint(false);
    setIsLocked(false);
    hadMistakeRef.current = false;
    questionStartedRef.current = performance.now();
  }

  if (isLoading) {
    return <main className="trainer-shell loading-screen" aria-busy="true">Warming up the piano…</main>;
  }

  return (
    <main className="trainer-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <span className="brand-copy"><strong>OpenMemoChords</strong><small>Piano note reader</small></span>
        </div>
        <div className="round-progress" aria-label={`${completed} of ${ROUND_LENGTH} notes complete`}>
          <span>{completed} / {ROUND_LENGTH}</span>
          <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
        </div>
      </header>

      {completed >= ROUND_LENGTH ? (
        <section className="session-complete">
          <span className="celebration" aria-hidden="true">★ ♪ ★</span>
          <p className="eyebrow">Round complete</p>
          <h1>Beautiful work!</h1>
          <p>You read all {ROUND_LENGTH} notes. The notes that need more practice will return sooner.</p>
          <div className="finish-stats"><strong>{accuracy}%</strong><span>round accuracy</span></div>
          <button className="primary-button" type="button" onClick={restartRound}>Play another round</button>
        </section>
      ) : (
        <div className="trainer-grid">
          <section className="practice-card">
            <p className="eyebrow">Treble clef · C4 to C5</p>
            <h1>What note is this?</h1>
            <div className="staff-wrap"><StaffNote note={current} /></div>
            <div className={`feedback ${feedback.kind}`} role="status" aria-live="polite">{feedback.message}</div>
            {showHint ? <p className="hint-copy">Hint: look {current.hint}. Find {current.label} on the piano.</p> : null}
            <div className="controls">
              {status === "listening" ? (
                <button className="secondary-button" type="button" onClick={() => void stop()}>Stop listening</button>
              ) : (
                <button className="primary-button" type="button" onClick={() => void start()}>
                  {status === "requesting" ? "Opening microphone…" : "Start listening"}
                </button>
              )}
              <button className="quiet-button" type="button" onClick={() => setShowHint((value) => !value)}>
                {showHint ? "Hide hint" : "Show me a hint"}
              </button>
            </div>
            {error ? <p className="error-copy">{error}</p> : null}
            {storageWarning ? <p className="error-copy">{storageWarning}</p> : null}
            <div className="piano-area">
              <div className="piano-heading"><strong>Or tap a key</strong><span>Useful for quiet practice</span></div>
              <PianoKeyboard onPlay={(midi) => void handlePlayedMidi(midi)} showLabels={showHint} targetId={current.id} />
            </div>
          </section>

          <aside className="side-panel">
            <section className="side-card listening-card">
              <p className="eyebrow">Piano ear</p>
              <div className="detected-note"><span>Heard</span><strong>{detectedLabel}</strong></div>
              <div className="mic-meter" aria-label="Microphone confidence">
                <span style={{ width: `${reading ? Math.round(reading.clarity * 100) : 0}%` }} />
              </div>
              <small>{status === "listening" ? "Listening for a steady piano note" : "Microphone is off"}</small>
            </section>
            <section className="side-card">
              <p className="eyebrow">This note</p>
              <div className="stat-list">
                <div className="stat"><strong>{strength}%</strong><span>memory strength</span></div>
                <div className="stat"><strong>{currentProgress?.mistakeCount ?? 0}</strong><span>helpful retries</span></div>
              </div>
            </section>
            <section className="tip-card">
              <span aria-hidden="true">↻</span>
              <div><strong>How adapting works</strong><p>A missed note returns soon, then comes back again near the moment it may be forgotten.</p></div>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
