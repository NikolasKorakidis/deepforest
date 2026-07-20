// Tiny procedural sound effects via WebAudio — no audio assets needed.
// Everything is synthesized: noise bursts, oscillator sweeps.

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  /** Must be called from a user gesture before any sound plays. */
  resume() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
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

  /** Distant wolf howl for night ambience. */
  howl() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(620, t + 0.9);
    osc.frequency.linearRampToValueAtTime(380, t + 2.4);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = this.ctx.createGain();
    vibGain.gain.value = 8;
    vib.connect(vibGain).connect(osc.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 2.7);
    vib.start(t);
    vib.stop(t + 2.7);
  }
}
