// DOM-based HUD: stat bars, ammo, compass strip, prompts, toasts, overlays
// (damage flash, cold vignette, binocular mask, rifle scope) and full-screen
// menus (start / pause / death / end).

import scopeReticleUrl from '../assets/textures/scope-reticle.svg?url';
import binocMaskUrl from '../assets/textures/binoculars-mask.png?url';
import { CONFIG } from '../core/config.js';
import { MEDALS } from '../core/medals.js';

const STAT_DEFS = [
  ['health', 'Health', '#c94f42'],
  ['hunger', 'Hunger', '#c98f42'],
  ['thirst', 'Thirst', '#4f8fc9'],
  ['warmth', 'Warmth', '#c96a2e'],
  ['energy', 'Energy', '#7fa845'],
];

/** clip-path polygon for wedge `i` of `n` equal pie slices, 12-o'clock start. */
function wedgePolygon(i, n) {
  const start = (i / n) * 2 * Math.PI - Math.PI / 2;
  const end = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
  const steps = 16;
  const points = ['50% 50%'];
  for (let s = 0; s <= steps; s++) {
    const a = start + (end - start) * (s / steps);
    points.push(`${50 + 50 * Math.cos(a)}% ${50 + 50 * Math.sin(a)}%`);
  }
  return `polygon(${points.join(',')})`;
}

export class HUD {
  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div id="vignette"></div>
      <div id="cold-overlay"></div>
      <div id="damage-flash"></div>
      <div id="binoc-mask" style="background-image:url(${binocMaskUrl})"></div>
      <div id="scope-overlay">
        <div class="scope-vignette"></div>
        <div class="scope-glass"></div>
        <img id="scope-reticle" src="${scopeReticleUrl}" alt="" />
        <div id="scope-range"></div>
      </div>
      <div id="fade"></div>
      <div id="focus"><div id="focus-bar"><i></i></div><div id="focus-label"></div></div>
      <div id="killcam"><div class="bar top"></div><div class="bar bottom"></div><div id="killcam-label"></div></div>

      <div id="stats">
        ${STAT_DEFS.map(([key, label, color]) => `
          <div class="stat" data-stat="${key}">
            <span class="stat-label">${label}</span>
            <div class="bar"><div class="fill" style="background:${color}"></div></div>
          </div>`).join('')}
      </div>

      <div id="right-panel">
        <div id="ammo" class="hidden"></div>
        <div id="counts"></div>
      </div>

      <canvas id="compass" width="300" height="34" class="hidden"></canvas>
      <div id="wind"><canvas id="wind-dial" width="96" height="96"></canvas><div id="wind-speed"></div></div>
      <div id="spotter"><span id="spotter-range"></span><span id="spotter-call"></span></div>
      <div id="session" class="hidden">
        <div id="session-clock">2:00</div>
        <div id="session-stats"></div>
      </div>
      <div id="scorecard" class="hidden"><div class="card">
        <h3 id="sc-title">RUN COMPLETE</h3>
        <div id="sc-score"></div>
        <table id="sc-rows"></table>
        <div id="sc-medals"></div>
        <div id="sc-best"></div>
      </div></div>
      <div id="score"><span id="score-value">0</span><span id="score-streak"></span></div>
      <div id="clock"></div>
      <div id="objective" class="hidden"></div>
      <div id="crosshair" class="hidden"></div>
      <div id="hitmarker"></div>
      <div id="prompt" class="hidden"></div>
      <div id="toasts"></div>

      <div id="radial-menu" class="hidden">
        <div class="radial-wheel" id="radial-wheel"></div>
      </div>

      <div id="loading-screen" class="screen loading">
        <div class="panel">
          <h1>DEEP FOREST</h1>
          <p class="begin" id="loading-text">Loading…</p>
        </div>
      </div>

