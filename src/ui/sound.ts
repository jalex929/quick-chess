/**
 * Synthesized sound effects: built from oscillators and noise with the Web Audio API, so there
 * are no audio files to license or download. Off until the player turns it on; the audio
 * context is only created after that tap (browsers require a user gesture).
 */

export type Sfx =
  "move" | "capture" | "check" | "end-win" | "end-lose" | "end-draw" | "tick" | "select";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from the tap that turns sound on, so the browser lets it play. */
export function unlockAudio() {
  const a = audio();
  if (a?.state === "suspended") void a.resume();
}

function tone(
  a: AudioContext,
  {
    type = "square",
    from,
    to = from,
    at = 0,
    length,
    volume = 0.5,
    cutoff = 3200,
  }: {
    type?: OscillatorType;
    from: number;
    to?: number;
    at?: number;
    length: number;
    volume?: number;
    cutoff?: number;
  },
) {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const filter = a.createBiquadFilter();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(filter).connect(gain).connect(master!);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

function noise(
  a: AudioContext,
  {
    at = 0,
    length,
    volume = 0.4,
    band = 1800,
  }: { at?: number; length: number; volume?: number; band?: number },
) {
  const t = a.currentTime + at;
  const frames = Math.ceil(a.sampleRate * length);
  const buffer = a.createBuffer(1, frames, a.sampleRate);
  const data = buffer.getChannelData(0);
  // Crushed noise: hold each random value for a few samples for a digital crunch.
  let held = 0;
  for (let i = 0; i < frames; i++) {
    if (i % 6 === 0) held = Math.random() * 2 - 1;
    data[i] = held;
  }
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = band;
  filter.Q.value = 0.8;
  const gain = a.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t);
}

export function play(sfx: Sfx) {
  const a = audio();
  if (!a || !master) return;
  if (a.state === "suspended") void a.resume();
  switch (sfx) {
    case "select":
      tone(a, { type: "sine", from: 1400, length: 0.04, volume: 0.15 });
      break;
    case "move":
      // A short synth "thunk" with a bright click on top.
      tone(a, { type: "triangle", from: 420, to: 160, length: 0.09, volume: 0.6 });
      tone(a, { type: "square", from: 2400, length: 0.02, volume: 0.12 });
      break;
    case "capture":
      noise(a, { length: 0.16, volume: 0.5, band: 2400 });
      tone(a, { type: "sawtooth", from: 880, to: 90, length: 0.18, volume: 0.35, cutoff: 2200 });
      tone(a, { type: "square", from: 1760, to: 220, at: 0.03, length: 0.08, volume: 0.15 });
      break;
    case "check":
      tone(a, { type: "square", from: 988, length: 0.09, volume: 0.3, cutoff: 2600 });
      tone(a, { type: "square", from: 740, at: 0.11, length: 0.12, volume: 0.3, cutoff: 2600 });
      break;
    case "tick":
      tone(a, { type: "square", from: 1900, length: 0.03, volume: 0.12 });
      break;
    case "end-win":
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(a, {
          type: "square",
          from: f,
          at: i * 0.09,
          length: 0.22,
          volume: 0.25,
          cutoff: 3000,
        }),
      );
      break;
    case "end-lose":
      [392, 330, 262, 196].forEach((f, i) =>
        tone(a, {
          type: "sawtooth",
          from: f,
          at: i * 0.12,
          length: 0.26,
          volume: 0.22,
          cutoff: 1400,
        }),
      );
      noise(a, { at: 0.48, length: 0.3, volume: 0.25, band: 800 });
      break;
    case "end-draw":
      tone(a, { type: "triangle", from: 523, length: 0.25, volume: 0.35 });
      tone(a, { type: "triangle", from: 523, at: 0.18, length: 0.3, volume: 0.3 });
      break;
  }
}
