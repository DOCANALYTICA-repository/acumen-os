"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Volume2 } from "lucide-react";
import { cls } from "@/components/ui";

/**
 * Notification chimes made with the Web Audio API (no sound files to load).
 * Browsers keep audio muted until the person clicks or presses a key on the page, so every screen that plays
 * sounds calls useSoundUnlock(), and waiting screens offer a "Turn on sound" button.
 */
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    ctx.onstatechange = () => listeners.forEach((l) => l());
  }
  return ctx;
}

function unlock() {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

const TUNES = {
  message: [880, 1318.5], // two quick high notes
  question: [523.25, 659.25, 783.99], // rising three-note chime
} as const;

export type SoundKind = keyof typeof TUNES;

export function playSound(kind: SoundKind) {
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t0 = c.currentTime + 0.02;
  TUNES[kind].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = t0 + i * 0.13;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

/** Lets sounds play after the person's first click or key press on the page. */
export function useSoundUnlock() {
  useEffect(() => {
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}

/** "Turn on sound" button, shown until the browser allows audio. Plays a test chime when pressed. */
export function SoundCheck({ kind = "message" }: { kind?: SoundKind }) {
  const [on, setOn] = useState(true); // true on the server and first render, so markup matches
  useEffect(() => {
    const update = () => setOn(audio()?.state === "running");
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  if (on) return null;
  return (
    <button type="button" onClick={() => playSound(kind)} className={`${cls.btn} ${cls.secondary}`}>
      <Volume2 className="h-4 w-4" /> Turn on sound
    </button>
  );
}

/** Re-renders the server page every `ms` so a waiting screen moves on by itself. */
export function AutoRefresh({ ms = 3000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => !document.hidden && router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
