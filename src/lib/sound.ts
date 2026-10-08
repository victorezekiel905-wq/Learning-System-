"use client";
/*
 * Game music and sound effects for the projector, made in the browser with the
 * Web Audio API (no audio files, nothing to license). Browsers only allow sound
 * after a click, so the projector asks once.
 *
 *   sound.enable()            after a click
 *   sound.music("lobby" | "question" | null)
 *   sound.urgent(true)        the last seconds of a countdown
 *   sound.effect("correct" | "wrong" | "timeup" | "reveal" | "fanfare" | "join" | "tick")
 */

type Track = "lobby" | "question" | null;
type Effect = "correct" | "wrong" | "timeup" | "reveal" | "fanfare" | "join" | "tick";

const KEY = "sc-sound";
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Four bars each: chord roots and tones (MIDI note numbers).
const LOBBY = [[48, 60, 64, 67], [45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62]];        // C  Am F  G
const QUESTION = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];     // Am F  C  G

class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private track: Track = null;
  private timer: number | null = null;
  private next = 0;
  private step = 0;
  private isUrgent = false;
  enabled = false;
  volume = 0.6;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { on?: boolean; volume?: number } | null;
      if (saved?.volume !== undefined) this.volume = saved.volume;
      this.wanted = !!saved?.on;
    } catch { /* storage blocked: defaults */ }
  }
  /** The person turned sound on last time: turn it on again at their first click. */
  wanted = false;

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.enabled, volume: this.volume })); } catch { /* ignore */ }
  }

  enable() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume * 0.5;
      this.out.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    this.enabled = true;
    this.save();
    const t = this.track; this.track = null; this.music(t);
  }

  disable() {
    this.enabled = false;
    this.stopLoop();
    void this.ctx?.suspend();
    this.save();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.out) this.out.gain.value = this.volume * 0.5;
    this.save();
  }

  music(track: Track) {
    if (track === this.track && this.timer !== null) return;
    this.track = track;
    this.stopLoop();
    if (!track || !this.enabled || !this.ctx) return;
    this.next = this.ctx.currentTime + 0.06;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  urgent(on: boolean) { this.isUrgent = on; }

  private stopLoop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const ctx = this.ctx!;
    const bpm = this.track === "question" ? (this.isUrgent ? 150 : 132) : 108;
    const sixteenth = 60 / bpm / 4;
    while (this.next < ctx.currentTime + 0.12) {
      if (this.track === "lobby") this.lobbyStep(this.step, this.next);
      else if (this.track === "question") this.questionStep(this.step, this.next);
      this.next += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private lobbyStep(s: number, t: number) {
    const chord = LOBBY[Math.floor(s / 16)]!;
    const i = s % 16;
    if (i === 0 || i === 10) this.tone(midi(chord[0]!), t, 0.32, "triangle", 0.32);
    if (i % 2 === 0) this.tone(midi(chord[1 + ((i / 2) % 3)]! + 12), t, 0.12, "sine", 0.11);
    if (i === 4 || i === 12) this.hit(t, 0.05, 0.06, 7000);
    if (i % 4 === 2) this.hit(t, 0.02, 0.025, 9000);
    if (i === 0) this.kick(t, 0.35);
  }

  private questionStep(s: number, t: number) {
    const chord = QUESTION[Math.floor(s / 16)]!;
    const i = s % 16;
    if (i % 2 === 0) this.tone(midi(chord[0]! - (i % 4 === 2 ? 0 : 12) + 12), t, 0.1, "square", 0.07);
    if (i % 4 === 0) this.kick(t, 0.4);
    if (i % 4 === 2) this.hit(t, 0.025, 0.035, 8000);
    if ([0, 3, 6, 10, 12].includes(i)) this.tone(midi(chord[(i % 3) + 1]! + 12), t, 0.09, "triangle", 0.08);
    if (i % 4 === 0) this.tone(this.isUrgent ? 1760 : 1320, t, 0.03, "sine", this.isUrgent ? 0.12 : 0.05);
  }

  effect(e: Effect) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    switch (e) {
      case "correct": [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.25, "triangle", 0.22)); break;
      case "wrong": this.tone(midi(55), t, 0.18, "square", 0.12); this.tone(midi(51), t + 0.18, 0.35, "square", 0.12); break;
      case "tick": this.tone(1500, t, 0.04, "sine", 0.18); break;
      case "join": this.tone(midi(84), t, 0.08, "sine", 0.12); this.tone(midi(91), t + 0.06, 0.1, "sine", 0.1); break;
      case "timeup":
        this.stopLoop(); this.track = null;
        [45, 52, 57].forEach((n) => this.tone(midi(n), t, 2.2, "sine", 0.22));
        this.hit(t, 0.6, 0.12, 2500);
        break;
      case "reveal": [60, 64, 67, 72].forEach((n) => this.tone(midi(n), t, 0.9, "triangle", 0.16)); this.kick(t, 0.5); break;
      case "fanfare":
        for (let k = 0; k < 14; k++) this.hit(t + k * 0.07, 0.06, 0.03 + k * 0.006, 3000);
        [[60, 64, 67], [62, 65, 69], [64, 67, 72]].forEach((ch, j) =>
          ch.forEach((n) => this.tone(midi(n + 12), t + 1.05 + j * 0.22, j === 2 ? 1.2 : 0.2, "sawtooth", 0.06)));
        this.kick(t + 1.05, 0.6); this.kick(t + 1.49, 0.6);
        break;
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private hit(t: number, dur: number, vol: number, cutoff: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; f.type = "highpass"; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out!);
    src.start(t); src.stop(t + dur + 0.02);
  }

  private kick(t: number, vol: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.out!);
    o.start(t); o.stop(t + 0.25);
  }
}

let instance: Sound | null = null;
/** One sound engine per tab. */
export function getSound(): Sound {
  instance ??= new Sound();
  return instance;
}

/** A short buzz on phones that support it (correct: one, wrong: two). */
export function buzz(kind: "correct" | "wrong") {
  try { navigator.vibrate?.(kind === "correct" ? 60 : [40, 60, 40]); } catch { /* not supported */ }
}
