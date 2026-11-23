/**
 * Synthesized sound effects: built from oscillators and noise with the Web Audio API, so there
 * are no audio files to license or download. Off until the player turns it on; the audio
 * context is only created after that tap (browsers require a user gesture).
 */

export type Sfx =
  | "move"
  | "capture"
  | "check"
  | "end-win"
  | "end-lose"
  | "end-draw"
  | "tick"
  | "select"
  | "option"
  | "start"
  | "crackle";

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
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Whether the player has sound turned on (set by the app; checked by playIfOn). */
let soundOn = false;
export function setSoundOn(on: boolean) {
  soundOn = on;
  if (on && bedWanted && !bed) startStaticBed();
  updateBed();
}

/** Plays only if sound is on and the page is visible (for effects that run on their own). */
export function playIfOn(sfx: Sfx, volume = 1) {
  if (soundOn && document.visibilityState === "visible") play(sfx, volume);
}

/** Call from the tap that turns sound on, so the browser lets it play. */
export function unlockAudio() {
  const a = audio();
  if (a?.state === "suspended") void a.resume();
}

// Browsers keep audio asleep until a tap. If sound was left on from an earlier visit, wake it
// on the first tap of this one.
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      if (soundOn) unlockAudio();
    },
    { capture: true },
  );
  document.addEventListener("visibilitychange", () => updateBed());
}

// ---- The static bed: a steady hiss under the checkmate crackle ----

/** How loud the bed is at full strength (the crackle bursts sit on top of it). */
const BED_VOLUME = 0.07;
let bed: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
/** 0..1, set by whoever is running the bed (it fades out with the crackle). */
let bedLevel = 1;
/** The bed was asked for while sound was off: start it if sound is turned on. */
let bedWanted = false;

function updateBed() {
  if (!bed || !ctx) return;
  const audible = soundOn && document.visibilityState === "visible";
  const target = audible ? BED_VOLUME * bedLevel : 0;
  bed.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
}

/**
 * Starts a steady, quiet crushed-static loop (the same grain as the crackle) that runs until
 * stopStaticBed. It follows the sound switch and goes quiet when the page is hidden.
 */
export function startStaticBed() {
  bedWanted = true;
  if (!soundOn) return;
  const a = audio();
  if (!a || !master || bed) return;
  const seconds = 2;
  const frames = a.sampleRate * seconds;
  const buffer = a.createBuffer(1, frames, a.sampleRate);
  const data = buffer.getChannelData(0);
  let held = 0;
  for (let i = 0; i < frames; i++) {
    // Mostly fine-grained hiss, with the hold length wandering so it doesn't sound like a tone.
    if (i % (4 + Math.floor(Math.random() * 6)) === 0) held = Math.random() * 2 - 1;
    data[i] = held;
  }
  const source = a.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2600;
  filter.Q.value = 0.5;
  // A slow wobble in loudness, like a bad signal drifting in and out.
  const wobble = a.createOscillator();
  wobble.frequency.value = 0.37;
  const wobbleDepth = a.createGain();
  wobbleDepth.gain.value = 0.35;
  const swell = a.createGain();
  swell.gain.value = 1;
  wobble.connect(wobbleDepth).connect(swell.gain);
  const gain = a.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(swell).connect(gain).connect(master);
  source.start();
  wobble.start();
  source.onended = () => wobble.stop();
  bed = { source, gain };
  updateBed();
}

/** 0..1: how strong the bed is now (the checkmate square fades it out over time). */
export function setStaticBedLevel(level: number) {
  bedLevel = Math.max(0, Math.min(1, level));
  updateBed();
}

export function stopStaticBed() {
  bedWanted = false;
  bedLevel = 1;
  if (!bed || !ctx) return;
  const { source, gain } = bed;
  bed = null;
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  source.stop(ctx.currentTime + 0.5);
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

export function play(sfx: Sfx, volume = 1) {
  const a = audio();
  if (!a || !master) return;
  if (a.state === "suspended") void a.resume();
  switch (sfx) {
    case "select":
      tone(a, { type: "sine", from: 1400, length: 0.04, volume: 0.15 });
      break;
    case "option":
      // Picking a setup choice: a soft two-step blip, just enough to say sound is on.
      tone(a, { type: "triangle", from: 880, length: 0.035, volume: 0.18 * volume });
      tone(a, { type: "triangle", from: 1320, at: 0.04, length: 0.045, volume: 0.14 * volume });
      break;
    case "start":
      // Start game: a short rising chirp, a little brighter than an option.
      tone(a, {
        type: "square",
        from: 520,
        to: 1560,
        length: 0.14,
        volume: 0.16 * volume,
        cutoff: 2600,
      });
      tone(a, { type: "sine", from: 2080, at: 0.12, length: 0.08, volume: 0.1 * volume });
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
    case "crackle": {
      // A short burst of crushed static at a random pitch band, sometimes with a falling blip.
      const length = 0.03 + Math.random() * 0.09;
      noise(a, {
        length,
        volume: (0.18 + Math.random() * 0.2) * volume,
        band: 1200 + Math.random() * 4200,
      });
      if (Math.random() < 0.5) {
        const f = 900 + Math.random() * 2200;
        tone(a, {
          type: "square",
          from: f,
          to: f * (0.25 + Math.random() * 0.3),
          length: length * 0.8,
          volume: 0.08 * volume,
          cutoff: 4000,
        });
      }
      break;
    }
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
