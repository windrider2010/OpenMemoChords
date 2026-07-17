export interface LessonNote {
  id: string;
  midi: number;
  vexKey: string;
  label: string;
  spokenName: string;
  hint: string;
}

export const LESSON_NOTES: LessonNote[] = [
  { id: "C4", midi: 60, vexKey: "c/4", label: "C", spokenName: "middle C", hint: "one tiny step below the staff" },
  { id: "D4", midi: 62, vexKey: "d/4", label: "D", spokenName: "D", hint: "just below the staff" },
  { id: "E4", midi: 64, vexKey: "e/4", label: "E", spokenName: "E", hint: "on the bottom line" },
  { id: "F4", midi: 65, vexKey: "f/4", label: "F", spokenName: "F", hint: "in the first space" },
  { id: "G4", midi: 67, vexKey: "g/4", label: "G", spokenName: "G", hint: "on the second line" },
  { id: "A4", midi: 69, vexKey: "a/4", label: "A", spokenName: "A", hint: "in the second space" },
  { id: "B4", midi: 71, vexKey: "b/4", label: "B", spokenName: "B", hint: "on the middle line" },
  { id: "C5", midi: 72, vexKey: "c/5", label: "C", spokenName: "high C", hint: "in the third space" },
];

export const NOTE_BY_ID = new Map(LESSON_NOTES.map((note) => [note.id, note]));

const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function midiToLabel(midi: number) {
  const octave = Math.floor(midi / 12) - 1;
  return `${PITCH_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}
