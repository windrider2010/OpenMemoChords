"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePitchDetector } from "../hooks/usePitchDetector";
import {
  LEVELS,
  allowedNotesForLevel,
  buildExercise,
  getLevelConfig,
  noteValueName,
  type PracticeExercise,
  type PracticeLevel,
} from "../lib/curriculum";
import { BASS_NOTES, NOTE_BY_ID, TREBLE_NOTES, midiToLabel, type LessonNote } from "../lib/notes";
import {
  loadLessonProgress,
  loadPlayerProfile,
  memoryStrength,
  pointsForAnswer,
  ratingForAnswer,
  recordCompletedSession,
  recordMistake,
  recordSuccess,
  type NoteProgress,
  type PlayerProfile,
} from "../lib/progress";
import { PianoKeyboard } from "./PianoKeyboard";
import { ProgressDashboard } from "./ProgressDashboard";
import { StaffExercise } from "./StaffNote";

type PracticeMode = "acoustic" | "virtual";
type AppView = "practice" | "progress";
type Feedback = { kind: "ready" | "correct" | "wrong"; message: string };
type RetryItem = { id: string; releaseAt: number };

const EMPTY_PROFILE: PlayerProfile = { id: "player", lifetimePoints: 0, crowns: 0, bestStreak: 0 };

function readyMessage(mode: PracticeMode | null, level: PracticeLevel) {
  if (level > 1) return "Study the pattern, then start the beat.";
  return mode === "virtual" ? "Tap the matching key." : "Play the note on your piano.";
}

function chooseNextNote(
  progress: Map<string, NoteProgress>,
  currentId: string,
  completed: number,
  retryQueue: RetryItem[],
  allowedNotes: LessonNote[],
) {
  const allowedIds = new Set(allowedNotes.map((note) => note.id));
  const eligibleRetry = retryQueue.find(
    (item) => item.releaseAt <= completed && item.id !== currentId && allowedIds.has(item.id),
  );
  if (eligibleRetry) return NOTE_BY_ID.get(eligibleRetry.id) ?? allowedNotes[0];

  const now = Date.now();
  const ranked = allowedNotes
    .filter((note) => note.id !== currentId)
    .map((note) => {
      const item = progress.get(note.id);
      if (!item) return { note, score: 100 };
      const overdueDays = Math.max(0, now - item.card.due.getTime()) / 86_400_000;
      const novelty = item.correctCount === 0 ? 18 : 0;
      return { note, score: novelty + item.mistakeCount * 5 + overdueDays - item.correctCount * 0.8 };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, Math.min(3, ranked.length));
  return top[completed % Math.max(1, top.length)]?.note ?? allowedNotes[0] ?? TREBLE_NOTES[0];
}

function nextExercise(
  progress: Map<string, NoteProgress>,
  currentId: string,
  completed: number,
  retryQueue: RetryItem[],
  level: PracticeLevel,
) {
  const allowed = allowedNotesForLevel(level, completed);
  const anchor = chooseNextNote(progress, currentId, completed, retryQueue, allowed);
  return buildExercise(level, anchor, completed);
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
    // Celebration remains visual if Web Audio is unavailable.
  }
}

