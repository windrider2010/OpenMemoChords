"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonNote } from "../lib/notes";

export function StaffNote({ note }: { note: LessonNote }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let active = true;
    async function draw() {
      try {
        const { Formatter, Renderer, Stave, StaveNote, Voice } = await import("vexflow");
        if (!active || !hostRef.current) return;
        hostRef.current.replaceChildren();
        const renderer = new Renderer(hostRef.current, Renderer.Backends.SVG);
        renderer.resize(620, 210);
        const context = renderer.getContext();
        const stave = new Stave(28, 42, 560);
        stave.addClef("treble").setContext(context).draw();
        const staveNote = new StaveNote({ keys: [note.vexKey], duration: "q", clef: "treble" });
        const voice = new Voice({ numBeats: 1, beatValue: 4 }).addTickables([staveNote]);
        new Formatter().joinVoices([voice]).format([voice], 360);
        voice.draw(context, stave);
        setRenderError(false);
      } catch {
        if (active) setRenderError(true);
      }
    }
    void draw();
    return () => {
      active = false;
    };
  }, [note]);

  return (
    <div
      className="staff-canvas"
      ref={hostRef}
      role="img"
      aria-label={`A ${note.spokenName} quarter note on the treble clef`}
    >
      {renderError ? <span className="error-copy">The music staff could not be drawn.</span> : null}
    </div>
  );
}