      <div id="start-screen" class="screen hidden">
        <div class="panel">
          <h1>DEEP FOREST</h1>
          <p class="story">The helicopter went down at first light. It's still burning.<br>
          West of the wreck someone cut a firing lane into the hillside —
          steel plates from 25 to 500 metres.<br>
          Range them, read the wind, and see what you can hit. Three drones
          patrol overhead — three hits each, and they smoke before they fall.<br>
          The post at the firing line starts a timed run — everything resets,
          two minutes on the clock, and your best is kept. Miss, and the
          spotter calls the correction.</p>
          <div class="controls">
            <span><b>WASD</b> move</span><span><b>Shift</b> sprint / hold breath</span>
            <span><b>C / Ctrl</b> crouch</span><span><b>Z</b> prone</span>
            <span><b>Mouse</b> look</span><span><b>E</b> interact</span>
            <span><b>LMB</b> fire</span><span><b>RMB</b> toggle aim / zoom</span>
            <span><b>R</b> reload</span><span><b>1 / 2</b> rifle / binoculars</span>
            <span><b>F</b> eat ration</span><span><b>T</b> build campfire</span>
            <span><b>Wind</b> dial, top right</span><span><b>Scope</b> marks = 100m each</span>
            <span><b>E</b> at the post: timed run</span><span><b>Esc</b> pause / settings</span>
          </div>
          <p class="begin" id="begin-fresh">CLICK TO BEGIN</p>
          <div id="save-choice" class="hidden">
            <button id="continue-btn">CONTINUE</button>
            <button id="newgame-btn">NEW GAME</button>
          </div>
        </div>
      </div>

      <div id="pause-screen" class="screen hidden">
        <div class="panel">
          <h2>PAUSED</h2>
          <div id="pause-settings">
            <label class="setting" for="sens-slider">
              <span class="setting-name">Mouse sensitivity</span>
              <input id="sens-slider" type="range" />
              <span class="setting-value" id="sens-value">1.00</span>
            </label>
            <button id="sens-reset" type="button">Reset</button>
          </div>
          <p class="begin">CLICK TO RESUME</p>
        </div>
      </div>

      <div id="death-screen" class="screen hidden">
        <div class="panel">
          <h2 class="red">YOU DIED</h2>
          <p id="death-detail"></p>
          <button id="retry-btn">TRY AGAIN</button>
        </div>
      </div>

      <div id="end-screen" class="screen hidden">
        <div class="panel">
          <h2>TO BE CONTINUED…</h2>
          <p>You reach the trail marker at the head of the valley. Beyond it, the
          mountain pass — and somewhere past that, an abandoned village and rescue.</p>
          <p id="end-detail"></p>
          <button id="end-retry-btn">PLAY AGAIN</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this.el = (id) => root.querySelector('#' + id);
    this.fills = {};
    for (const [key] of STAT_DEFS) {
      this.fills[key] = root.querySelector(`.stat[data-stat="${key}"] .fill`);
    }
    this.compassCtx = this.el('compass').getContext('2d');
    this._toastCount = 0;
    this._scorecardT = null;
    this._spotterT = null;
    this._settingsInteraction = false;
    this._pauseResumeHandler = null;

