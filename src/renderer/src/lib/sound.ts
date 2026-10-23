import type { SoundId } from '../../../shared/settings';
import { call } from './api';

export const SOUND_LABELS: Record<SoundId, string> = {
  chime: 'Chime',
  pop: 'Pop',
  ding: 'Ding',
  bubble: 'Bubble',
  custom: 'Custom file',
  none: 'None'
};

type Note = { freq: number; start: number; dur: number; type?: OscillatorType; slideTo?: number };

/** The built-in sounds, synthesized so the app ships no audio files. Times in seconds. */
const PRESETS: Record<'chime' | 'pop' | 'ding' | 'bubble', Note[]> = {
  chime: [
    { freq: 880, start: 0, dur: 0.35 },
    { freq: 1318.5, start: 0.09, dur: 0.45 }
  ],
  pop: [{ freq: 520, start: 0, dur: 0.09, slideTo: 980 }],
  ding: [
    { freq: 1568, start: 0, dur: 0.7 },
    { freq: 3136, start: 0, dur: 0.35 }
  ],
  bubble: [
    { freq: 400, start: 0, dur: 0.08, slideTo: 900 },
    { freq: 600, start: 0.1, dur: 0.08, slideTo: 1200 }
  ]
};

let ctx: AudioContext | null = null;
let custom: { bytes: Uint8Array | null; buffer: AudioBuffer | null } | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function playNotes(ac: AudioContext, notes: Note[], volume: number): void {
  const t0 = ac.currentTime + 0.01;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.freq, t0 + n.start);
    if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(n.slideTo, t0 + n.start + n.dur);
    // Quick attack, exponential decay: a soft bell rather than a beep.
    gain.gain.setValueAtTime(0.0001, t0 + n.start);
    gain.gain.exponentialRampToValueAtTime(0.35 * volume + 0.0001, t0 + n.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + n.start);
    osc.stop(t0 + n.start + n.dur + 0.05);
  }
}

async function customBuffer(ac: AudioContext): Promise<AudioBuffer | null> {
  if (!custom) custom = { bytes: await call('sound:getCustom').catch(() => null), buffer: null };
  if (!custom.buffer && custom.bytes) {
    // decodeAudioData detaches the buffer it is given, so hand it a copy.
    custom.buffer = await ac.decodeAudioData(custom.bytes.slice().buffer).catch(() => null);
    if (!custom.buffer) custom.bytes = null;
  }
  return custom.buffer;
}

/** Forget the cached custom sound (after the user picks or removes one). */
export function resetCustomSound(): void {
  custom = null;
}

/** Can these bytes be played? Used to reject a bad file before saving it. */
export async function canDecode(bytes: Uint8Array): Promise<boolean> {
  const ac = context();
  if (!ac) return false;
  return ac
    .decodeAudioData(bytes.slice().buffer)
    .then(() => true)
    .catch(() => false);
}

export async function playSound(id: SoundId, volume: number): Promise<void> {
  if (id === 'none' || volume <= 0) return;
  const ac = context();
  if (!ac) return;
  if (id === 'custom') {
    const buffer = await customBuffer(ac);
    if (!buffer) return playNotes(ac, PRESETS.chime, volume);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain).connect(ac.destination);
    src.start();
    return;
  }
  playNotes(ac, PRESETS[id], volume);
}
