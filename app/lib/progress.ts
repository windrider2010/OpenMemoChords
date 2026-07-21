import Dexie, { type Table } from "dexie";
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import { getLevelConfig, type PracticeLevel } from "./curriculum";
import { ALL_LESSON_NOTES } from "./notes";

export interface NoteProgress {
  id: string;
  card: Card;
  correctCount: number;
  mistakeCount: number;
  totalResponseMs: number;
  lastPlayedAt?: Date;
}

export interface PracticeAttempt {
  id?: number;
  noteId: string;
  playedMidi: number;
  correct: boolean;
  responseMs: number;
  createdAt: Date;
  level?: PracticeLevel;
  points?: number;
  timingOffsetMs?: number;
}

export interface PracticeSession {
  id?: number;
  level: PracticeLevel;
  accuracy: number;
  points: number;
  bestStreak: number;
  durationMs: number;
  createdAt: Date;
}

export interface PlayerProfile {
  id: "player";
  lifetimePoints: number;
  crowns: number;
  bestStreak: number;
  lastPlayedAt?: Date;
}

export interface AttemptContext {
  level: PracticeLevel;
  points?: number;
  timingOffsetMs?: number;
}

export interface DashboardSnapshot {
  progress: Map<string, NoteProgress>;
  attempts: PracticeAttempt[];
  sessions: PracticeSession[];
  profile: PlayerProfile;
}

class OpenMemoDatabase extends Dexie {
  noteProgress!: Table<NoteProgress, string>;
  attempts!: Table<PracticeAttempt, number>;
  sessions!: Table<PracticeSession, number>;
  playerProfile!: Table<PlayerProfile, string>;

  constructor() {
    super("openmemo-chords");
    this.version(1).stores({
      noteProgress: "id, card.due, lastPlayedAt",
      attempts: "++id, noteId, correct, createdAt",
    });
    this.version(2).stores({
      noteProgress: "id, card.due, lastPlayedAt",
      attempts: "++id, noteId, correct, createdAt, level",
      sessions: "++id, createdAt, level",
      playerProfile: "id, lastPlayedAt",
    });
  }
}

const database = new OpenMemoDatabase();
const scheduler = fsrs({
  request_retention: 0.92,
  maximum_interval: 60,
  enable_fuzz: false,
  enable_short_term: false,
});

function restoreDates(progress: NoteProgress): NoteProgress {
  return {
    ...progress,
    card: {
      ...progress.card,
      due: new Date(progress.card.due),
      last_review: progress.card.last_review ? new Date(progress.card.last_review) : undefined,
    },
    lastPlayedAt: progress.lastPlayedAt ? new Date(progress.lastPlayedAt) : undefined,
  };
}

function emptyProgress(id: string): NoteProgress {
  return {
    id,
    card: createEmptyCard(new Date()),
    correctCount: 0,
    mistakeCount: 0,
    totalResponseMs: 0,
  };
}

function emptyProfile(): PlayerProfile {
  return { id: "player", lifetimePoints: 0, crowns: 0, bestStreak: 0 };
}

export async function loadLessonProgress() {
  const saved = await database.noteProgress.bulkGet(ALL_LESSON_NOTES.map((note) => note.id));
  const records = saved.map((item, index) => restoreDates(item ?? emptyProgress(ALL_LESSON_NOTES[index].id)));
  await database.noteProgress.bulkPut(records);
  return new Map(records.map((record) => [record.id, record]));
}

export async function loadPlayerProfile() {
  const saved = await database.playerProfile.get("player");
  if (saved) return { ...saved, lastPlayedAt: saved.lastPlayedAt ? new Date(saved.lastPlayedAt) : undefined };
  const profile = emptyProfile();
  await database.playerProfile.put(profile);
  return profile;
}

export async function recordMistake(
  progress: NoteProgress,
  playedMidi: number,
  responseMs: number,
  context: AttemptContext,
) {
  const updated: NoteProgress = {
    ...progress,
    mistakeCount: progress.mistakeCount + 1,
    lastPlayedAt: new Date(),
  };
  await database.transaction("rw", database.noteProgress, database.attempts, async () => {
    await database.noteProgress.put(updated);
    await database.attempts.add({
      noteId: progress.id,
      playedMidi,
      correct: false,
      responseMs,
      createdAt: new Date(),
      level: context.level,
      points: 0,
      timingOffsetMs: context.timingOffsetMs,
    });
  });
  return updated;
}

