// Keyboard + mouse input with pointer lock. Held keys are polled via
// isDown(); discrete actions register callbacks via onPress()/onMouseDown().

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this.pressHandlers = new Map();
    this.mouseDownHandlers = new Map();
    this.mouseUpHandlers = new Map();
    this.lockChangeHandlers = [];

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const handlers = this.pressHandlers.get(e.code);
      if (handlers) handlers.forEach((fn) => fn());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDownHandlers.get(e.button)?.forEach((fn) => fn());
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseUpHandlers.get(e.button)?.forEach((fn) => fn());
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement != null;
      this.lockChangeHandlers.forEach((fn) => fn(this.pointerLocked));
    });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  onPress(code, fn) {
    if (!this.pressHandlers.has(code)) this.pressHandlers.set(code, []);
    this.pressHandlers.get(code).push(fn);
  }

  onMouseDown(button, fn) {
    if (!this.mouseDownHandlers.has(button)) this.mouseDownHandlers.set(button, []);
    this.mouseDownHandlers.get(button).push(fn);
  }

  onMouseUp(button, fn) {
    if (!this.mouseUpHandlers.has(button)) this.mouseUpHandlers.set(button, []);
    this.mouseUpHandlers.get(button).push(fn);
  }

  onLockChange(fn) {
    this.lockChangeHandlers.push(fn);
  }

  /** Returns and clears the accumulated mouse delta for this frame. */
  consumeMouseDelta() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  lock(el = document.body) {
    try {
      const p = el.requestPointerLock();
      // Chrome returns a promise that rejects if lock is denied/throttled.
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* pointer lock unavailable — game still runs, look is disabled */
    }
  }
}
