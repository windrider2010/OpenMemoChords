"use client";

import { PitchDetector } from "pitchy";
import { useCallback, useEffect, useRef, useState } from "react";

const FRAME_SIZE = 2048;
const MIN_VOLUME = 0.0065;
const MIN_CLARITY = 0.91;
const MIN_MIDI = 47;
const MAX_MIDI = 73;
const RELEASE_FRAMES = 3;

export type MicStatus = "idle" | "requesting" | "listening" | "error";

export interface DetectedNoteEvent {
  midi: number;
  frequency: number;
  clarity: number;
  cents: number;
  onsetTimeMs: number;
}

export interface LivePitchReading extends DetectedNoteEvent {
  volume: number;
}

interface StableCandidate {
  midi: number;
  frames: number;
  releasedFrames: number;
  emitted: boolean;
  cents: number[];
  clarityTotal: number;
  peakVolume: number;
  onsetTimeMs: number;
}

function emptyCandidate(): StableCandidate {
  return {
    midi: -1,
    frames: 0,
    releasedFrames: 0,
    emitted: false,
    cents: [],
    clarityTotal: 0,
    peakVolume: 0,
    onsetTimeMs: 0,
  };
}

export function usePitchDetector(onNote: (event: DetectedNoteEvent) => void, expectedMidi: number | null = null) {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState("");
  const [reading, setReading] = useState<LivePitchReading | null>(null);
  const callbackRef = useRef(onNote);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const detectorRef = useRef(PitchDetector.forFloat32Array(FRAME_SIZE));
  const stableRef = useRef<StableCandidate>(emptyCandidate());
  const expectedMidiRef = useRef(expectedMidi);
  const noiseFloorRef = useRef(0.0025);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    callbackRef.current = onNote;
  }, [onNote]);

  useEffect(() => {
    expectedMidiRef.current = expectedMidi;
  }, [expectedMidi]);

  const resetGate = useCallback(() => {
    stableRef.current = emptyCandidate();
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
      await context.resume();
      await context.audioWorklet.addModule("/audio/pitch-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const highPass = context.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 85;
      highPass.Q.value = 0.7;
      const lowPass = context.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 1800;
      lowPass.Q.value = 0.7;
      const worklet = new AudioWorkletNode(context, "pitch-frame-processor");
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      source.connect(highPass).connect(lowPass).connect(worklet);
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

        if (clarity < 0.72 || !Number.isFinite(frequency)) {
          const boundedVolume = Math.min(volume, 0.03);
          noiseFloorRef.current = noiseFloorRef.current * 0.985 + boundedVolume * 0.015;
        }

        const candidate = stableRef.current;
        const signalFloor = Math.max(MIN_VOLUME, noiseFloorRef.current * 2.25);

        if (!Number.isFinite(frequency) || volume < signalFloor || clarity < MIN_CLARITY) {
          candidate.releasedFrames += 1;
          if (candidate.releasedFrames >= RELEASE_FRAMES) stableRef.current = emptyCandidate();
          return;
        }

        const exactMidi = 69 + 12 * Math.log2(frequency / 440);
        const midi = Math.round(exactMidi);
        const cents = Math.round((exactMidi - midi) * 100);
        if (midi < MIN_MIDI || midi > MAX_MIDI || Math.abs(cents) > 43) {
          candidate.releasedFrames += 1;
          if (candidate.releasedFrames >= RELEASE_FRAMES) stableRef.current = emptyCandidate();
          return;
        }

        const now = performance.now();
        if (now - lastUiUpdateRef.current > 90) {
          setReading({
            midi,
            frequency,
            clarity,
            cents,
            volume,
            onsetTimeMs: now - (FRAME_SIZE / context.sampleRate) * 1000,
          });
          lastUiUpdateRef.current = now;
        }

        if (candidate.midi !== midi) {
          stableRef.current = {
            midi,
            frames: 1,
            releasedFrames: 0,
            emitted: false,
            cents: [cents],
            clarityTotal: clarity,
            peakVolume: volume,
            onsetTimeMs: now - (FRAME_SIZE / context.sampleRate) * 1000,
          };
          return;
        }

        if (!candidate.emitted) {
          candidate.frames += 1;
          candidate.releasedFrames = 0;
          candidate.cents.push(cents);
          candidate.clarityTotal += clarity;
          candidate.peakVolume = Math.max(candidate.peakVolume, volume);

          const isExpected = expectedMidiRef.current === null || midi === expectedMidiRef.current;
          const requiredFrames = isExpected ? 7 : 10;
          if (candidate.frames < requiredFrames) return;

          const recentCents = candidate.cents.slice(-requiredFrames);
          const centsSpread = Math.max(...recentCents) - Math.min(...recentCents);
          const averageClarity = candidate.clarityTotal / candidate.frames;
          const hasPianoLikeDecay = candidate.peakVolume / Math.max(volume, MIN_VOLUME) >= 1.05;
          const isExceptionallySteady = candidate.frames >= 12 && centsSpread <= 8;
          const stableEnough = centsSpread <= (isExpected ? 17 : 12) && averageClarity >= (isExpected ? 0.92 : 0.94);

          if (stableEnough && (hasPianoLikeDecay || isExceptionallySteady)) {
            candidate.emitted = true;
            callbackRef.current({
              midi,
              frequency,
              clarity: averageClarity,
              cents,
              onsetTimeMs: candidate.onsetTimeMs,
            });
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