export async function recordSuccess(
  progress: NoteProgress,
  playedMidi: number,
  responseMs: number,
  grade: Grade,
  context: AttemptContext,
) {
  const now = new Date();
  const updated: NoteProgress = {
    ...progress,
    card: scheduler.next(progress.card, now, grade).card,
    correctCount: progress.correctCount + 1,
    totalResponseMs: progress.totalResponseMs + responseMs,
    lastPlayedAt: now,
  };
  await database.transaction("rw", database.noteProgress, database.attempts, async () => {
    await database.noteProgress.put(updated);
    await database.attempts.add({
      noteId: progress.id,
      playedMidi,
      correct: true,
      responseMs,
      createdAt: now,
      level: context.level,
      points: context.points ?? 0,
      timingOffsetMs: context.timingOffsetMs,
    });
  });
  return updated;
}

export async function recordCompletedSession(session: Omit<PracticeSession, "id" | "createdAt">) {
  const profile = await loadPlayerProfile();
  const now = new Date();
  const updated: PlayerProfile = {
    ...profile,
    lifetimePoints: profile.lifetimePoints + session.points,
    crowns: profile.crowns + 1,
    bestStreak: Math.max(profile.bestStreak, session.bestStreak),
    lastPlayedAt: now,
  };
  await database.transaction("rw", database.sessions, database.playerProfile, async () => {
    await database.sessions.add({ ...session, createdAt: now });
    await database.playerProfile.put(updated);
  });
  return updated;
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [progress, attempts, sessions, profile] = await Promise.all([
    loadLessonProgress(),
    database.attempts.orderBy("createdAt").toArray(),
    database.sessions.orderBy("createdAt").toArray(),
    loadPlayerProfile(),
  ]);
  return {
    progress,
    attempts: attempts.map((attempt) => ({ ...attempt, createdAt: new Date(attempt.createdAt) })),
    sessions: sessions.map((session) => ({ ...session, createdAt: new Date(session.createdAt) })),
    profile,
  };
}

export async function resetAllStats() {
  const records = ALL_LESSON_NOTES.map((note) => emptyProgress(note.id));
  const profile = emptyProfile();
  await database.transaction(
    "rw",
    database.noteProgress,
    database.attempts,
    database.sessions,
    database.playerProfile,
    async () => {
      await database.noteProgress.clear();
      await database.attempts.clear();
      await database.sessions.clear();
      await database.playerProfile.clear();
      await database.noteProgress.bulkPut(records);
      await database.playerProfile.put(profile);
    },
  );
  return { progress: new Map(records.map((record) => [record.id, record])), profile };
}

export function ratingForAnswer(responseMs: number, hadMistake: boolean): Grade {
  if (hadMistake || responseMs > 8000) return Rating.Hard;
  if (responseMs < 2600) return Rating.Easy;
  return Rating.Good;
}

export function pointsForAnswer(
  level: PracticeLevel,
  responseMs: number,
  hadMistake: boolean,
  streak: number,
  timingOffsetMs?: number,
) {
  const base = getLevelConfig(level).basePoints;
  const firstTryBonus = hadMistake ? 0 : 5;
  const speedBonus = hadMistake ? 0 : Math.max(0, Math.round(7 - responseMs / 1300));
  const streakBonus = Math.min(10, Math.max(0, streak - 1) * 2);
  const rhythmBonus = timingOffsetMs === undefined ? 0 : timingOffsetMs < 140 ? 8 : timingOffsetMs < 280 ? 4 : 0;
  return base + firstTryBonus + speedBonus + streakBonus + rhythmBonus;
}

export function memoryStrength(progress: NoteProgress) {
  if (progress.correctCount === 0) return 0;
  const accuracy = progress.correctCount / (progress.correctCount + progress.mistakeCount);
  const stability = Math.min(1, progress.card.stability / 14);
  return Math.round((accuracy * 0.65 + stability * 0.35) * 100);
}
