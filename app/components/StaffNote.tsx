"use client";

import { useEffect, useRef, useState } from "react";
import type { PracticeExercise } from "../lib/curriculum";
import type { LessonNote } from "../lib/notes";

function durationFor(beats: number) {
  if (beats === 4) return "w";
  if (beats === 2) return "h";
  return "q";
}

export function StaffExercise({ exercise, activeIndex }: { exercise: PracticeExercise; activeIndex: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let active = true;

    async function draw() {
      try {
        const { Formatter, Renderer, Stave, StaveNote, Voice } = await import("vexflow");
        if (!active || !hostRef.current) return;

        hostRef.current.replaceChildren();
        const grandStaff = exercise.level === 4;
        const renderer = new Renderer(hostRef.current, Renderer.Backends.SVG);
        renderer.resize(1100, grandStaff ? 500 : 410);
        const context = renderer.getContext();
        context.scale(1.42, 1.42);

        const staveWidth = 720;
        const rhythmic = exercise.level > 1;
        const treble = new Stave(28, grandStaff ? 25 : 58, staveWidth).addClef("treble");
        const bass = grandStaff ? new Stave(28, 185, staveWidth).addClef("bass") : null;
        if (rhythmic) {
          treble.addTimeSignature("4/4");
          bass?.addTimeSignature("4/4");
        }
        treble.setContext(context).draw();
        bass?.setContext(context).draw();

        const notes = exercise.items.map((item, index) => {
          const staveNote = new StaveNote({
            keys: [item.note.vexKey],
            duration: durationFor(item.beats),
            clef: exercise.clef,
            autoStem: true,
          });
          if (exercise.clef === "treble" && item.note.id === "C4") staveNote.setKeyLine(0, 0);
          if (index === activeIndex) {
            staveNote.setStyle({ fillStyle: "#dd5d88", strokeStyle: "#dd5d88" });
          }
          return staveNote;
        });

        const voice = new Voice({ numBeats: exercise.totalBeats, beatValue: 4 }).setStrict(false).addTickables(notes);
        new Formatter().joinVoices([voice]).format([voice], exercise.items.length === 1 ? 350 : 540);
        if (exercise.items.length === 1) notes[0]?.setXShift(142);
        voice.draw(context, exercise.clef === "bass" && bass ? bass : treble);
        setRenderError(false);
      } catch {
        if (active) setRenderError(true);
      }
    }

    void draw();
    return () => {
      active = false;
    };
  }, [activeIndex, exercise]);

  const description = exercise.items
    .map((item) => `${item.note.spokenName} ${item.beats === 2 ? "half note" : item.beats === 4 ? "whole note" : "quarter note"}`)
    .join(", ");

  return (
    <div
      className={`staff-canvas ${exercise.level === 4 ? "grand-staff" : ""}`}
      ref={hostRef}
      role="img"
      aria-label={`${description} on the ${exercise.clef} clef`}
    >
      {renderError ? <span className="error-copy">The music staff could not be drawn.</span> : null}
    </div>
  );
}

export function StaffNote({ note }: { note: LessonNote }) {
  return (
    <StaffExercise
      activeIndex={0}
      exercise={{ id: `single-${note.id}`, level: 1, clef: "treble", items: [{ note, beats: 1 }], totalBeats: 1 }}
    />
  );
}
