import rifleShotUrl from '../assets/audio/sfx/rifleshot.wav?url';
import rifleReloadUrl from '../assets/audio/sfx/riflereload.mp3?url';

// Mostly procedural sound effects via WebAudio, with real recorded clips
// layered in from src/assets/audio/sfx/ where available (currently the
// rifle shot and reload). Clips are decoded once (kicked off in resume(),
// same moment the AudioContext itself is created) and played back through
// AudioBufferSourceNodes on the same master gain as everything else, so
// volume/mixing stays consistent whether a sound is synthesized or a file.

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {}; // name -> decoded AudioBuffer, once loaded
  }

  /** Must be called from a user gesture before any sound plays. */
  resume() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this._loadBuffer('shot', rifleShotUrl);
      this._loadBuffer('reload', rifleReloadUrl);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async _loadBuffer(name, url) {
    try {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      this.buffers[name] = await this.ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.error(`Failed to load sound "${name}" (${url}):`, err);
    }
  }

  /** @returns true if a decoded clip played, false if it isn't loaded (yet) — callers fall back to a synthesized sound in that case. */
  _playBuffer(name, { volume = 1, rate = 1 } = {}) {
    const buffer = this.buffers[name];
    if (!buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  _noise(duration) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * duration, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _env(gainNode, t0, peak, decay) {
    gainNode.gain.setValueAtTime(peak, t0);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
  }

  shot() {
    if (!this.ctx) return;
    if (this._playBuffer('shot', { volume: 0.8 })) return;
    // Fallback if rifleshot.wav hasn't finished decoding yet (fires almost
    // instantly after resume(), so this only matters for a shot taken in
    // the very first instant of play) or failed to load at all.
    const t = this.ctx.currentTime;
    const noise = this._noise(0.3);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3500, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = this.ctx.createGain();
    this._env(g, t, 0.9, 0.28);
    noise.connect(lp).connect(g).connect(this.master);
    noise.start(t);
    // low thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g2 = this.ctx.createGain();
    this._env(g2, t, 0.7, 0.15);
    osc.connect(g2).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  dry() { this._blip(1100, 0.04, 0.15, 'square'); }
  pickup() { this._blip(660, 0.09, 0.2); this._blip(880, 0.09, 0.15, 'sine', 0.08); }
  eat() { this._blip(330, 0.1, 0.2); this._blip(280, 0.1, 0.2, 'sine', 0.14); }
  build() { this._blip(180, 0.15, 0.3, 'triangle'); this._blip(220, 0.12, 0.2, 'triangle', 0.15); }

  _blip(freq, dur, vol = 0.2, type = 'sine', delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    this._env(g, t, vol, dur * 2.5);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur * 3);
  }

  reload() {
    if (!this.ctx) return;
    if (this._playBuffer('reload', { volume: 0.8 })) return;
    // Fallback if riflereload.mp3 hasn't finished decoding yet or failed to load.
    this._blip(500, 0.05, 0.15, 'square');
    this._blip(400, 0.05, 0.15, 'square', 0.5);
    this._blip(750, 0.05, 0.2, 'square', 1.6);
  }

  drink() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const noise = this._noise(0.5);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const g = this.ctx.createGain();
    this._env(g, t, 0.25, 0.5);
    noise.connect(bp).connect(g).connect(this.master);
    noise.start(t);
  }

  bite() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);
    const g = this.ctx.createGain();
    this._env(g, t, 0.5, 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
    const noise = this._noise(0.12);
    const g2 = this.ctx.createGain();
    this._env(g2, t, 0.3, 0.12);
    noise.connect(g2).connect(this.master);
    noise.start(t);
  }

  growl() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75, t);
    osc.frequency.linearRampToValueAtTime(52, t + 0.7);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 250;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.9);
  }
}
