export interface LessonNote {
  id: string;
  midi: number;
  vexKey: string;
  label: string;
  spokenName: string;
  hint: string;
}

export const TREBLE_NOTES: LessonNote[] = [
  { id: "C4", midi: 60, vexKey: "c/4", label: "C", spokenName: "middle C", hint: "on the short ledger line below the staff" },
  { id: "D4", midi: 62, vexKey: "d/4", label: "D", spokenName: "D", hint: "just below the staff" },
  { id: "E4", midi: 64, vexKey: "e/4", label: "E", spokenName: "E", hint: "on the bottom line" },
  { id: "F4", midi: 65, vexKey: "f/4", label: "F", spokenName: "F", hint: "in the first space" },
  { id: "G4", midi: 67, vexKey: "g/4", label: "G", spokenName: "G", hint: "on the second line" },
  { id: "A4", midi: 69, vexKey: "a/4", label: "A", spokenName: "A", hint: "in the second space" },
  { id: "B4", midi: 71, vexKey: "b/4", label: "B", spokenName: "B", hint: "on the middle line" },
  { id: "C5", midi: 72, vexKey: "c/5", label: "C", spokenName: "high C", hint: "in the third space" },
];

export const BASS_NOTES: LessonNote[] = [
  { id: "C3", midi: 48, vexKey: "c/3", label: "C", spokenName: "low C", hint: "on the second space of the bass staff" },
  { id: "D3", midi: 50, vexKey: "d/3", label: "D", spokenName: "low D", hint: "on the middle line of the bass staff" },
  { id: "E3", midi: 52, vexKey: "e/3", label: "E", spokenName: "low E", hint: "in the third space of the bass staff" },
  { id: "F3", midi: 53, vexKey: "f/3", label: "F", spokenName: "low F", hint: "on the fourth line of the bass staff" },
  { id: "G3", midi: 55, vexKey: "g/3", label: "G", spokenName: "low G", hint: "in the fourth space of the bass staff" },
  { id: "A3", midi: 57, vexKey: "a/3", label: "A", spokenName: "low A", hint: "on the top line of the bass staff" },
  { id: "B3", midi: 59, vexKey: "b/3", label: "B", spokenName: "low B", hint: "just above the bass staff" },
  TREBLE_NOTES[0],
];

// LESSON_NOTES remains the one-octave Level 1 keyboard range for compatibility.
export const LESSON_NOTES = TREBLE_NOTES;
export const ALL_LESSON_NOTES = [...BASS_NOTES.slice(0, -1), ...TREBLE_NOTES];

export const NOTE_BY_ID = new Map(ALL_LESSON_NOTES.map((note) => [note.id, note]));

const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function midiToLabel(midi: number) {
  const octave = Math.floor(midi / 12) - 1;
  return `${PITCH_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}