export function PianoTrainer() {
  const [progress, setProgress] = useState<Map<string, NoteProgress>>(new Map());
  const [profile, setProfile] = useState<PlayerProfile>(EMPTY_PROFILE);
  const [activeView, setActiveView] = useState<AppView>("practice");
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [level, setLevel] = useState<PracticeLevel>(1);
  const [exercise, setExercise] = useState<PracticeExercise>(() => buildExercise(1, TREBLE_NOTES[0], 0));
  const [activeIndex, setActiveIndex] = useState(0);
  const [practiceMode, setPracticeMode] = useState<PracticeMode | null>(null);
  const [completed, setCompleted] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [roundPoints, setRoundPoints] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "ready", message: readyMessage(null, 1) });
  const [showHint, setShowHint] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [rhythmRunning, setRhythmRunning] = useState(false);
  const [countIn, setCountIn] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(0);
  const retryQueueRef = useRef<RetryItem[]>([]);
  const questionStartedRef = useRef(0);
  const sessionStartedRef = useRef(0);
  const rhythmStartRef = useRef(0);
  const hadMistakeRef = useRef(false);
  const celebratedRef = useRef(false);
  const modeRef = useRef<PracticeMode | null>(null);
  const metronomeContextRef = useRef<AudioContext | null>(null);
  const lastMetronomeBeatRef = useRef(-1);
  const pitchResetRef = useRef<() => void>(() => undefined);
  const stateRef = useRef({ exercise, activeIndex, completed, progress, isLocked, streak, level, rhythmRunning });

  const levelConfig = getLevelConfig(level);
  const currentTarget = exercise.items[activeIndex] ?? exercise.items[0];

  useEffect(() => {
    stateRef.current = { exercise, activeIndex, completed, progress, isLocked, streak, level, rhythmRunning };
  }, [exercise, activeIndex, completed, progress, isLocked, streak, level, rhythmRunning]);

  const stopRhythm = useCallback(() => {
    setRhythmRunning(false);
    setCountIn(0);
    setCurrentBeat(0);
    lastMetronomeBeatRef.current = -1;
    if (metronomeContextRef.current && metronomeContextRef.current.state !== "closed") {
      void metronomeContextRef.current.close();
    }
    metronomeContextRef.current = null;
  }, []);

  const advance = useCallback((nextCompleted: number, latestProgress: Map<string, NoteProgress>, roundLevel: PracticeLevel) => {
    stopRhythm();
    const previousId = stateRef.current.exercise.items[stateRef.current.activeIndex]?.note.id ?? "";
    const next = nextExercise(latestProgress, previousId, nextCompleted, retryQueueRef.current, roundLevel);
    retryQueueRef.current = retryQueueRef.current.filter(
      (item) => !(next.items.some((exerciseItem) => exerciseItem.note.id === item.id) && item.releaseAt <= nextCompleted),
    );
    setExercise(next);
    setActiveIndex(0);
    setShowHint(false);
    setFeedback({ kind: "ready", message: readyMessage(modeRef.current, roundLevel) });
    hadMistakeRef.current = false;
    questionStartedRef.current = performance.now();
    setIsLocked(false);
  }, [stopRhythm]);

  const rhythmOffset = useCallback((itemIndex: number, onsetTimeMs: number, activeExercise: PracticeExercise) => {
    const tempo = getLevelConfig(activeExercise.level).tempo;
    if (!tempo || rhythmStartRef.current <= 0) return undefined;
    const beatMs = 60_000 / tempo;
    const offsetBeats = activeExercise.items.slice(0, itemIndex).reduce((sum, item) => sum + item.beats, 0);
    const firstTarget = rhythmStartRef.current + offsetBeats * beatMs;
    const cycleMs = activeExercise.totalBeats * beatMs;
    const cycles = Math.round((onsetTimeMs - firstTarget) / cycleMs);
    return Math.abs(onsetTimeMs - (firstTarget + Math.max(0, cycles) * cycleMs));
  }, []);

  const handlePlayedMidi = useCallback(async (playedMidi: number, onsetTimeMs = performance.now()) => {
    const state = stateRef.current;
    const config = getLevelConfig(state.level);
    if (state.isLocked || state.completed >= config.roundLength) return;
    if (state.level > 1 && !state.rhythmRunning) {
      setFeedback({ kind: "ready", message: "Press Start the beat, then play when the pulse glows." });
      return;
    }
    if (state.level > 1 && onsetTimeMs < rhythmStartRef.current - 35) {
      setFeedback({ kind: "ready", message: "Wait for the count-in to reach 1, then begin." });
      return;
    }

    const target = state.exercise.items[state.activeIndex] ?? state.exercise.items[0];
    if (!target) return;
    setIsLocked(true);
    if (questionStartedRef.current === 0) questionStartedRef.current = onsetTimeMs;
    if (sessionStartedRef.current === 0) sessionStartedRef.current = onsetTimeMs;
    const responseMs = Math.max(250, performance.now() - questionStartedRef.current);
    const timingOffsetMs = state.level > 1 ? rhythmOffset(state.activeIndex, onsetTimeMs, state.exercise) : undefined;
    const item = state.progress.get(target.note.id);
    if (!item) {
      setIsLocked(false);
      return;
    }

    if (playedMidi !== target.note.midi) {
      hadMistakeRef.current = true;
      setMistakeCount((value) => value + 1);
      setStreak(0);
      setFeedback({ kind: "wrong", message: `${midiToLabel(playedMidi)} was heard—look once more for ${target.note.label}.` });
      if (!retryQueueRef.current.some((retry) => retry.id === target.note.id)) {
        retryQueueRef.current.push({ id: target.note.id, releaseAt: state.completed + 2 });
      }
      try {
        const updated = await recordMistake(item, playedMidi, responseMs, { level: state.level, timingOffsetMs });
        setProgress((previous) => new Map(previous).set(updated.id, updated));
      } catch {
        setStorageWarning("Progress could not be saved on this device, but this round can continue.");
      }
      window.setTimeout(() => {
        setIsLocked(false);
      }, 520);
      return;
    }

    const nextStreak = hadMistakeRef.current ? 0 : state.streak + 1;
    const earnedPoints = pointsForAnswer(state.level, responseMs, hadMistakeRef.current, nextStreak, timingOffsetMs);
    const timingMessage = timingOffsetMs !== undefined && timingOffsetMs > 330 ? " Right note—aim closer to the glowing beat next time." : "";
    setFeedback({
      kind: "correct",
      message: `Yes—${target.note.spokenName}! +${earnedPoints} crystals.${timingMessage}`,
    });
    setCorrectCount((value) => value + 1);
    setRoundPoints((value) => value + earnedPoints);
    setStreak(nextStreak);
    setBestStreak((value) => Math.max(value, nextStreak));
    let latestProgress = state.progress;
    try {
      const updated = await recordSuccess(
        item,
        playedMidi,
        responseMs,
        ratingForAnswer(responseMs, hadMistakeRef.current),
        { level: state.level, points: earnedPoints, timingOffsetMs },
      );
      latestProgress = new Map(state.progress).set(updated.id, updated);
      setProgress(latestProgress);
    } catch {
      setStorageWarning("Progress could not be saved on this device, but this round can continue.");
    }

    const nextItemIndex = state.activeIndex + 1;
    if (nextItemIndex < state.exercise.items.length) {
      setActiveIndex(nextItemIndex);
      hadMistakeRef.current = false;
      questionStartedRef.current = performance.now();
      window.setTimeout(() => {
        setIsLocked(false);
      }, 360);
      return;
    }

    const nextCompleted = state.completed + 1;
    setCompleted(nextCompleted);
    stopRhythm();
    if (nextCompleted < config.roundLength) {
      window.setTimeout(() => advance(nextCompleted, latestProgress, state.level), 760);
    }
  }, [advance, rhythmOffset, stopRhythm]);

  const { status, error, reading, start, stop, resetGate } = usePitchDetector(
    (event) => void handlePlayedMidi(event.midi, event.onsetTimeMs),
    currentTarget?.note.midi ?? null,
  );

  useEffect(() => {
    pitchResetRef.current = resetGate;
  }, [resetGate]);

  useEffect(() => {
    let active = true;
    Promise.all([loadLessonProgress(), loadPlayerProfile()])
      .then(([loadedProgress, loadedProfile]) => {
        if (!active) return;
        setProgress(loadedProgress);
        setProfile(loadedProfile);
        setExercise(nextExercise(loadedProgress, "", 0, [], 1));
        questionStartedRef.current = performance.now();
        sessionStartedRef.current = performance.now();
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
    if (!rhythmRunning || levelConfig.tempo === null) return;
    const beatMs = 60_000 / levelConfig.tempo;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const beforeStart = rhythmStartRef.current - now;
      if (beforeStart > 0) {
        setCountIn(Math.max(1, Math.ceil(beforeStart / beatMs)));
        return;
      }
      setCountIn(0);
      const absoluteBeat = Math.floor((now - rhythmStartRef.current) / beatMs);
      setCurrentBeat((absoluteBeat % exercise.totalBeats) + 1);
      if (absoluteBeat === lastMetronomeBeatRef.current) return;
      lastMetronomeBeatRef.current = absoluteBeat;
      const context = metronomeContextRef.current;
      if (!context || context.state === "closed") return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = absoluteBeat % exercise.totalBeats === 0 ? 1120 : 820;
      gain.gain.setValueAtTime(0.075, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.055);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
    }, 35);
    return () => window.clearInterval(timer);
  }, [exercise.totalBeats, levelConfig.tempo, rhythmRunning]);

  useEffect(() => {
    if (completed < levelConfig.roundLength || celebratedRef.current) return;
    celebratedRef.current = true;
    playVictoryChime();
    const accuracy = Math.round((correctCount / Math.max(1, correctCount + mistakeCount)) * 100);
    recordCompletedSession({
      level,
      accuracy,
      points: roundPoints,
      bestStreak,
      durationMs: Math.max(1000, performance.now() - sessionStartedRef.current),
    })
      .then((updatedProfile) => {
        setProfile(updatedProfile);
        setDashboardRevision((value) => value + 1);
      })
      .catch(() => setStorageWarning("This round finished, but its summary could not be saved."));
  }, [bestStreak, completed, correctCount, level, levelConfig.roundLength, mistakeCount, roundPoints]);

  useEffect(() => () => {
    if (metronomeContextRef.current?.state !== "closed") void metronomeContextRef.current?.close();
  }, []);

  const currentProgress = currentTarget ? progress.get(currentTarget.note.id) : undefined;
  const strength = currentProgress ? memoryStrength(currentProgress) : 0;
  const detectedLabel = reading ? midiToLabel(reading.midi) : "—";
  const accuracy = useMemo(
    () => Math.round((correctCount / Math.max(1, correctCount + mistakeCount)) * 100),
    [correctCount, mistakeCount],
  );

  async function selectMode(mode: PracticeMode) {
    modeRef.current = mode;
    setPracticeMode(mode);
    setFeedback({ kind: "ready", message: readyMessage(mode, level) });
    questionStartedRef.current = performance.now();
    sessionStartedRef.current = performance.now();
    if (mode === "acoustic") await start();
    else if (status === "listening") await stop();
  }

  async function changeMode() {
    stopRhythm();
    if (status === "listening") await stop();
    modeRef.current = null;
    setPracticeMode(null);
    setShowHint(false);
  }

  function resetRound(nextLevel: PracticeLevel = level, latestProgress = progress) {
    stopRhythm();
    setCompleted(0);
    setCorrectCount(0);
    setMistakeCount(0);
    setStreak(0);
    setBestStreak(0);
    setRoundPoints(0);
    setActiveIndex(0);
    retryQueueRef.current = [];
    celebratedRef.current = false;
    setExercise(nextExercise(latestProgress, "", 0, [], nextLevel));
    setFeedback({ kind: "ready", message: readyMessage(practiceMode, nextLevel) });
    setShowHint(false);
    setIsLocked(false);
    hadMistakeRef.current = false;
    questionStartedRef.current = 0;
    sessionStartedRef.current = 0;
    pitchResetRef.current();
  }

  function chooseLevel(nextLevel: PracticeLevel) {
    if (nextLevel === level) return;
    setLevel(nextLevel);
    resetRound(nextLevel);
  }

  async function startRhythm() {
    if (!levelConfig.tempo) return;
    stopRhythm();
    const context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    metronomeContextRef.current = context;
    const beatMs = 60_000 / levelConfig.tempo;
    rhythmStartRef.current = performance.now() + beatMs * 4;
    lastMetronomeBeatRef.current = -1;
    setCountIn(4);
    setCurrentBeat(0);
    setRhythmRunning(true);
    setFeedback({ kind: "ready", message: "Count 4, then play each note when its beat glows." });
  }

  async function showView(view: AppView) {
    if (view === "progress") {
      stopRhythm();
      if (status === "listening") await stop();
      setDashboardRevision((value) => value + 1);
    }
    setActiveView(view);
  }

  function handleStatsReset(resetProgress: Map<string, NoteProgress>, resetProfile: PlayerProfile) {
    setProgress(resetProgress);
    setProfile(resetProfile);
    setDashboardRevision((value) => value + 1);
    resetRound(level, resetProgress);
  }

  const shellClass = practiceMode ? `${practiceMode}-mode` : "mode-selecting";

  if (isLoading) {
    return <main className="trainer-shell loading-screen" aria-busy="true">Warming up the piano…</main>;
  }

  return (
    <main className={`app-shell ${shellClass}`}>
      <header className="app-header">
        <button className="brand brand-button" type="button" onClick={() => void showView("practice")} aria-label="Open practice">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <span className="brand-copy"><strong>OpenMemoChords</strong><small>Read · listen · remember</small></span>
        </button>
        <nav className="app-tabs" aria-label="Main navigation">
          <button type="button" className={activeView === "practice" ? "active" : ""} aria-current={activeView === "practice" ? "page" : undefined} onClick={() => void showView("practice")}><span aria-hidden="true">♫</span> Practice</button>
          <button type="button" className={activeView === "progress" ? "active" : ""} aria-current={activeView === "progress" ? "page" : undefined} onClick={() => void showView("progress")}><span aria-hidden="true">▥</span> Progress</button>
        </nav>
        <div className="header-actions">
          <div className="points-wallet" aria-label={`${profile.lifetimePoints} lifetime crystals`}><span aria-hidden="true">◆</span><strong>{profile.lifetimePoints}</strong><small>crystals</small></div>
          {practiceMode && activeView === "practice" ? <button className="change-mode" type="button" onClick={() => void changeMode()}>Change setup</button> : null}
        </div>
      </header>

      {activeView === "progress" ? (
        <ProgressDashboard revision={dashboardRevision} onReset={handleStatsReset} />
      ) : !practiceMode ? (
        <section className="mode-shell">
          <div className="watercolor-cloud cloud-one" aria-hidden="true" />
          <div className="watercolor-cloud cloud-two" aria-hidden="true" />
          <div className="frost-corner top-left" aria-hidden="true">❄</div>
          <div className="frost-corner bottom-right" aria-hidden="true">✦</div>
          <div className="mode-picker">
            <p className="level-pill">A four-level music-reading journey</p>
            <h1>How would you like to play?</h1>
            <p className="mode-intro">Choose your setup. The music stays large, calm, and easy to see.</p>
            <div className="mode-options">
              <button className="mode-card acoustic-choice" type="button" onClick={() => void selectMode("acoustic")}>
                <span className="mode-icon" aria-hidden="true">♬</span>
                <span className="mode-card-copy"><strong>Have a Piano</strong><small>Play your real piano with voice-resistant listening</small></span>
                <span className="mode-arrow" aria-hidden="true">→</span>
              </button>
              <button className="mode-card virtual-choice" type="button" onClick={() => void selectMode("virtual")}>
                <span className="mode-icon keys-icon" aria-hidden="true">▥</span>
                <span className="mode-card-copy"><strong>No Piano</strong><small>Practice with large on-screen keys</small></span>
                <span className="mode-arrow" aria-hidden="true">→</span>
              </button>
            </div>
            <div className="curriculum-preview">
              {LEVELS.map((item) => <span key={item.id}><strong>{item.id}</strong>{item.name}</span>)}
            </div>
            <p className="adaptive-note"><span aria-hidden="true">✦</span> Missed notes return sooner, right when memory needs them.</p>
          </div>
        </section>
      ) : (
        <div className="practice-page">
          <nav className="level-tabs" aria-label="Practice level">
            {LEVELS.map((item) => (
              <button type="button" className={level === item.id ? "active" : ""} aria-current={level === item.id ? "step" : undefined} onClick={() => chooseLevel(item.id)} key={item.id}>
                <span>Level {item.id}</span><strong>{item.name}</strong><small>{item.skill}</small>
              </button>
            ))}
          </nav>

          {completed >= levelConfig.roundLength ? (
            <section className="session-complete winter-celebration">
              <div className="winter-sky" aria-hidden="true">
                <span className="star star-one">✦</span><span className="star star-two">·</span><span className="star star-three">✧</span><span className="star star-four">·</span>
                <div className="aurora" />
                <div className="ice-mountain mountain-left" />
                <div className="ice-mountain mountain-right" />
                <div className="crystal-palace"><i /><i /><i /><b /><b /></div>
              </div>
              <div className="snowflake-border" aria-hidden="true"><span>❄</span><span>✦</span><span>❅</span><span>✧</span><span>❄</span></div>
              <div className="celebration-content">
                <div className="crystal-crown" aria-hidden="true"><span>♛</span></div>
                <p className="eyebrow ice-eyebrow">Level {level} complete</p>
                <h1>{level === 4 ? "Aurora Maestro!" : "Crystal Crown earned!"}</h1>
                <p className="celebration-copy">Your music made the ice palace glow. Every careful note strengthened your reading magic.</p>
                <div className="crystal-stats">
                  <div><strong>{accuracy}%</strong><span>accuracy</span></div>
                  <div><strong>+{roundPoints}</strong><span>crystals</span></div>
                  <div><strong>{bestStreak}</strong><span>best streak</span></div>
                </div>
                <p className="palace-progress"><span aria-hidden="true">◆</span> {profile.lifetimePoints} lifetime crystals · {profile.crowns} crowns</p>
                <button className="ice-button" type="button" onClick={() => resetRound()}>Play another round</button>
                <button className="celebration-mode-button" type="button" onClick={() => void showView("progress")}>See my progress</button>
              </div>
            </section>
          ) : (
            <section className="practice-card focus-card">
              <div className="practice-heading">
                <div>
                  <p className="eyebrow">Level {level} · {levelConfig.name} · {exercise.clef === "bass" ? "Left hand" : "Right hand"}</p>
                  <h1>{level === 1 ? "Play this note" : "Play with the beat"}</h1>
                  <p className="level-description">{levelConfig.description}</p>
                </div>
                <div className="round-hud">
                  <div className="score-badge"><span aria-hidden="true">◆</span><strong>{roundPoints}</strong><small>this round</small></div>
                  <div className="streak-badge"><span aria-hidden="true">✦</span><strong>{streak}</strong><small>streak</small></div>
                  <div className="crystal-progress" aria-label={`${completed} of ${levelConfig.roundLength} exercises complete`}>
                    {Array.from({ length: levelConfig.roundLength }, (_, index) => (
                      <span className={index < completed ? "earned" : ""} key={index} aria-hidden="true">◆</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="notation-stage">
                <span className="single-note-label">{level === 1 ? "One note" : `${exercise.items.length} notes · 4 beats`}</span>
                <StaffExercise exercise={exercise} activeIndex={activeIndex} />
                {countIn > 0 ? <div className="count-in" role="status"><span>Ready</span><strong>{countIn}</strong></div> : null}
              </div>

              {level > 1 ? (
                <div className="rhythm-coach">
                  <div className="beat-lane" aria-label={`Four beat measure, beat ${currentBeat || "not started"}`}>
                    {Array.from({ length: exercise.totalBeats }, (_, index) => <span className={currentBeat === index + 1 ? "active" : ""} key={index}><strong>{index + 1}</strong></span>)}
                  </div>
                  <div className="rhythm-actions">
                    <span><strong>{levelConfig.tempo}</strong> BPM</span>
                    <span>{exercise.items.map((item) => noteValueName(item.beats)).join(" · ")}</span>
                    <button type="button" className="beat-button" onClick={() => void startRhythm()}>{rhythmRunning ? "Restart the beat" : "Start the beat"}</button>
                  </div>
                </div>
              ) : null}

              <div className="response-row">
                <div className={`feedback ${feedback.kind}`} role="status" aria-live="polite">{feedback.message}</div>
                {practiceMode === "acoustic" ? (
                  <div className={`ear-status ${status}`}>
                    <span className="ear-dot" aria-hidden="true" />
                    <span>{status === "listening" ? "Noise guard on" : "Piano ear"}</span>
                    <strong>{status === "listening" ? detectedLabel : "Off"}</strong>
                  </div>
                ) : null}
              </div>

              {showHint && currentTarget ? <p className="hint-copy">Hint: look {currentTarget.note.hint}. This is a {noteValueName(currentTarget.beats)} worth {currentTarget.beats} {currentTarget.beats === 1 ? "beat" : "beats"}.</p> : null}
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

              {practiceMode === "virtual" && currentTarget ? (
                <div className="piano-area">
                  <div className="piano-heading"><strong>Tap the note</strong><span>{exercise.clef === "bass" ? "Low C to middle C" : "Middle C to high C"}</span></div>
                  <PianoKeyboard
                    onPlay={(midi, onsetTimeMs) => void handlePlayedMidi(midi, onsetTimeMs)}
                    showLabels={showHint}
                    targetId={currentTarget.note.id}
                    notes={exercise.clef === "bass" ? BASS_NOTES : TREBLE_NOTES}
                  />
                </div>
              ) : null}

              <div className="practice-footer">
                <span><strong>{strength}%</strong> memory strength</span>
                <span><strong>{currentProgress?.mistakeCount ?? 0}</strong> helpful retries</span>
                <span className="adaptive-mini"><strong>↻</strong> Missed notes return sooner</span>
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
