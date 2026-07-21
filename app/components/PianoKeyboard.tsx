"use client";

import { LESSON_NOTES, type LessonNote } from "../lib/notes";

const BLACK_KEY_POSITIONS = [12.5, 25, 50, 62.5, 75];

function playTone(midi: number) {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.58);
  oscillator.addEventListener("ended", () => void context.close());
}

export function PianoKeyboard({ onPlay, showLabels, targetId, notes = LESSON_NOTES }: {
  onPlay: (midi: number, onsetTimeMs: number) => void;
  showLabels: boolean;
  targetId: string;
  notes?: LessonNote[];
}) {
  return (
    <div className="piano-keys" aria-label="One-octave on-screen piano">
      {notes.map((note) => (
        <button
          className="piano-key"
          key={note.id}
          type="button"
          aria-label={`Play ${note.spokenName}`}
          onClick={() => {
            playTone(note.midi);
            onPlay(note.midi, performance.now());
          }}
        >
          <span className={showLabels && note.id === targetId ? "key-label target" : "key-label"}>
            {showLabels ? note.label : ""}
          </span>
        </button>
      ))}
      {BLACK_KEY_POSITIONS.map((position) => (
        <span className="black-key" style={{ left: `${position}%` }} key={position} aria-hidden="true" />
      ))}
    </div>
  );
}
