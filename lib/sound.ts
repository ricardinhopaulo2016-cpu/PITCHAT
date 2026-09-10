"use client";

/**
 * Identidade sonora mínima do PITCHAT — Web Audio API pura, sem lib.
 * Default OFF, opt-in do usuário, preferência em localStorage (não precisa
 * de schema/tabela). Nunca toca em hover/nav/digitação/dropdown/autosave —
 * só eventos reais (publish, erro, evento ao vivo). Rate-limit contra rajada.
 * Ver docs/PITCHAT_DESIGN_SYSTEM.md §9.
 */

const STORAGE_KEY = "pitchat:sound-enabled";
const MIN_INTERVAL_MS = 800; // rate-limit — nunca uma rajada de cues sobrepostos
let lastPlayedAt = 0;

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // privacidade do browser pode bloquear localStorage — nunca quebrar por isso
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Se não der pra persistir, a sessão atual ainda funciona via estado do componente.
  }
}

type Cue = "success" | "error" | "live-event";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, gainPeak = 0.08) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Toca um cue se o som estiver habilitado — nunca lança, nunca é o único feedback. */
export function playSound(cue: Cue): void {
  if (!isSoundEnabled()) return;

  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return; // rate-limit
  lastPlayedAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t0 = ctx.currentTime;
  try {
    if (cue === "success") {
      // Duas notas curtas ascendentes, suave — sem cara de videogame.
      tone(ctx, 523.25, t0, 0.11);
      tone(ctx, 659.25, t0 + 0.09, 0.14);
    } else if (cue === "error") {
      // Uma nota curta, seca e grave.
      tone(ctx, 196, t0, 0.16, 0.07);
    } else {
      // live-event: tick extremamente discreto.
      tone(ctx, 880, t0, 0.045, 0.035);
    }
  } catch {
    // Ambiente sem suporte real de áudio (ex: autoplay bloqueado) — silencioso, nunca quebra a UI.
  }
}
