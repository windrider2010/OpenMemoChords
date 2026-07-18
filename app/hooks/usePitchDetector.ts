"use client";

import { PitchDetector } from "pitchy";
import { useCallback, useEffect, useRef, useState } from "react";

const FRAME_SIZE = 2048;
const MIN_VOLUME = 0.006;
const MIN_CLARITY = 0.88;
const STABLE_FRAMES = 3;

export type MicStatus = "idle" | "requesting" | "listening" | "error";

export interface DetectedNoteEvent {
  midi: number;
  frequency: number;
  clarity: number;
  cents: number;
}

export interface LivePitchReading extends DetectedNoteEvent {
  volume: number;
}

export function usePitchDetector(onNote: (event: DetectedNoteEvent) => void) {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState("");
  const [reading, setReading] = useState<LivePitchReading | null>(null);
  const callbackRef = useRef(onNote);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const detectorRef = useRef(PitchDetector.forFloat32Array(FRAME_SIZE));
  const stableRef = useRef({ midi: -1, frames: 0, emitted: false });
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    callbackRef.current = onNote;
  }, [onNote]);

  const resetGate = useCallback(() => {
    stableRef.current = { midi: -1, frames: 0, emitted: false };
  }, []);

  const stop = useCallback(async () => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      await audioContextRef.current.close();
    }
    audioContextRef.current = null;
    setStatus("idle");
    setReading(null);
    resetGate();
  }, [resetGate]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not offer microphone access. You can still use the on-screen piano.");
      setStatus("error");
      return;
    }

    setStatus("requesting");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 1,
        },
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule("/audio/pitch-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "pitch-frame-processor");
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      source.connect(worklet);
      worklet.connect(silentOutput).connect(context.destination);

      streamRef.current = stream;
      audioContextRef.current = context;
      workletRef.current = worklet;
      resetGate();

      worklet.port.onmessage = (message: MessageEvent<Float32Array>) => {
        const frame = message.data;
        let sum = 0;
        for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index];
        const volume = Math.sqrt(sum / frame.length);
        const [frequency, clarity] = detectorRef.current.findPitch(frame, context.sampleRate);

        if (!Number.isFinite(frequency) || volume < MIN_VOLUME || clarity < MIN_CLARITY) {
          stableRef.current = { midi: -1, frames: 0, emitted: false };
          return;
        }

        const exactMidi = 69 + 12 * Math.log2(frequency / 440);
        const midi = Math.round(exactMidi);
        const cents = Math.round((exactMidi - midi) * 100);
        const now = performance.now();
        if (now - lastUiUpdateRef.current > 90) {
          setReading({ midi, frequency, clarity, cents, volume });
          lastUiUpdateRef.current = now;
        }

        const stable = stableRef.current;
        if (stable.midi !== midi) {
          stableRef.current = { midi, frames: 1, emitted: false };
        } else if (!stable.emitted) {
          stable.frames += 1;
          if (stable.frames >= STABLE_FRAMES) {
            stable.emitted = true;
            callbackRef.current({ midi, frequency, clarity, cents });
          }
        }
      };

      setStatus("listening");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Microphone access was not available.";
      setError(`${message} You can still tap the on-screen piano.`);
      setStatus("error");
    }
  }, [resetGate]);

  useEffect(() => () => {
    workletRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
  }, []);

  return { status, error, reading, start, stop, resetGate };
}
