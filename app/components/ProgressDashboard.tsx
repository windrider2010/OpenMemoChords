"use client";

import { useEffect, useMemo, useState } from "react";
import { LEVELS } from "../lib/curriculum";
import {
  loadDashboardSnapshot,
  memoryStrength,
  resetAllStats,
  type DashboardSnapshot,
  type NoteProgress,
  type PlayerProfile,
  type PracticeAttempt,
} from "../lib/progress";
import { ALL_LESSON_NOTES } from "../lib/notes";

const REWARDS = [
  { points: 0, name: "Snowlight Garden", icon: "✦" },
  { points: 250, name: "Frost Fountain", icon: "❄" },
  { points: 600, name: "Crystal Hall", icon: "♜" },
  { points: 1200, name: "Aurora Crown", icon: "♛" },
];

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function accuracyFor(attempts: PracticeAttempt[]) {
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.correct).length / attempts.length) * 100);
}

function trendFor(noteId: string, attempts: PracticeAttempt[]) {
  const now = Date.now();
  const recentCutoff = now - 7 * 86_400_000;
  const earlierCutoff = now - 14 * 86_400_000;
  const recent = attempts.filter((attempt) => attempt.noteId === noteId && attempt.createdAt.getTime() >= recentCutoff);
  const earlier = attempts.filter(
    (attempt) => attempt.noteId === noteId && attempt.createdAt.getTime() >= earlierCutoff && attempt.createdAt.getTime() < recentCutoff,
  );
  if (recent.length === 0) return { label: "not seen this week", direction: "flat" };
  if (earlier.length === 0) return { label: "new this week", direction: "up" };
  const difference = accuracyFor(recent) - accuracyFor(earlier);
  if (difference >= 5) return { label: `↑ ${difference}%`, direction: "up" };
  if (difference <= -5) return { label: `↓ ${Math.abs(difference)}%`, direction: "down" };
  return { label: "steady", direction: "flat" };
}

function rewardState(points: number) {
  let current = REWARDS[0];
  let next = REWARDS[1];
  for (let index = 0; index < REWARDS.length; index += 1) {
    if (points >= REWARDS[index].points) current = REWARDS[index];
    if (points < REWARDS[index].points) {
      next = REWARDS[index];
      break;
    }
    if (index === REWARDS.length - 1) next = REWARDS[index];
  }
  const range = Math.max(1, next.points - current.points);
  const progress = current === next ? 100 : Math.round(((points - current.points) / range) * 100);
  return { current, next, progress };
}