    this.el('retry-btn').addEventListener('click', () => location.reload());
    this.el('end-retry-btn').addEventListener('click', () => location.reload());
  }

  // ------------------------------------------------------------ stat panel
  setStats(stats) {
    for (const [key] of STAT_DEFS) {
      const v = Math.max(0, Math.min(100, stats[key]));
      this.fills[key].style.width = v + '%';
      this.fills[key].parentElement.classList.toggle('critical', v < 20);
    }
  }

  setAmmo(mag, reserve, visible) {
    const el = this.el('ammo');
    el.classList.toggle('hidden', !visible);
    el.textContent = `${mag} / ${reserve}`;
  }

  setCounts(inv) {
    this.el('counts').textContent = `Wood ${inv.wood}   ·   Rations ${inv.rations}`;
  }

  setClock(day, timeStr) {
    this.el('clock').textContent = `Day ${day} · ${timeStr}`;
  }

  // -------------------------------------------------------------- objective
  /**
   * @param text     the objective line itself, counter included
   *   ("Investigate the crash  2/4").
   * @param complete ticks and greens it out.
   * @param note     optional smaller hint line underneath ("Look in the
   *   forest for wood") — where to go / what to do, as opposed to what.
   */
  setObjective(text, complete = false, note = null) {
    const el = this.el('objective');
    el.classList.toggle('hidden', !text);
    el.classList.toggle('complete', complete);
    if (!text) return;

    el.textContent = '';
    const main = document.createElement('div');
    main.className = 'objective-main';
    main.textContent = (complete ? '✓ ' : '▸ ') + text;
    el.appendChild(main);
    if (note) {
      const hint = document.createElement('div');
      hint.className = 'objective-note';
      hint.textContent = note;
      el.appendChild(hint);
    }
  }

  // ------------------------------------------------------------ wind gauge
  /**
   * Sniper-Elite-style wind dial. The needle shows wind direction *relative
   * to where the player is looking*, which is the only frame that helps:
   * what a shooter needs to know is whether it pushes left or right across
   * their own sightline, not its compass bearing. Straight up means the
   * wind is blowing away from you (no drift); pointing right means it will
   * carry the bullet right.
   *
   * @param wind        the shared Wind instance
   * @param headingRad  the player's yaw
   */
  setWind(wind, headingRad) {
    const ctx = this.el('wind-dial').getContext('2d');
    const cx = 48, cy = 48, R = 34;
    ctx.clearRect(0, 0, 96, 96);

    ctx.strokeStyle = 'rgba(216,212,200,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // Cross ticks, so "sideways" is readable at a glance.
    ctx.strokeStyle = 'rgba(216,212,200,0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }

    // World bearing of the wind, minus where the player faces.
    const rel = Math.atan2(wind.x, -wind.z) - headingRad;
    const strength = Math.min(1, wind.speed / 12);
    const len = 8 + strength * (R - 12);

    // Canvas y grows downward, hence the negated sine: screen-up is "away".
    const tipX = cx + Math.sin(rel) * len;
    const tipY = cy - Math.cos(rel) * len;

    ctx.strokeStyle = strength > 0.62 ? '#e0733c' : '#e8e4d8';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Arrowhead
    const ah = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.sin(rel - 0.42) * ah, tipY + Math.cos(rel - 0.42) * ah);
    ctx.lineTo(tipX - Math.sin(rel + 0.42) * ah, tipY + Math.cos(rel + 0.42) * ah);
    ctx.closePath();
    ctx.fill();

    this.el('wind-speed').textContent = `${wind.speed.toFixed(1)} m/s`;
  }

  /** Letterboxes the view and names the shot. null ends it. The rest of the
   *  HUD is hidden meanwhile — stat bars over a cinematic look wrong, and
   *  the crosshair is meaningless when the camera isn't yours. */
  setKillcam(kind) {
    const el = this.el('killcam');
    el.classList.toggle('active', !!kind);
    document.getElementById('hud').classList.toggle('cinematic', !!kind);
    if (kind) this.el('killcam-label').textContent = kind;
  }

  /**
   * Breath meter under the reticle. Only shown when it's actionable —
   * while holding, and while recovering — so it isn't a permanent fixture
   * of a view whose whole job is to be uncluttered.
   */
  setFocus(focus) {
    const el = this.el('focus');
    const show = focus.state !== 'ready';
    el.classList.toggle('active', show);
    if (!show) return;
    const holding = focus.state === 'holding';
    el.classList.toggle('recovering', !holding);
    this.el('focus-bar').firstElementChild.style.width = `${Math.max(0, focus.fraction) * 100}%`;
    this.el('focus-label').textContent = holding
      ? 'HOLDING BREATH'
      : `RECOVERING  ${Math.ceil(focus.recovery)}s`;
  }

  // --------------------------------------------------------------- spotter
  /** A called miss, e.g. ("1.2m LOW   0.8m RIGHT", 400). Stays up long enough
   *  to act on and no longer — the correction is for the *next* shot. */
  spotterCall(text, dist) {
    const el = this.el('spotter');
    this.el('spotter-range').textContent = `${dist}m`;
    this.el('spotter-call').textContent = text;
    // Restart the animation even if a call is already showing: rapid fire
    // would otherwise leave the first call's timer governing the last one.
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
    clearTimeout(this._spotterT);
    this._spotterT = setTimeout(() => el.classList.remove('active'), 3600);
  }

  // ------------------------------------------------------------- run clock
  /** @param s null to hide, else { left, score, hits, shots }. */
  setSession(s) {
    const el = this.el('session');
    el.classList.toggle('hidden', !s);
    if (!s) return;
    const secs = Math.max(0, s.left);
    const mm = Math.floor(secs / 60);
    const ss = Math.floor(secs % 60);
    this.el('session-clock').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    el.classList.toggle('urgent', secs <= 10);
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    this.el('session-stats').textContent =
      `${s.score} pts   ·   ${s.hits}/${s.shots}   ·   ${acc}%`;
  }

  hideScorecard() {
    clearTimeout(this._scorecardT);
    this.el('scorecard').classList.add('hidden');
  }

  /**
   * End-of-run summary. Auto-dismisses rather than waiting for a click:
   * dismissing it would mean releasing the pointer lock, and dropping the
   * player out of mouse-look to read their own score is a worse trade than
   * simply letting it fade.
   */
  showScorecard(run, best, beaten, newMedals = [], medalCount = 0) {
    const el = this.el('scorecard');
    this.el('sc-title').textContent = run.cleared ? 'RANGE CLEARED' : 'TIME';
    this.el('sc-score').textContent = `${run.score}`;

    const rows = [
      ['Hits', `${run.hits} / ${run.shots}`],
      ['Accuracy', `${Math.round(run.accuracy * 100)}%`, beaten.accuracy && run.shots > 0],
      ['Best shot', run.bestShot ? `${run.bestShot} m` : '—', beaten.bestShot && run.bestShot > 0],
      ['Longest streak', run.longestStreak > 1 ? `x${run.longestStreak}` : '—', beaten.longestStreak && run.longestStreak > 1],
    ];
    if (run.timeBonus) {
      rows.push([`Time bonus (${Math.floor(run.secondsLeft)}s left)`, `+${run.timeBonus}`, true]);
    }
    this.el('sc-rows').innerHTML = rows.map(([k, v, hot]) =>
      `<tr><td>${k}</td><td class="${hot ? 'hot' : ''}">${v}${hot ? ' ★' : ''}</td></tr>`
    ).join('');

    // Medals are the run's headline when there are any — a first 700m hit
    // matters more to a player than the points it happened to be worth.
    this.el('sc-medals').innerHTML = newMedals.length
      ? newMedals.map((m) =>
          `<div class="medal"><b>${m.name}</b><span>${m.desc}</span></div>`).join('')
      : '';
    this.el('sc-medals').classList.toggle('empty', newMedals.length === 0);

    const bestEl = this.el('sc-best');
    if (beaten.score) {
      bestEl.className = 'record';
      bestEl.textContent = best ? `NEW BEST — beat ${best.score}` : 'NEW BEST';
    } else {
      bestEl.className = '';
      bestEl.textContent = `Best ${best.score}  ·  ${best.score - run.score} short`;
    }
    bestEl.textContent += `   ·   Medals ${medalCount}/${MEDALS.length}`;

    el.classList.remove('hidden');
    clearTimeout(this._scorecardT);
    this._scorecardT = setTimeout(() => el.classList.add('hidden'), CONFIG.session.scorecardMs);
  }

  // ---------------------------------------------------------------- score
  setScore(score, streak = 0) {
    this.el('score-value').textContent = String(score);
    const el = this.el('score-streak');
    el.textContent = streak > 1 ? `x${streak}` : '';
    el.classList.toggle('hot', streak >= 3);
  }

  // --------------------------------------------------------------- compass
  setCompass(headingDeg) {
    const canvas = this.el('compass');
    canvas.classList.toggle('hidden', headingDeg == null);
    if (headingDeg == null) return;
    const ctx = this.compassCtx;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,12,14,0.5)';
    ctx.fillRect(0, 0, w, h);
    const LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = -90; deg <= 90; deg += 15) {
      const abs = ((Math.round((headingDeg + deg) / 15) * 15) % 360 + 360) % 360;
      const rel = abs - headingDeg;
      const relWrapped = ((rel + 540) % 360) - 180;
      const x = w / 2 + relWrapped * 1.55;
      if (x < 8 || x > w - 8) continue;
      if (LABELS[abs] !== undefined) {
        ctx.fillStyle = abs === 0 ? '#e06a4a' : '#d8d4c8';
        ctx.font = 'bold 13px system-ui';
        ctx.fillText(LABELS[abs], x, h / 2 + 3);
      } else {
        ctx.fillStyle = 'rgba(216,212,200,0.5)';
        ctx.fillRect(x - 0.5, h / 2 + 4, 1, 6);
      }
    }
    // center marker
    ctx.fillStyle = '#e0dcd0';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 4, 2);
    ctx.lineTo(w / 2 + 4, 2);
    ctx.lineTo(w / 2, 8);
    ctx.fill();
  }

  // ----------------------------------------------------- prompts and toasts
  setPrompt(text) {
    const el = this.el('prompt');
    el.classList.toggle('hidden', !text);
    if (text) el.textContent = text;
  }

  toast(text, duration = 4200) {
    const container = this.el('toasts');
    if (this._toastCount > 3) container.firstChild?.remove();
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    container.appendChild(div);
    this._toastCount++;
    setTimeout(() => div.classList.add('fading'), duration - 700);
    setTimeout(() => { div.remove(); this._toastCount--; }, duration);
  }

  // ---------------------------------------------------------- feedback fx
  setCrosshair(visible) {
    this.el('crosshair').classList.toggle('hidden', !visible);
  }

  setBinocularMask(on) {
    this.el('binoc-mask').classList.toggle('active', on);
  }

  /** @param meters distance to whatever's dead-center in view, or null if nothing in range */
  setScopeView(on, meters) {
    this.el('scope-overlay').classList.toggle('active', on);
    if (on) this.el('scope-range').textContent = meters != null ? `${meters} m` : '— m';
  }

  hitmarker() {
    const el = this.el('hitmarker');
    el.classList.remove('active');
    void el.offsetWidth; // restart animation
    el.classList.add('active');
  }

  damageFlash() {
    const el = this.el('damage-flash');
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
  }

  setColdOverlay(amount) {
    this.el('cold-overlay').style.opacity = (amount * 0.55).toFixed(3);
  }

  setHealthPulse(critical) {
    this.el('vignette').classList.toggle('pulse', critical);
  }

  fade(toBlack, seconds = 1.2) {
    const el = this.el('fade');
    el.style.transitionDuration = seconds + 's';
    el.style.opacity = toBlack ? 1 : 0;
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  // ------------------------------------------------------------ radial menu
  /**
   * A pizza-slice selection wheel (PUBG-style) for campfire actions. Shows
   * a real OS cursor for clicking (pointer lock is released by the caller
   * beforehand) rather than a locked-camera virtual-cursor trick.
   * @param options [{ key, label, enabled }]
   * @returns Promise<string|null> the chosen key, or null if cancelled
   *   (Escape or clicking the backdrop).
   */
  showRadialMenu(options) {
    const menu = this.el('radial-menu');
    const wheel = this.el('radial-wheel');
    wheel.innerHTML = '';

    return new Promise((resolve) => {
      let settled = false;
      const finish = (key) => {
        if (settled) return;
        settled = true;
        menu.classList.add('hidden');
        document.removeEventListener('keydown', onKeyDown);
        menu.removeEventListener('click', onBackdropClick);
        resolve(key);
      };
      const onKeyDown = (e) => { if (e.code === 'Escape') finish(null); };
      const onBackdropClick = (e) => { if (e.target === menu) finish(null); };

      const n = options.length;
      options.forEach((opt, i) => {
        const wedge = document.createElement('div');
        wedge.className = 'radial-wedge' + (opt.enabled === false ? ' disabled' : '');
        wedge.style.clipPath = wedgePolygon(i, n);

        const midDeg = ((i + 0.5) / n) * 360 - 90;
        const rad = (midDeg * Math.PI) / 180;
        const label = document.createElement('span');
        label.className = 'radial-label';
        label.style.left = (50 + 32 * Math.cos(rad)) + '%';
        label.style.top = (50 + 32 * Math.sin(rad)) + '%';
        label.textContent = opt.label;
        wedge.appendChild(label);

        if (opt.enabled !== false) {
          wedge.addEventListener('click', () => finish(opt.key));
        }
        wheel.appendChild(wedge);
      });

      document.addEventListener('keydown', onKeyDown);
      menu.addEventListener('click', onBackdropClick);
      menu.classList.remove('hidden');
    });
  }

  // --------------------------------------------------------------- screens
  setLoadingProgress({ loaded, total }) {
    this.el('loading-text').textContent = total > 0 ? `Loading… ${loaded}/${total}` : 'Loading…';
  }

  /** Swaps the loading screen out for the real start screen — called once
   *  every requested asset has settled (see Game.js / assets.js). */
  /** Hides the survival readouts on the practice range — stats, clock,
   *  objective and inventory mean nothing there and only add noise. */
  setRangeMode(on) {
    document.getElementById('hud').classList.toggle('range-mode', on);
  }

  hideLoading() {
    this.el('loading-screen').classList.add('hidden');
    this.el('start-screen').classList.remove('hidden');
  }

  /**
   * @param hasSave    if true, shows Continue/New Game buttons instead of
   *   the plain "click anywhere to begin" panel.
   * @param onBegin    fresh start (no save present).
   * @param onContinue resume from the save (hasSave only).
   * @param onNewGame  discard the save and restart (hasSave only).
   */
  showStart({ hasSave = false, onBegin, onContinue, onNewGame }) {
    const screen = this.el('start-screen');
    this.el('begin-fresh').classList.toggle('hidden', hasSave);
    this.el('save-choice').classList.toggle('hidden', !hasSave);

    if (hasSave) {
      this.el('continue-btn').addEventListener('click', () => {
        screen.classList.add('hidden');
        onContinue();
      }, { once: true });
      this.el('newgame-btn').addEventListener('click', () => onNewGame(), { once: true });
    } else {
      const handler = () => {
        screen.classList.add('hidden');
        screen.removeEventListener('click', handler);
        onBegin();
      };
      screen.addEventListener('click', handler);
    }
  }

  /**
   * Wires the pause menu's settings once, at startup.
   *
   * @param initial   starting multiplier
   * @param onChange  called with every new value as the slider moves, so the
   *   change can be felt immediately on resuming rather than only after a
   *   commit the player has no reason to expect.
   */
  bindSettings({ sensitivity, range, onSensitivity }) {
    const slider = this.el('sens-slider');
    slider.min = range.min;
    slider.max = range.max;
    slider.step = range.step;
    slider.value = sensitivity;
    this.el('sens-value').textContent = Number(sensitivity).toFixed(2);

    const apply = (v) => {
      const n = Number(v);
      slider.value = n;
      this.el('sens-value').textContent = n.toFixed(2);
      onSensitivity(n);
    };
    slider.addEventListener('input', () => apply(slider.value));
    this.el('sens-reset').addEventListener('click', () => apply(range.default));

    // Anything that starts inside the settings block swallows the next click
    // on the screen. Without this, letting go of the slider resumes the game:
    // the pointer goes down on the slider and up somewhere else, and the
    // resulting `click` is delivered to their common ancestor — the pause
    // screen, whose job is to resume on any click.
    this.el('pause-settings').addEventListener('pointerdown', () => {
      this._settingsInteraction = true;
    });
  }

  showPause(visible, onResume) {
    const screen = this.el('pause-screen');
    screen.classList.toggle('hidden', !visible);
    this._settingsInteraction = false;

    // Not a one-shot listener: browsers impose a brief cooldown on
    // re-requesting pointer lock right after an Escape-driven unlock, so
    // the first click can silently fail to actually resume. Keep the
    // handler live so clicking again retries — it's only torn down once
    // Game.js calls showPause(false), which only happens once the lock
    // has genuinely re-acquired (see Input's onLockChange).
    if (this._pauseResumeHandler) {
      screen.removeEventListener('click', this._pauseResumeHandler);
      this._pauseResumeHandler = null;
    }
    if (visible && onResume) {
      this._pauseResumeHandler = (e) => {
        // Clicks on the controls themselves, and the click that ends a drag
        // begun on one, adjust settings rather than resuming.
        //
        // The flag is cleared on every click, including the ones that land on
        // the controls. Clearing it only on the swallowed-drag path leaves it
        // set after an ordinary click on the slider or the reset button, and
        // the next click — the one meant to resume — is eaten instead.
        const onControls = e.target.closest('#pause-settings');
        const endedDrag = this._settingsInteraction;
        this._settingsInteraction = false;
        if (onControls || endedDrag) return;
        onResume();
      };
      screen.addEventListener('click', this._pauseResumeHandler);
    }
  }

  showDeath({ cause, day, minutes, kills }) {
    this.el('death-detail').textContent =
      `Killed by ${cause || 'the wilderness'} on day ${day}. ` +
      `You survived ${minutes} min and put down ${kills} ${kills === 1 ? 'wolf' : 'wolves'}.`;
    this.el('death-screen').classList.remove('hidden');
  }

  showEnd({ day, minutes, kills }) {
    this.el('end-detail').textContent =
      `Day ${day} · ${minutes} min survived · ${kills} ${kills === 1 ? 'wolf' : 'wolves'} put down.`;
    this.el('end-screen').classList.remove('hidden');
  }
}
