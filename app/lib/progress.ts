import Dexie, { type Table } from "dexie";
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import { LESSON_NOTES } from "./notes";

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
}

class OpenMemoDatabase extends Dexie {
  noteProgress!: Table<NoteProgress, string>;
  attempts!: Table<PracticeAttempt, number>;

  constructor() {
    super("openmemo-chords");
    this.version(1).stores({
      noteProgress: "id, card.due, lastPlayedAt",
      attempts: "++id, noteId, correct, createdAt",
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

export async function loadLessonProgress() {
  const saved = await database.noteProgress.bulkGet(LESSON_NOTES.map((note) => note.id));
  const records = saved.map((item, index) => restoreDates(item ?? emptyProgress(LESSON_NOTES[index].id)));
  await database.noteProgress.bulkPut(records);
  return new Map(records.map((record) => [record.id, record]));
}

export async function recordMistake(progress: NoteProgress, playedMidi: number, responseMs: number) {
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
    });
  });
  return updated;
}

export async function recordSuccess(
  progress: NoteProgress,
  playedMidi: number,
  responseMs: number,
  grade: Grade,
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
    });
  });
  return updated;
}

export function ratingForAnswer(responseMs: number, hadMistake: boolean): Grade {
  if (hadMistake || responseMs > 8000) return Rating.Hard;
  if (responseMs < 2600) return Rating.Easy;
  return Rating.Good;
}

export function memoryStrength(progress: NoteProgress) {
  if (progress.correctCount === 0) return 0;
  const accuracy = progress.correctCount / (progress.correctCount + progress.mistakeCount);
  const stability = Math.min(1, progress.card.stability / 14);
  return Math.round((accuracy * 0.65 + stability * 0.35) * 100);
}