export function ProgressDashboard({
  revision,
  onReset,
}: {
  revision: number;
  onReset: (progress: Map<string, NoteProgress>, profile: PlayerProfile) => void;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    let active = true;
    loadDashboardSnapshot()
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setLoadError("Progress could not be read on this device.");
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return { date, key: dayKey(date), attempts: [] as PracticeAttempt[] };
    });
    snapshot?.attempts.forEach((attempt) => {
      const day = days.find((item) => item.key === dayKey(attempt.createdAt));
      if (day) day.attempts.push(attempt);
    });
    return days.map((day) => ({ ...day, accuracy: accuracyFor(day.attempts) }));
  }, [snapshot]);

  if (!snapshot && !loadError) {
    return <section className="dashboard-shell dashboard-loading" aria-busy="true">Gathering your crystal journal…</section>;
  }

  if (!snapshot) return <section className="dashboard-shell error-copy">{loadError}</section>;

  const totalAttempts = snapshot.attempts.length;
  const overallAccuracy = accuracyFor(snapshot.attempts);
  const practiceDays = new Set(snapshot.attempts.map((attempt) => dayKey(attempt.createdAt))).size;
  const reward = rewardState(snapshot.profile.lifetimePoints);
  const noteRows = ALL_LESSON_NOTES.map((note) => {
    const item = snapshot.progress.get(note.id);
    return {
      note,
      strength: item ? memoryStrength(item) : 0,
      attempts: item ? item.correctCount + item.mistakeCount : 0,
      trend: trendFor(note.id, snapshot.attempts),
    };
  });

  async function handleReset() {
    setIsResetting(true);
    try {
      const reset = await resetAllStats();
      onReset(reset.progress, reset.profile);
      setSnapshot(await loadDashboardSnapshot());
      setConfirmReset(false);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <section className="dashboard-shell">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow ice-ink">Crystal journal</p>
          <h1>See every note grow</h1>
          <p>Accuracy, memory strength, and practice history are saved only on this device.</p>
        </div>
        <div className="dashboard-crown" aria-label={`${snapshot.profile.crowns} completed practice crowns`}>
          <span aria-hidden="true">♛</span><strong>{snapshot.profile.crowns}</strong><small>crowns</small>
        </div>
      </div>

      <div className="summary-grid">
        <article><span>Lifetime crystals</span><strong>{snapshot.profile.lifetimePoints}</strong><small>unlock palace rewards</small></article>
        <article><span>Overall accuracy</span><strong>{overallAccuracy}%</strong><small>{totalAttempts} notes heard</small></article>
        <article><span>Practice days</span><strong>{practiceDays}</strong><small>{snapshot.sessions.length} completed rounds</small></article>
        <article><span>Best streak</span><strong>{snapshot.profile.bestStreak}</strong><small>correct first tries</small></article>
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-card weekly-card">
          <div className="card-heading"><div><span>This week</span><h2>Accuracy journey</h2></div><strong>{accuracyFor(week.flatMap((day) => day.attempts))}%</strong></div>
          <div className="week-chart">
            {week.map((day) => (
              <div className="day-column" key={day.key} aria-label={`${day.date.toLocaleDateString(undefined, { weekday: "long" })}: ${day.accuracy}% accuracy from ${day.attempts.length} attempts`}>
                <div className="bar-track"><span style={{ height: `${Math.max(day.attempts.length ? 8 : 2, day.accuracy)}%` }} /></div>
                <strong>{day.attempts.length ? `${day.accuracy}%` : "—"}</strong>
                <small>{day.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card reward-card">
          <div className="reward-scene" aria-hidden="true"><span>{reward.current.icon}</span></div>
          <span>Crystal palace</span>
          <h2>{reward.current.name}</h2>
          <p>{reward.current === reward.next ? "Every palace reward is glowing." : `${reward.next.points - snapshot.profile.lifetimePoints} crystals until ${reward.next.name}.`}</p>
          <div className="reward-meter" aria-label={`${reward.progress}% toward ${reward.next.name}`}><span style={{ width: `${reward.progress}%` }} /></div>
          <div className="reward-tiers">
            {REWARDS.map((tier) => <span className={snapshot.profile.lifetimePoints >= tier.points ? "unlocked" : ""} key={tier.name} title={`${tier.name}: ${tier.points} crystals`}>{tier.icon}</span>)}
          </div>
        </article>
      </div>

      <article className="dashboard-card mastery-card">
        <div className="card-heading"><div><span>Adaptive memory</span><h2>Note mastery</h2></div><small>Recent 7 days vs previous 7</small></div>
        <div className="mastery-list">
          {noteRows.map(({ note, strength, attempts, trend }) => (
            <div className="mastery-row" key={note.id}>
              <div className="note-token"><strong>{note.label}</strong><small>{note.id}</small></div>
              <div className="mastery-detail">
                <div><strong>{note.spokenName}</strong><span>{attempts} tries</span></div>
                <div className="mastery-meter" aria-label={`${note.spokenName}: ${strength}% memory strength`}><span style={{ width: `${strength}%` }} /></div>
              </div>
              <strong className="strength-number">{strength}%</strong>
              <span className={`trend-chip ${trend.direction}`}>{trend.label}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="dashboard-card level-history">
        <div className="card-heading"><div><span>Curriculum</span><h2>Level activity</h2></div></div>
        <div className="level-history-grid">
          {LEVELS.map((level) => {
            const sessions = snapshot.sessions.filter((session) => session.level === level.id);
            const average = sessions.length ? Math.round(sessions.reduce((sum, session) => sum + session.accuracy, 0) / sessions.length) : 0;
            return <div key={level.id}><span>Level {level.id}</span><strong>{sessions.length}</strong><small>rounds · {average}% avg</small></div>;
          })}
        </div>
      </article>

      <div className="reset-zone">
        {!confirmReset ? (
          <button className="reset-link" type="button" onClick={() => setConfirmReset(true)}>Reset all stats</button>
        ) : (
          <div className="reset-confirm" role="alert">
            <div><strong>Start the crystal journal over?</strong><span>This permanently removes note history, crowns, and crystals from this device.</span></div>
            <button type="button" onClick={() => void handleReset()} disabled={isResetting}>{isResetting ? "Resetting…" : "Yes, reset everything"}</button>
            <button type="button" onClick={() => setConfirmReset(false)} disabled={isResetting}>Keep my progress</button>
          </div>
        )}
      </div>
    </section>
  );
}
