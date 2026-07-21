import { BASS_NOTES, TREBLE_NOTES, type LessonNote } from "./notes";

export type PracticeLevel = 1 | 2 | 3 | 4;
export type StaffClef = "treble" | "bass";
export type NoteBeats = 1 | 2 | 4;

export interface ExerciseItem {
  note: LessonNote;
  beats: NoteBeats;
}

export interface PracticeExercise {
  id: string;
  level: PracticeLevel;
  clef: StaffClef;
  items: ExerciseItem[];
  totalBeats: number;
}

export interface LevelConfig {
  id: PracticeLevel;
  name: string;
  title: string;
  description: string;
  skill: string;
  roundLength: number;
  tempo: number | null;
  basePoints: number;
}

export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: "Note Explorer",
    title: "One note at a time",
    description: "Read C4–C5 on the treble staff with no time pressure.",
    skill: "Pitch landmarks",
    roundLength: 10,
    tempo: null,
    basePoints: 10,
  },
  {
    id: 2,
    name: "Beat Builder",
    title: "Quarter and half notes",
    description: "Follow a steady four-beat pulse and feel one-beat and two-beat notes.",
    skill: "Note values + pulse",
    roundLength: 6,
    tempo: 66,
    basePoints: 14,
  },
  {
    id: 3,
    name: "Melody Steps",
    title: "Short stepwise melodies",
    description: "Read small melodic patterns while keeping the beat moving.",
    skill: "Intervals + rhythm",
    roundLength: 6,
    tempo: 72,
    basePoints: 18,
  },
  {
    id: 4,
    name: "Grand Staff Quest",
    title: "Treble and bass journeys",
    description: "Alternate right- and left-hand phrases across the grand staff.",
    skill: "Two clefs + phrases",
    roundLength: 5,
    tempo: 76,
    basePoints: 24,
  },
];

export function getLevelConfig(level: PracticeLevel) {
  return LEVELS[level - 1];
}

export function allowedNotesForLevel(level: PracticeLevel, seed: number) {
  if (level === 2) return TREBLE_NOTES.slice(0, 6);
  if (level === 4 && seed % 2 === 0) return BASS_NOTES;
  return TREBLE_NOTES;
}

function noteAt(notes: LessonNote[], anchor: LessonNote, offset: number) {
  const anchorIndex = Math.max(0, notes.findIndex((note) => note.id === anchor.id));
  const reflected = Math.abs(anchorIndex + offset) % Math.max(1, notes.length * 2 - 2);
  const index = reflected >= notes.length ? notes.length * 2 - 2 - reflected : reflected;
  return notes[index] ?? notes[0];
}

export function buildExercise(level: PracticeLevel, anchor: LessonNote, seed: number): PracticeExercise {
  const notes = allowedNotesForLevel(level, seed);
  const clef: StaffClef = level === 4 && seed % 2 === 0 ? "bass" : "treble";

  if (level === 1) {
    return { id: `1-${seed}-${anchor.id}`, level, clef: "treble", items: [{ note: anchor, beats: 1 }], totalBeats: 1 };
  }

  if (level === 2) {
    const offsets = seed % 2 === 0 ? [0, 1, 0] : [0, -1, 1];
    const beats: NoteBeats[] = seed % 2 === 0 ? [1, 1, 2] : [2, 1, 1];
    return {
      id: `2-${seed}-${anchor.id}`,
      level,
      clef,
      totalBeats: 4,
      items: offsets.map((offset, index) => ({ note: noteAt(notes, anchor, offset), beats: beats[index] })),
    };
  }

  if (level === 3) {
    const offsets = seed % 3 === 0 ? [0, 1, 2, 1] : seed % 3 === 1 ? [0, -1, 0] : [0, 1, -1];
    const beats: NoteBeats[] = offsets.length === 4 ? [1, 1, 1, 1] : seed % 3 === 1 ? [1, 1, 2] : [2, 1, 1];
    return {
      id: `3-${seed}-${anchor.id}`,
      level,
      clef,
      totalBeats: 4,
      items: offsets.map((offset, index) => ({ note: noteAt(notes, anchor, offset), beats: beats[index] })),
    };
  }

  const offsets = seed % 3 === 0 ? [0, 1, 2, 1] : seed % 3 === 1 ? [0, -1, -2, -1] : [0, 2, 1];
  const beats: NoteBeats[] = offsets.length === 4 ? [1, 1, 1, 1] : [1, 1, 2];
  return {
    id: `4-${seed}-${clef}-${anchor.id}`,
    level,
    clef,
    totalBeats: 4,
    items: offsets.map((offset, index) => ({ note: noteAt(notes, anchor, offset), beats: beats[index] })),
  };
}

export function noteValueName(beats: NoteBeats) {
  if (beats === 4) return "whole note";
  if (beats === 2) return "half note";
  return "quarter note";
}
