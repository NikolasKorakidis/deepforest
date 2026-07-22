// DOM-based HUD: stat bars, ammo, compass strip, prompts, toasts, overlays
// (damage flash, cold vignette, binocular mask) and full-screen menus
// (start / pause / death / end).

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
      <div id="binoc-mask"></div>
      <div id="fade"></div>

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
      <div id="clock"></div>
      <div id="objective" class="hidden"></div>
      <div id="crosshair" class="hidden"></div>
      <div id="hitmarker"></div>
      <div id="prompt" class="hidden"></div>
      <div id="toasts"></div>

      <div id="radial-menu" class="hidden">
        <div class="radial-wheel" id="radial-wheel"></div>
      </div>

      <div id="start-screen" class="screen">
        <div class="panel">
          <h1>DEEP FOREST</h1>
          <p class="story">The helicopter went down in the dark. It's still burning.<br>
          You are hurt, cold, and alone — and the valley ahead is the only way out.<br>
          Look for survivors. Scavenge what you can. Follow the path north.</p>
          <div class="controls">
            <span><b>WASD</b> move</span><span><b>Shift</b> sprint</span>
            <span><b>Mouse</b> look</span><span><b>E</b> interact</span>
            <span><b>LMB</b> fire</span><span><b>RMB</b> aim / zoom</span>
            <span><b>R</b> reload</span><span><b>1 / 2</b> rifle / binoculars</span>
            <span><b>F</b> eat ration</span><span><b>T</b> build campfire</span>
            <span><b>E</b> at fire: cook / sleep</span><span><b>Esc</b> pause</span>
          </div>
          <p class="begin">CLICK TO BEGIN</p>
        </div>
      </div>

      <div id="pause-screen" class="screen hidden">
        <div class="panel"><h2>PAUSED</h2><p class="begin">CLICK TO RESUME</p></div>
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
  setObjective(text, complete = false) {
    const el = this.el('objective');
    el.classList.toggle('hidden', !text);
    el.classList.toggle('complete', complete);
    if (text) el.textContent = (complete ? '✓ ' : '▸ ') + text;
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
  showStart(onBegin) {
    const screen = this.el('start-screen');
    const handler = () => {
      screen.classList.add('hidden');
      screen.removeEventListener('click', handler);
      onBegin();
    };
    screen.addEventListener('click', handler);
  }

  showPause(visible, onResume) {
    const screen = this.el('pause-screen');
    screen.classList.toggle('hidden', !visible);
    if (visible && onResume) {
      const handler = () => {
        screen.removeEventListener('click', handler);
        onResume();
      };
      screen.addEventListener('click', handler);
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
