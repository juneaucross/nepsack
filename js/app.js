/* ═══════════════════════════════════════════════════════════════
   СЭМИАМ НЭПСЭК · АРХИВ 003
   app.js — interactions, WebGL atmosphere, 3D d20, glass eye
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const NS = 'http://www.w3.org/2000/svg';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const HP_MAX = 15;

  /* ── state ───────────────────────────────────────────────── */
  const STORE_KEY = 'nepsack.dossier.v1';
  const defaultState = () => ({
    hp: HP_MAX,
    slots: [true, true],
    death: { s: 0, f: 0 },
    sound: false,
    ringUsed: false,
  });

  function loadState() {
    const base = defaultState();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const p = JSON.parse(raw);
      return {
        hp: clamp(Number.isFinite(+p.hp) ? +p.hp : HP_MAX, 0, HP_MAX),
        slots: Array.isArray(p.slots) ? [!!p.slots[0], !!p.slots[1]] : base.slots,
        death: {
          s: clamp(Number.isFinite(+p.death?.s) ? +p.death.s : 0, 0, 3),
          f: clamp(Number.isFinite(+p.death?.f) ? +p.death.f : 0, 0, 3),
        },
        sound: !!p.sound,
        ringUsed: !!p.ringUsed,
      };
    } catch {
      return base;
    }
  }

  let state = loadState();
  let printMode = false;
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch { /* private mode */ }
  }

  /* ── sound ───────────────────────────────────────────────── */
  const Sound = {
    ctx: null,
    master: null,
    on: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
      } catch { this.ctx = null; }
    },
    async enable(on) {
      this.init();
      if (!this.ctx) { this.on = false; return false; }
      this.on = on;
      if (on && this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch { /* noop */ }
      }
      return this.on;
    },
    tone(freq, dur = 0.08, type = 'sine', gain = 0.03, when = 0) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(30, freq), t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.03);
    },
    click() { this.tone(rand(620, 880), 0.035, 'square', 0.012); },
    tick() { this.tone(rand(280, 520), 0.045, 'triangle', 0.018); },
    roll() {
      for (let i = 0; i < 8; i += 1) this.tone(rand(160, 460), 0.045, 'square', 0.016, i * 0.085);
    },
    chime() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.022, i * 0.055));
    },
    hurt() {
      this.tone(90, 0.22, 'sawtooth', 0.035);
      this.tone(60, 0.32, 'sine', 0.03, 0.03);
    },
    fail() {
      this.tone(140, 0.18, 'square', 0.025);
      this.tone(96, 0.4, 'sine', 0.025, 0.1);
    },
  };

  /* ── toast ───────────────────────────────────────────────── */
  const toastEl = $('#toast');
  const toastText = $('#toast-text');
  let toastTimer = 0;
  function showToast(text, tone = '', duration = 3400) {
    if (!toastEl) return;
    toastText.textContent = text;
    toastEl.classList.remove('is-glass', 'is-blood');
    if (tone) toastEl.classList.add(tone);
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), duration);
  }

  /* ═══════════════════════════════════════════════════════════
     WEBGL ATMOSPHERE
     ═══════════════════════════════════════════════════════════ */
  function initShader() {
    const canvas = $('#bg-canvas');
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) { document.body.classList.add('no-gl'); canvas.style.display = 'none'; return; }

    const vert = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const frag = `
      precision mediump float;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_mouse;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = m * p;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_res;
        vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
        float t = u_time * 0.055;

        vec2 q = p * 1.25;
        float w = fbm(q + vec2(0.0, -t * 1.6));
        vec2 warp = vec2(
          fbm(q + vec2(w * 0.9, t * 0.8)),
          fbm(q + vec2(-t * 0.9, w * 0.7))
        );

        float n = fbm(q * 1.7 + warp * 1.25 + vec2(0.0, -t * 3.0));
        float n2 = fbm(q * 3.4 - warp * 0.85 + vec2(t * 2.2, 0.0));

        vec3 ink = vec3(0.043, 0.027, 0.020);
        vec3 ember = vec3(0.941, 0.631, 0.427);
        vec3 blood = vec3(0.560, 0.012, 0.012);
        vec3 glass = vec3(0.560, 0.890, 0.816);

        vec3 col = ink;
        col += ember * pow(n, 2.0) * 0.30;
        col += blood * pow(n2, 4.0) * 0.26;
        col += glass * pow(max(0.0, n2 - 0.60), 2.0) * 0.14;

        vec2 m = (u_mouse * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
        float d = length(p - m * 0.9);
        col += ember * 0.050 / (d * d + 0.45);

        float e = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          vec2 gv = vec2(
            p.x * (3.0 + fi) + fi * 4.7,
            p.y * (1.6 + fi * 0.4) - u_time * (0.10 + fi * 0.05)
          );
          vec2 id = floor(gv);
          vec2 f = fract(gv) - 0.5;
          float h = hash(id + fi * 31.0);
          float s = smoothstep(0.085, 0.0, length(f));
          e += s * step(0.88, h) * (0.4 + 0.6 * hash(id + 7.0));
        }
        col += ember * e * 0.55;

        float vig = smoothstep(1.35, 0.25, length(p * vec2(0.9, 1.0)));
        col *= vig * 0.85 + 0.15;
        col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.022;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type, source) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('Shader error:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) { document.body.classList.add('no-gl'); canvas.style.display = 'none'; return; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('Program link error:', gl.getProgramInfoLog(prog));
      document.body.classList.add('no-gl');
      canvas.style.display = 'none';
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    let raf = 0;
    let t0 = performance.now();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const scale = window.innerWidth < 700 ? 0.58 : 0.78;
      canvas.width = Math.max(320, Math.round(window.innerWidth * dpr * scale));
      canvas.height = Math.max(320, Math.round(window.innerHeight * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function frame(now) {
      const time = (now - t0) / 1000;
      mouse.x = lerp(mouse.x, mouse.tx, 0.045);
      mouse.y = lerp(mouse.y, mouse.ty, 0.045);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('pointermove', (e) => {
      mouse.tx = e.clientX / window.innerWidth;
      mouse.ty = 1 - e.clientY / window.innerHeight;
    }, { passive: true });

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        t0 = performance.now() - 1;
        raf = requestAnimationFrame(frame);
      }
    });

    resize();
    if (REDUCED) {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, 4);
      gl.uniform2f(uMouse, 0.5, 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      raf = requestAnimationFrame(frame);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     BOOT SEQUENCE
     ═══════════════════════════════════════════════════════════ */
  const boot = $('#boot');
  let bootDone = false;
  let bootRaf = 0;
  let revealsStarted = false;

  function finishBoot() {
    if (bootDone || !boot) return;
    bootDone = true;
    cancelAnimationFrame(bootRaf);
    boot.classList.add('boot--done');
    boot.inert = true;
    boot.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    document.body.classList.add('is-booted');
    if (!revealsStarted) {
      revealsStarted = true;
      setTimeout(initReveals, 120);
    }
  }

  function runBoot(instant = false) {
    if (!boot) return;
    bootDone = false;
    cancelAnimationFrame(bootRaf);
    boot.classList.remove('boot--done');
    boot.inert = false;
    boot.removeAttribute('aria-hidden');
    document.body.classList.add('is-locked');
    document.body.classList.remove('is-booted');

    const log = $('#boot-log');
    if (log) log.innerHTML = log.innerHTML; // restart log animations
    const pct = $('#boot-percent');
    const bar = $('#boot-bar');
    if (pct) pct.textContent = '0%';
    if (bar) bar.style.width = '0%';

    const duration = instant ? 450 : REDUCED ? 350 : 2350;
    const start = performance.now();
    const step = (now) => {
      const p = clamp((now - start) / duration, 0, 1);
      const pctVal = Math.round(easeOut(p) * 100);
      if (pct) pct.textContent = pctVal + '%';
      if (bar) bar.style.width = pctVal + '%';
      if (p < 1) {
        bootRaf = requestAnimationFrame(step);
      } else {
        bootRaf = setTimeout(finishBoot, 160);
      }
    };
    bootRaf = requestAnimationFrame(step);
    // hard safety: never let the overlay trap the page
    setTimeout(finishBoot, duration + 1200);
  }

  function initBootClock() {
    const el = $('#boot-clock');
    if (!el) return;
    const tick = () => {
      const d = new Date();
      el.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, '0')).join(':');
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════════════════════
     REVEALS · COUNTERS · SCRAMBLE
     ═══════════════════════════════════════════════════════════ */
  function initReveals() {
    const targets = $$([
      '.sec-head',
      '.dossier__card',
      '.dossier__side',
      '.fact',
      '.ability',
      '.radar-wrap',
      '.hp-panel',
      '.skills-tools',
      '.skill-list',
      '.saves',
      '.skills-side > *',
      '.weapon',
      '.sneak',
      '.equipment',
      '.spell-meta',
      '.spell-group',
      '.eye-card',
      '.relic',
      '.trinkets',
      '.paper-wrap',
      '.features',
      '.hero .reveal',
      '.end__lead',
      '.end__actions',
    ].join(','));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });

    targets.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--d', `${Math.min(i % 5, 4) * 0.06}s`);
      io.observe(el);
    });

    // counters
    const counterIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCount(entry.target);
        counterIO.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    $$('.fact__num').forEach((el) => counterIO.observe(el));

    // scramble headings
    const scrambleIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        scramble(entry.target);
        scrambleIO.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    $$('[data-scramble]').forEach((el) => scrambleIO.observe(el));

    // hero items get a fixed stagger even if already in view
    $$('.hero .reveal').forEach((el, i) => el.style.setProperty('--d', `${0.08 + i * 0.09}s`));
  }

  function animateCount(el) {
    const target = parseFloat(el.dataset.count || '0');
    if (REDUCED) { el.textContent = String(target); return; }
    const start = performance.now();
    const dur = 1500;
    const step = (now) => {
      if (printMode) { el.textContent = String(target); return; }
      const p = clamp((now - start) / dur, 0, 1);
      el.textContent = String(Math.round(target * easeOut(p)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function scramble(el) {
    if (REDUCED || el.dataset.scrambled) return;
    el.dataset.scrambled = '1';
    const finalText = el.textContent.trim();
    el.dataset.final = finalText;
    const chars = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789#/№@';
    const start = performance.now();
    const dur = 780;
    const step = (now) => {
      if (printMode) { el.textContent = finalText; return; }
      const p = clamp((now - start) / dur, 0, 1);
      const revealed = Math.floor(p * finalText.length);
      let out = '';
      for (let i = 0; i < finalText.length; i += 1) {
        if (i < revealed || finalText[i] === ' ') out += finalText[i];
        else out += chars[Math.floor(Math.random() * chars.length)];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = finalText;
    };
    requestAnimationFrame(step);
  }

  function splitLetters() {
    $$('[data-split]').forEach((el) => {
      if (el.classList.contains('hero__line--ember')) return;
      const text = el.textContent;
      el.textContent = '';
      Array.from(text).forEach((ch) => {
        if (ch === ' ') {
          el.appendChild(document.createTextNode(' '));
          return;
        }
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch;
        el.appendChild(span);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     CUSTOM CURSOR · MAGNETIC · TILT
     ═══════════════════════════════════════════════════════════ */
  function initCursor() {
    if (!FINE || REDUCED) return;
    const cursor = $('#cursor');
    if (!cursor) return;
    const ring = $('.cursor__ring', cursor);
    const label = $('.cursor__label', cursor);
    const root = document.documentElement;
    root.classList.add('has-cursor');

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let visible = false;

    window.addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      cursor.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
      if (!visible) {
        visible = true;
        cursor.classList.add('is-ready');
      }
    }, { passive: true });

    const loop = () => {
      rx = lerp(rx, mx, 0.16);
      ry = lerp(ry, my, 0.16);
      if (ring) ring.style.transform = `translate(${rx - mx}px, ${ry - my}px)`;
      requestAnimationFrame(loop);
    };
    loop();

    const LABELS = {
      A: 'ПЕРЕЙТИ',
      BUTTON: 'ДЕЙСТВИЕ',
      SUMMARY: 'РАСКРЫТЬ',
    };

    document.addEventListener('pointerover', (e) => {
      const el = e.target instanceof Element ? e.target.closest('a, button, summary, .skill, .spell__head, [data-roll]') : null;
      if (!el) {
        cursor.classList.remove('is-hot');
        return;
      }
      cursor.classList.add('is-hot');
      let text = el.dataset.cursorLabel || '';
      if (!text) {
        if (el.classList.contains('skill')) text = 'd20';
        else if (el.classList.contains('spell__head')) text = 'РАСКРЫТЬ';
        else if (el.hasAttribute('data-roll')) text = 'БРОСОК';
        else text = LABELS[el.tagName] || '';
      }
      if (label) label.textContent = text;
    });

    document.addEventListener('pointerleave', () => {
      visible = false;
      cursor.classList.remove('is-ready');
    });
  }

  function initTilt() {
    if (!FINE || REDUCED) return;
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${(-ny * 6).toFixed(2)}deg) rotateY(${(nx * 8).toFixed(2)}deg) translateY(-3px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });

    $$('.magnetic').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `translate(${(nx * 8).toFixed(2)}px, ${(ny * 5).toFixed(2)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  function initLens() {
    const art = $('#hero-art');
    const lens = $('#lens');
    if (!art || !lens) return;
    art.addEventListener('pointermove', (e) => {
      const r = art.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      lens.style.setProperty('--ix', `${(nx * 16).toFixed(1)}px`);
      lens.style.setProperty('--iy', `${(ny * 11).toFixed(1)}px`);
    });
    art.addEventListener('pointerleave', () => {
      lens.style.setProperty('--ix', '0px');
      lens.style.setProperty('--iy', '0px');
    });
  }

  /* ═══════════════════════════════════════════════════════════
     RADAR
     ═══════════════════════════════════════════════════════════ */
  function initRadar() {
    const svg = $('#radar');
    if (!svg) return;
    const grid = $('.radar__grid', svg);
    const shape = $('#radar-shape', svg);
    const dots = $('#radar-dots', svg);
    const values = $('#radar-values', svg);
    if (!grid || !shape || !dots || !values) return;

    const cx = 180;
    const cy = 180;
    const maxR = 126;
    const angles = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
    const scores = $$('.ability').map((a) => +a.dataset.score || 10);

    const pointAt = (angle, radius) => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];

    [4, 8, 12, 16, 20].forEach((level) => {
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', angles.map((a) => pointAt(a, (maxR * level) / 20).map((n) => n.toFixed(1)).join(',')).join(' '));
      grid.appendChild(poly);
    });

    angles.forEach((a) => {
      const line = document.createElementNS(NS, 'line');
      const [x, y] = pointAt(a, maxR);
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', x.toFixed(1));
      line.setAttribute('y2', y.toFixed(1));
      grid.appendChild(line);
    });

    shape.setAttribute('points', scores.map((s, i) => {
      const [x, y] = pointAt(angles[i], (maxR * clamp(s, 0, 20)) / 20);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' '));

    scores.forEach((s, i) => {
      const [x, y] = pointAt(angles[i], (maxR * s) / 20);
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
      dot.setAttribute('r', '3');
      dots.appendChild(dot);

      const [vx, vy] = pointAt(angles[i], 118);
      const val = document.createElementNS(NS, 'text');
      val.setAttribute('x', vx.toFixed(1));
      val.setAttribute('y', (vy + 4).toFixed(1));
      val.setAttribute('text-anchor', 'middle');
      val.textContent = String(s);
      values.appendChild(val);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SKILLS + SAVES
     ═══════════════════════════════════════════════════════════ */
  const ABILITY_LABEL = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };

  const SKILLS = [
    { ru: 'Акробатика', en: 'Acrobatics', ab: 'dex', prof: true },
    { ru: 'Уход за животными', en: 'Animal Handling', ab: 'wis', prof: false },
    { ru: 'Магия', en: 'Arcana', ab: 'int', prof: false },
    { ru: 'Атлетика', en: 'Athletics', ab: 'str', prof: true },
    { ru: 'Обман', en: 'Deception', ab: 'cha', prof: true },
    { ru: 'История', en: 'History', ab: 'int', prof: false },
    { ru: 'Проницательность', en: 'Insight', ab: 'wis', prof: false },
    { ru: 'Запугивание', en: 'Intimidation', ab: 'cha', prof: false },
    { ru: 'Анализ', en: 'Investigation', ab: 'int', prof: true },
    { ru: 'Медицина', en: 'Medicine', ab: 'wis', prof: false },
    { ru: 'Природа', en: 'Nature', ab: 'int', prof: false },
    { ru: 'Внимательность', en: 'Perception', ab: 'wis', prof: true },
    { ru: 'Выступление', en: 'Performance', ab: 'cha', prof: false },
    { ru: 'Убеждение', en: 'Persuasion', ab: 'cha', prof: true },
    { ru: 'Религия', en: 'Religion', ab: 'int', prof: false },
    { ru: 'Ловкость рук', en: 'Sleight of Hand', ab: 'dex', prof: true },
    { ru: 'Скрытность', en: 'Stealth', ab: 'dex', prof: true },
    { ru: 'Выживание', en: 'Survival', ab: 'wis', prof: false },
  ].map((s) => ({ ...s, bonus: s.prof ? 2 : 0 }));

  const SAVES = [
    { ru: 'Сила', en: 'Strength', ab: 'str', prof: false },
    { ru: 'Ловкость', en: 'Dexterity', ab: 'dex', prof: true },
    { ru: 'Телосложение', en: 'Constitution', ab: 'con', prof: false },
    { ru: 'Интеллект', en: 'Intelligence', ab: 'int', prof: true },
    { ru: 'Мудрость', en: 'Wisdom', ab: 'wis', prof: false },
    { ru: 'Харизма', en: 'Charisma', ab: 'cha', prof: false },
  ].map((s) => ({ ...s, bonus: s.prof ? 2 : 0 }));

  let skillFilter = 'all';
  let skillQuery = '';

  function renderSkills() {
    const list = $('#skill-list');
    const saves = $('#save-list');
    if (list) {
      list.innerHTML = SKILLS.map((s) => `
        <li>
          <button type="button" class="skill${s.prof ? ' is-prof' : ''}" data-skill="${s.ru}" data-bonus="${s.bonus}" data-ab="${s.ab}">
            <span class="skill__name">
              <span class="skill__prof" aria-hidden="true"></span>
              <span class="skill__ru">${s.ru}</span>
              <span class="skill__en">${s.en}</span>
            </span>
            <span class="skill__ability">${ABILITY_LABEL[s.ab]}</span>
            <span class="skill__bonus">${fmt(s.bonus)}<span class="skill__d20">d20</span></span>
          </button>
        </li>`).join('');
    }

    if (saves) {
      saves.innerHTML = SAVES.map((s) => `
        <li>
          <button type="button" class="save${s.prof ? ' is-prof' : ''}" data-skill="Спасбросок · ${s.ru}" data-bonus="${s.bonus}">
            <span class="save__dot" aria-hidden="true"></span>
            <span class="save__name">${s.ru}</span>
            <span class="save__bonus">${fmt(s.bonus)}</span>
          </button>
        </li>`).join('');
    }

    const filters = $('#skill-filters');
    if (filters) {
      const all = [{ key: 'all', label: 'ВСЕ' }].concat(
        Object.entries(ABILITY_LABEL).map(([key, label]) => ({ key, label }))
      );
      filters.innerHTML = all.map((f) => `
        <button type="button" class="filter${f.key === 'all' ? ' is-active' : ''}" data-filter="${f.key}">${f.label}</button>
      `).join('');
    }

    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('.skill');
        if (!btn) return;
        openDice({ label: btn.dataset.skill, bonus: +btn.dataset.bonus });
        Sound.click();
      });
    }
    if (saves) {
      saves.addEventListener('click', (e) => {
        const btn = e.target.closest('.save');
        if (!btn) return;
        openDice({ label: btn.dataset.skill, bonus: +btn.dataset.bonus });
        Sound.click();
      });
    }
    if (filters) {
      filters.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter');
        if (!btn) return;
        skillFilter = btn.dataset.filter;
        $$('.filter', filters).forEach((b) => b.classList.toggle('is-active', b === btn));
        applySkillFilters();
        Sound.click();
      });
    }
  }

  function applySkillFilters() {
    const items = $$('.skill');
    let visible = 0;
    items.forEach((btn) => {
      const matchesAb = skillFilter === 'all' || btn.dataset.ab === skillFilter;
      const text = btn.textContent.toLowerCase();
      const matchesQuery = !skillQuery || text.includes(skillQuery);
      const show = matchesAb && matchesQuery;
      btn.closest('li').style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    const empty = $('#skills-empty');
    if (empty) empty.hidden = visible > 0;
  }

  function initSkillSearch() {
    const input = $('#skill-search');
    if (!input) return;
    input.addEventListener('input', () => {
      skillQuery = input.value.trim().toLowerCase();
      applySkillFilters();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        skillQuery = '';
        applySkillFilters();
        input.blur();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     3D D20
     ═══════════════════════════════════════════════════════════ */
  const D20 = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    const rawVerts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];

    const verts = rawVerts.map(norm);
    const centroids = faces.map((f) => norm(add(add(verts[f[0]], verts[f[1]]), verts[f[2]])));
    const normals = faces.map((f, i) => {
      let n = norm(cross(sub(verts[f[1]], verts[f[0]]), sub(verts[f[2]], verts[f[0]])));
      if (dot(n, centroids[i]) < 0) n = scale(n, -1);
      return n;
    });

    // assign numbers so opposite faces sum to 21
    const opposite = centroids.map((c, i) => {
      let best = -1;
      let bestDot = Infinity;
      centroids.forEach((d, j) => {
        if (j === i) return;
        const v = dot(c, d);
        if (v < bestDot) { bestDot = v; best = j; }
      });
      return best;
    });
    const faceNumber = new Array(faces.length).fill(0);
    const used = new Set();
    for (let i = 0; i < faces.length; i += 1) {
      if (faceNumber[i]) continue;
      let a = 1;
      while (used.has(a) || used.has(21 - a) || a > 10) a += 1;
      const b = 21 - a;
      faceNumber[i] = a;
      faceNumber[opposite[i]] = b;
      used.add(a);
      used.add(b);
    }
    const byNumber = {};
    faceNumber.forEach((n, i) => { byNumber[n] = i; });

    // quaternion utils
    const qMul = (a, b) => {
      const [ax, ay, az, aw] = a;
      const [bx, by, bz, bw] = b;
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
      ];
    };
    const qNorm = (q) => {
      const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    };
    const qFromAxis = (axis, angle) => {
      const a = norm(axis);
      const s = Math.sin(angle / 2);
      return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
    };
    const qFromUnitVectors = (from, to) => {
      const d = clamp(dot(from, to), -1, 1);
      if (d > 0.999999) return [0, 0, 0, 1];
      if (d < -0.999999) {
        let axis = cross(from, [1, 0, 0]);
        if (len(axis) < 1e-4) axis = cross(from, [0, 1, 0]);
        return qFromAxis(axis, Math.PI);
      }
      const c = cross(from, to);
      return qNorm([c[0], c[1], c[2], 1 + d]);
    };
    const qRotate = (q, v) => {
      const u = [q[0], q[1], q[2]];
      const w = q[3];
      const uv = cross(u, v);
      const uuv = cross(u, uv);
      return add(v, add(scale(uv, 2 * w), scale(uuv, 2)));
    };
    const qSlerp = (a, b, t) => {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
      let bb = b;
      if (d < 0) { d = -d; bb = b.map((n) => -n); }
      if (d > 0.9995) return qNorm(a.map((n, i) => lerp(n, bb[i], t)));
      const theta = Math.acos(clamp(d, -1, 1));
      const sin = Math.sin(theta);
      const w1 = Math.sin((1 - t) * theta) / sin;
      const w2 = Math.sin(t * theta) / sin;
      return qNorm(a.map((n, i) => n * w1 + bb[i] * w2));
    };

    return class Dice {
      constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.q = qFromAxis([0.4, 0.7, 0.2], 0.7);
        this.state = 'idle';
        this.nat = null;
        this.onSettle = null;
        this.last = performance.now();
        this.aura = 0;
        this.W = 640;
        this.H = 500;
        this.resize();
        this.frame = this.frame.bind(this);
        this.raf = 0;
        this.running = false;
      }

      showFace(n) {
        const face = byNumber[n];
        if (face == null) return;
        const target = qMul(
          qFromAxis([0, 0, 1], rand(0, Math.PI * 2)),
          qFromUnitVectors(normals[face], [0, 0, 1])
        );
        this.q = target;
        this.nat = n;
        this.state = 'idle';
        this.draw();
      }

      resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = rect.width || 640;
        this.H = rect.height || 500;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
      }

      start() {
        if (this.running) return;
        this.running = true;
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.frame);
      }

      stop() {
        this.running = false;
        cancelAnimationFrame(this.raf);
      }

      roll(onSettle) {
        const nat = randInt(1, 20);
        const face = byNumber[nat];
        const targetDir = [0, 0, 1];
        const target = qMul(
          qFromAxis([0, 0, 1], rand(0, Math.PI * 2)),
          qFromUnitVectors(normals[face], targetDir)
        );
        this.nat = nat;
        this.onSettle = onSettle;
        this.fromQ = this.q.slice();
        this.targetQ = target;
        this.axis = norm([rand(-1, 1), rand(-1, 1), rand(-1, 1)]);
        this.speed = rand(9, 15);
        this.spinUntil = performance.now() + rand(820, 1120);
        this.state = 'spin';
        this.settleStart = 0;
        this.start();
        return nat;
      }

      frame(now) {
        if (!this.running) return;
        const dt = Math.min((now - this.last) / 1000, 0.05);
        this.last = now;
        this.aura += dt * 0.35;

        if (this.state === 'spin') {
          this.q = qNorm(qMul(qFromAxis(this.axis, this.speed * dt), this.q));
          if (now > this.spinUntil) {
            this.state = 'settle';
            this.settleStart = now;
            this.fromQ = this.q.slice();
          }
        } else if (this.state === 'settle') {
          const t = clamp((now - this.settleStart) / 640, 0, 1);
          this.q = qSlerp(this.fromQ, this.targetQ, easeOut(t));
          if (t >= 1) {
            this.state = 'idle';
            const cb = this.onSettle;
            this.onSettle = null;
            if (cb) cb(this.nat);
          }
        }

        this.draw();
        this.raf = requestAnimationFrame(this.frame);
      }

      draw() {
        const ctx = this.ctx;
        const W = this.W;
        const H = this.H;
        if (!ctx || !W || !H) return;

        ctx.clearRect(0, 0, W, H);

        // backdrop
        const bg = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.62);
        bg.addColorStop(0, 'rgba(240,161,109,0.10)');
        bg.addColorStop(0.55, 'rgba(80,35,16,0.06)');
        bg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const R = Math.min(W, H) * 0.31;
        const cX = W / 2;
        const cY = H / 2 - 2;

        // rotating aura
        ctx.save();
        ctx.translate(cX, cY);
        ctx.rotate(this.aura);
        ctx.strokeStyle = 'rgba(240,161,109,0.16)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 9]);
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(143,227,208,0.10)';
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.5, 0, Math.PI * 1.2);
        ctx.stroke();
        ctx.restore();

        // ground shadow
        const shadow = ctx.createRadialGradient(cX, H * 0.82, 6, cX, H * 0.82, R * 1.1);
        shadow.addColorStop(0, 'rgba(0,0,0,0.55)');
        shadow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shadow;
        ctx.save();
        ctx.translate(cX, H * 0.82);
        ctx.scale(1, 0.22);
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // transform vertices
        const view = verts.map((v) => qRotate(this.q, v));
        const project = (v) => {
          const persp = 1 / (1 + v[2] * 0.16);
          return [
            cX + v[0] * R * 1.55 * persp,
            cY - v[1] * R * 1.55 * persp,
            v[2],
          ];
        };
        const projected = view.map(project);

        const faceData = faces.map((f, i) => {
          const n = qRotate(this.q, normals[i]);
          const c = qRotate(this.q, centroids[i]);
          return { f, n, c, depth: c[2] };
        }).filter((fd) => fd.n[2] > 0.015).sort((a, b) => a.depth - b.depth);

        ctx.lineJoin = 'round';
        faceData.forEach((fd) => {
          const [a, b, c] = fd.f;
          const pa = projected[a];
          const pb = projected[b];
          const pc = projected[c];
          const shade = clamp((fd.n[2] + 0.2) * 0.9, 0, 1);

          ctx.beginPath();
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
          ctx.lineTo(pc[0], pc[1]);
          ctx.closePath();

          const g = ctx.createLinearGradient(pa[0], pa[1] - R * 0.4, pc[0], pc[1] + R * 0.4);
          g.addColorStop(0, `rgba(48,26,15,${0.85 + shade * 0.1})`);
          g.addColorStop(1, `rgba(14,7,4,${0.92 + shade * 0.05})`);
          ctx.fillStyle = g;
          ctx.fill();

          ctx.strokeStyle = `rgba(240,161,109,${0.22 + shade * 0.45})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // internal facets
          const cx2 = (pa[0] + pb[0] + pc[0]) / 3;
          const cy2 = (pa[1] + pb[1] + pc[1]) / 3;
          ctx.strokeStyle = `rgba(240,161,109,${0.06 + shade * 0.1})`;
          ctx.beginPath();
          ctx.moveTo(cx2, cy2);
          ctx.lineTo(pa[0], pa[1]);
          ctx.moveTo(cx2, cy2);
          ctx.lineTo(pb[0], pb[1]);
          ctx.moveTo(cx2, cy2);
          ctx.lineTo(pc[0], pc[1]);
          ctx.stroke();

          if (fd.n[2] > 0.42) {
            const num = faceNumber[faces.indexOf(fd.f)];
            if (num) {
              const dist = Math.max(
                Math.hypot(cx2 - pa[0], cy2 - pa[1]),
                Math.hypot(cx2 - pb[0], cy2 - pb[1]),
                Math.hypot(cx2 - pc[0], cy2 - pc[1])
              );
              const size = Math.max(10, Math.min(R * 0.21, dist * 0.52));
              ctx.font = `600 ${size.toFixed(1)}px Unbounded, JetBrains Mono, monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = `rgba(243,230,216,${0.55 + fd.n[2] * 0.45})`;
              ctx.fillText(String(num), cx2, cy2 + size * 0.04);
            }
          }
        });

        // glow rim
        ctx.strokeStyle = 'rgba(240,161,109,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cX, cY, R * 1.18, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
  })();

  /* ── dice dialog ─────────────────────────────────────────── */
  let dice = null;
  let currentRoll = { label: 'Проверка', bonus: 0 };
  let luckyUsed = false;
  let pendingNat = null;
  const diceDialog = $('#dice-dialog');
  const diceNatEl = $('#dice-nat');
  const diceTotalEl = $('#dice-total');
  const diceBreakdown = $('#dice-breakdown');
  const diceTargetEl = $('#dice-target');
  const luckyBtn = $('#dice-lucky');
  const rollBtn = $('#dice-roll');
  const logList = $('#dice-log-list');

  function initDice() {
    const canvas = $('#dice-canvas');
    if (!canvas || !diceDialog) return;
    dice = new D20(canvas);
    dice.showFace(20);

    canvas.addEventListener('click', () => {
      if (dice.state === 'idle' && !pendingNat) triggerDiceRoll();
    });

    if (rollBtn) {
      rollBtn.addEventListener('click', () => {
        if (pendingNat || (dice && dice.state !== 'idle')) return;
        triggerDiceRoll();
      });
    }

    if (luckyBtn) {
      luckyBtn.addEventListener('click', () => {
        if (luckyUsed || !currentRoll || dice.state !== 'idle') return;
        luckyUsed = true;
        luckyBtn.hidden = true;
        showToast('ВЕЗУЧИЙ · ПЕРЕБРОС d20', 'is-glass');
        Sound.tone(880, 0.1, 'triangle', 0.03);
        triggerDiceRoll(true);
      });
    }

    $$('[data-close-dialog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dlg = btn.closest('dialog');
        if (dlg) dlg.close();
      });
    });

    [diceDialog, $('#palette-dialog')].forEach((dlg) => {
      if (!dlg) return;
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
      });
    });

    diceDialog.addEventListener('close', () => {
      if (dice) { dice.stop(); dice.onSettle = null; }
      if (rollBtn) rollBtn.disabled = false;
    });

    diceDialog.addEventListener('cancel', () => {
      if (dice) dice.stop();
    });

    document.fonts?.ready.then(() => { if (dice) dice.draw(); });
  }

  function openDice(opts = {}) {
    if (!diceDialog) return;
    currentRoll = {
      label: opts.label || 'Проверка',
      bonus: Number(opts.bonus) || 0,
    };
    luckyUsed = false;
    pendingNat = null;

    if (diceTargetEl) diceTargetEl.textContent = currentRoll.label;
    if (diceNatEl) {
      diceNatEl.textContent = '';
      diceNatEl.className = 'dice-stage__nat';
    }
    if (diceTotalEl) diceTotalEl.textContent = currentRoll.bonus ? `МОДИФИКАТОР ${fmt(currentRoll.bonus)}` : 'БЕЗ МОДИФИКАТОРА';
    if (diceBreakdown) diceBreakdown.innerHTML = 'Кость готова. Нажмите <b>«БРОСИТЬ»</b>, чтобы узнать, на чьей стороне улица.';
    if (luckyBtn) luckyBtn.hidden = true;
    if (rollBtn) {
      rollBtn.disabled = false;
      rollBtn.querySelector('span').textContent = 'БРОСИТЬ';
    }

    if (!diceDialog.open) diceDialog.showModal();
    if (dice) {
      dice.onSettle = null;
      dice.state = 'idle';
      dice.resize();
      dice.start();
    }
  }

  function triggerDiceRoll(isLucky = false) {
    if (!dice) return;
    if (rollBtn) {
      rollBtn.disabled = true;
      rollBtn.querySelector('span').textContent = 'БРОСАЕМ…';
    }
    if (diceBreakdown) diceBreakdown.innerHTML = 'Кость вращается. Улица затаила дыхание.';
    if (diceNatEl) {
      diceNatEl.textContent = '…';
      diceNatEl.className = 'dice-stage__nat';
    }
    if (diceTotalEl) diceTotalEl.textContent = '';
    Sound.roll();
    dice.start();
    dice.roll((nat) => {
      finishRoll(nat, isLucky);
    });
  }

  function finishRoll(nat, isLucky) {
    pendingNat = nat;
    const total = nat + currentRoll.bonus;
    if (diceNatEl) {
      diceNatEl.textContent = String(nat);
      diceNatEl.className = 'dice-stage__nat' + (nat === 20 ? ' is-crit' : nat === 1 ? ' is-fail' : '');
    }
    if (diceTotalEl) {
      diceTotalEl.textContent = `ИТОГ ${total}${currentRoll.bonus ? ` · МОД. ${fmt(currentRoll.bonus)}` : ''}`;
    }
    if (diceBreakdown) {
      const verdict = nat === 20
        ? 'Критический успех. Даже стеклянный глаз доволен.'
        : nat === 1
          ? 'Критический провал. Судьба уже готовит переброс.'
          : total >= 15
            ? 'Уверенно. Улица любит наглых.'
            : total >= 10
              ? 'Проходит. Едва-едва, но проходит.'
              : 'Недостаточно. Где-то скрипнула половица.';
      diceBreakdown.innerHTML = `d20: <b>${nat}</b> · модификатор: <b>${fmt(currentRoll.bonus)}</b> · итог: <b>${total}</b><br>${verdict}`;
    }

    if (luckyBtn) luckyBtn.hidden = !(nat === 1 && !luckyUsed);
    if (rollBtn) {
      rollBtn.disabled = false;
      rollBtn.querySelector('span').textContent = 'БРОСИТЬ СНОВА';
    }

    if (nat === 20) { Sound.chime(); showToast(`КРИТ · ${currentRoll.label} · ${total}`, 'is-glass'); }
    else if (nat === 1) { Sound.fail(); showToast(`ПРОВАЛ · ${currentRoll.label} · ${total}`, 'is-blood'); }
    else { Sound.tone(420, 0.09, 'triangle', 0.03); }

    addLog(currentRoll.label, nat, total, isLucky);
    pendingNat = null;
  }

  function addLog(label, nat, total, isLucky) {
    if (!logList) return;
    const li = document.createElement('li');
    li.innerHTML = `<span>${label}${isLucky ? ' · везучий' : ''}</span><b>${nat} → ${total}</b>`;
    logList.prepend(li);
    while (logList.children.length > 6) logList.lastElementChild.remove();
  }

  function rollDamage(label, expr) {
    const m = /^(\d+)d(\d+)$/i.exec(expr.trim());
    if (!m) return;
    const count = clamp(parseInt(m[1], 10), 1, 20);
    const sides = clamp(parseInt(m[2], 10), 2, 100);
    const rolls = Array.from({ length: count }, () => randInt(1, sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    showToast(`${label} · ${total}`, 'is-blood');
    Sound.tone(300, 0.08, 'square', 0.02);
    Sound.tone(180, 0.16, 'sawtooth', 0.016, 0.06);
    if (diceBreakdown) {
      diceBreakdown.innerHTML = `<b>${label}</b> · ${expr}: ${rolls.join(' + ')} = <b>${total}</b>`;
    }
    if (logList) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${label}</span><b>${expr} → ${total}</b>`;
      logList.prepend(li);
      while (logList.children.length > 6) logList.lastElementChild.remove();
    }
  }

  function initRollButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-roll]');
      if (!btn) return;
      const kind = btn.dataset.roll;
      if (kind === 'damage') {
        rollDamage(btn.dataset.label || 'Урон', btn.dataset.dice || '1d6');
      } else {
        openDice({ label: btn.dataset.label || 'Проверка', bonus: Number(btn.dataset.bonus) || 0 });
      }
      Sound.click();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     HP · DEATH SAVES · SLOTS · REST
     ═══════════════════════════════════════════════════════════ */
  function renderHP() {
    const current = $('#hp-current');
    const maxEl = $('#hp-max');
    const fill = $('#hp-fill');
    const bar = $('#hp-bar');
    const status = $('#hp-status');
    const panel = $('#hp-panel');
    const hud = $('#hud-hp');

    if (current) current.textContent = String(state.hp);
    if (maxEl) maxEl.textContent = String(HP_MAX);
    if (fill) fill.style.width = `${(state.hp / HP_MAX) * 100}%`;
    if (bar) {
      bar.setAttribute('aria-valuenow', String(state.hp));
      bar.classList.toggle('is-low', state.hp <= Math.ceil(HP_MAX * 0.35));
    }
    if (hud) hud.textContent = `HP ${state.hp}/${HP_MAX}`;

    if (status) {
      status.classList.remove('is-hurt', 'is-critical', 'is-down');
      if (state.hp <= 0) {
        status.textContent = 'БЕЗ СОЗНАНИЯ';
        status.classList.add('is-down');
      } else if (state.hp <= 4) {
        status.textContent = 'КРИТИЧЕСКИ';
        status.classList.add('is-critical');
      } else if (state.hp < HP_MAX) {
        status.textContent = 'РАНЕН';
        status.classList.add('is-hurt');
      } else {
        status.textContent = 'СТАБИЛЕН';
      }
    }
    if (panel) {
      panel.classList.toggle('is-critical', state.hp <= 4 && state.hp > 0);
    }
  }

  function changeHP(delta) {
    if (!delta) return;
    const next = clamp(state.hp + delta, 0, HP_MAX);
    if (next === state.hp) return;
    const tookDamage = delta < 0;
    state.hp = next;
    saveState();
    renderHP();
    if (tookDamage) {
      Sound.hurt();
      const panel = $('#hp-panel');
      if (panel) {
        panel.classList.remove('is-critical');
        void panel.offsetWidth;
        panel.classList.add('is-critical');
        setTimeout(() => panel.classList.remove('is-critical'), 450);
      }
      showToast(`−${Math.abs(delta)} ХИТ · ОСТАЛОСЬ ${state.hp}`, 'is-blood');
    } else {
      Sound.tone(560, 0.1, 'sine', 0.025);
      showToast(`+${delta} ХИТ · ТЕПЕРЬ ${state.hp}`, 'is-glass');
    }
  }

  function renderDeath() {
    [['#death-success', state.death.s], ['#death-fail', state.death.f]].forEach(([sel, count]) => {
      const wrap = $(sel);
      if (!wrap) return;
      $$('button', wrap).forEach((btn, i) => btn.classList.toggle('is-on', i < count));
    });
  }

  function initDeath() {
    $$('#death-success button, #death-fail button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrap = btn.parentElement;
        const type = wrap.dataset.type;
        const index = Array.from(wrap.children).indexOf(btn) + 1;
        const key = type === 'success' ? 's' : 'f';
        state.death[key] = state.death[key] === index ? index - 1 : index;
        saveState();
        renderDeath();
        Sound.click();
      });
    });
  }

  function renderSlots() {
    const pips = $$('.slot-pip');
    const full = state.slots.filter(Boolean).length;
    pips.forEach((pip, i) => {
      pip.classList.toggle('is-full', !!state.slots[i]);
      pip.setAttribute('aria-label', `Ячейка ${i + 1}: ${state.slots[i] ? 'доступна' : 'потрачена'}`);
    });
    const count = $('#slots-count');
    if (count) count.textContent = `${full} / 2`;
    const hud = $('#hud-slots');
    if (hud) hud.textContent = `ЯЧЕЙКИ ${full}/2`;
  }

  function spendSlot() {
    const idx = state.slots.findIndex(Boolean);
    if (idx === -1) return false;
    state.slots[idx] = false;
    saveState();
    renderSlots();
    return true;
  }

  function restoreSlot() {
    const idx = state.slots.findIndex((v) => !v);
    if (idx === -1) return false;
    state.slots[idx] = true;
    saveState();
    renderSlots();
    return true;
  }

  function ringRender() {
    const btn = $('#ring-heal');
    const label = $('#ring-heal-label');
    if (!btn) return;
    btn.classList.toggle('is-used', state.ringUsed);
    if (label) label.textContent = state.ringUsed ? 'ИСПОЛЬЗОВАНО · ДО ОТДЫХА' : 'ИСПОЛЬЗОВАТЬ · 1d6';
  }

  function longRest() {
    const wasHp = state.hp;
    state.hp = HP_MAX;
    state.slots = [true, true];
    state.death = { s: 0, f: 0 };
    state.ringUsed = false;
    saveState();
    renderHP();
    renderSlots();
    renderDeath();
    ringRender();
    Sound.chime();
    showToast('ДОЛГИЙ ОТДЫХ · ХИТЫ, ЯЧЕЙКИ И КОЛЬЦО ВОССТАНОВЛЕНЫ', 'is-glass', 4200);
    const panel = $('#hp-panel');
    if (panel && wasHp < HP_MAX) {
      panel.animate(
        [{ boxShadow: '0 0 0 rgba(143,227,208,0)' }, { boxShadow: '0 0 60px rgba(143,227,208,0.25)' }, { boxShadow: '0 0 0 rgba(143,227,208,0)' }],
        { duration: 1200, easing: 'ease-out' }
      );
    }
  }

  function initHP() {
    $$('[data-hp]').forEach((btn) => {
      btn.addEventListener('click', () => changeHP(parseInt(btn.dataset.hp, 10)));
    });
    const restBtn = $('#long-rest');
    if (restBtn) restBtn.addEventListener('click', longRest);
    const arcaneRest = $('#arcane-rest');
    if (arcaneRest) arcaneRest.addEventListener('click', longRest);
    renderHP();
    renderDeath();
    renderSlots();
    ringRender();
  }

  /* ═══════════════════════════════════════════════════════════
     SPELLS
     ═══════════════════════════════════════════════════════════ */
  function initSpells() {
    $$('.spell__head').forEach((head) => {
      head.addEventListener('click', () => {
        const card = head.closest('.spell');
        const open = card.classList.toggle('is-open');
        head.setAttribute('aria-expanded', String(open));
        Sound.click();
      });
    });

    $$('.spell__cast').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const level = Number(btn.dataset.level) || 0;
        const name = btn.dataset.spell || 'Заклинание';
        if (level > 0) {
          if (!state.slots.some(Boolean)) {
            showToast('НЕТ ЯЧЕЕК · НУЖЕН ДОЛГИЙ ОТДЫХ', 'is-blood');
            Sound.fail();
            return;
          }
          spendSlot();
          showToast(`${name} · ЯЧЕЙКА ПОТРАЧЕНА · ${state.slots.filter(Boolean).length}/2`, 'is-glass');
        } else {
          showToast(`${name} · ЗАГОВОР · БЕСПЛАТНО`, 'is-glass');
        }
        const card = btn.closest('.spell');
        if (card) {
          card.classList.remove('is-casting');
          void card.offsetWidth;
          card.classList.add('is-casting');
          setTimeout(() => card.classList.remove('is-casting'), 800);
        }
        const circle = $('.spell-circle');
        if (circle) {
          circle.animate(
            [{ filter: 'drop-shadow(0 0 0 rgba(143,227,208,0))' }, { filter: 'drop-shadow(0 0 26px rgba(143,227,208,0.5))' }, { filter: 'drop-shadow(0 0 0 rgba(143,227,208,0))' }],
            { duration: 900, easing: 'ease-out' }
          );
        }
        Sound.chime();
      });
    });

    $$('.slot-pip').forEach((pip) => {
      pip.addEventListener('click', () => {
        const i = Number(pip.dataset.slot) - 1;
        if (state.slots[i]) {
          state.slots[i] = false;
          showToast(`ЯЧЕЙКА ${i + 1} ПОТРАЧЕНА`, 'is-glass');
        } else {
          state.slots[i] = true;
          showToast(`ЯЧЕЙКА ${i + 1} ВОССТАНОВЛЕНА`, 'is-glass');
        }
        saveState();
        renderSlots();
        Sound.click();
      });
    });

    const ringBtn = $('#ring-heal');
    if (ringBtn) {
      ringBtn.addEventListener('click', () => {
        if (state.ringUsed) {
          showToast('КОЛЬЦО ИССЯКЛО · НУЖЕН МАЛЫЙ ОТДЫХ', 'is-blood');
          Sound.fail();
          return;
        }
        const heal = randInt(1, 6);
        state.ringUsed = true;
        state.hp = clamp(state.hp + heal, 0, HP_MAX);
        saveState();
        renderHP();
        ringRender();
        Sound.chime();
        showToast(`КОЛЬЦО ЛЕЧЕНИЯ · +${heal} ХИТ`, 'is-glass');
        const relic = ringBtn.closest('.relic');
        if (relic) relic.animate(
          [{ boxShadow: '0 0 0 rgba(143,227,208,0)' }, { boxShadow: '0 0 40px rgba(143,227,208,0.3)' }, { boxShadow: '0 0 0 rgba(143,227,208,0)' }],
          { duration: 1000, easing: 'ease-out' }
        );
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     GLASS EYE
     ═══════════════════════════════════════════════════════════ */
  const EYE_PHRASES = [
    'СТЕКЛЯННЫЙ ГЛАЗ МОРГНУЛ. ПЕРВЫМ.',
    'В ОТРАЖЕНИИ — ПЕРЕУЛОК, КОТОРОГО НЕТ НА КАРТЕ.',
    'КТО-ТО ПРОИЗНЁС ТВОЁ ИМЯ. ШЁПОТОМ. ИЗ-ПОД ПОЛА.',
    'ЛУЧШЕ НЕ СМОТРЕТЬ. НО ОН СМОТРИТ.',
    'ГДЕ-ТО В ГОРОДЕ ОТКРЫЛАСЬ ДВЕРЬ. ЭТО НЕ К ТЕБЕ.',
    'ОПТИКА В ПОРЯДКЕ. ВЛАДЕЛЕЦ — НЕ ОЧЕНЬ.',
  ];

  function initEye() {
    const canvas = $('#eye-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const card = $('#eye-card');
    const hint = $('#eye-hint');
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Стеклянный глаз — нажмите, чтобы заглянуть');
    if (!FINE && hint) hint.textContent = 'КОСНИТЕСЬ · НАЖМИТЕ';

    let W = 0;
    let H = 0;
    let dpr = 1;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const target = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    let pointerActive = false;
    let blinkStart = -1;
    let nextBlink = performance.now() + 4200;
    let flash = 0;
    let touched = false;

    const particles = Array.from({ length: 34 }, () => ({
      x: Math.random(),
      y: Math.random(),
      s: rand(0.35, 1.2),
      v: rand(0.01, 0.05),
      a: rand(0.08, 0.35),
    }));

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(now) {
      if (!W || !H) return;
      const cx = W * 0.5;
      const cy = H * 0.5;
      const aw = Math.min(W * 0.355, H * 0.82);
      const ah = aw * 0.39;

      blinkStart = blinkStart < 0 && now > nextBlink ? now : blinkStart;
      let blink = 0;
      if (blinkStart >= 0) {
        const bp = (now - blinkStart) / 210;
        if (bp >= 1) {
          blinkStart = -1;
          nextBlink = now + rand(3600, 7200);
        } else {
          blink = Math.sin(bp * Math.PI);
        }
      }
      flash = Math.max(0, flash - 0.02);

      if (pointerActive) {
        look.x = lerp(look.x, target.x, 0.07);
        look.y = lerp(look.y, target.y, 0.07);
      } else {
        look.x = lerp(look.x, Math.sin(now / 2600) * 0.24, 0.02);
        look.y = lerp(look.y, Math.cos(now / 3100) * 0.18, 0.02);
      }

      // background
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.7);
      bg.addColorStop(0, '#0d0a07');
      bg.addColorStop(0.55, '#080504');
      bg.addColorStop(1, '#050302');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // grid
      ctx.strokeStyle = 'rgba(143,227,208,0.035)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 44) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 44) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // dust
      particles.forEach((p) => {
        p.y -= p.v * 0.01;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        ctx.fillStyle = `rgba(143,227,208,${p.a * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.s, 0, Math.PI * 2);
        ctx.fill();
      });

      // glow behind eye
      const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, aw * 1.2);
      halo.addColorStop(0, 'rgba(143,227,208,0.12)');
      halo.addColorStop(0.6, 'rgba(143,227,208,0.03)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, Math.max(0.02, 1 - blink * 0.97));
      ctx.translate(-cx, -cy);

      const eyePath = () => {
        ctx.beginPath();
        ctx.moveTo(cx - aw, cy);
        ctx.bezierCurveTo(cx - aw * 0.55, cy - ah * 1.55, cx + aw * 0.55, cy - ah * 1.55, cx + aw, cy);
        ctx.bezierCurveTo(cx + aw * 0.55, cy + ah * 1.38, cx - aw * 0.55, cy + ah * 1.38, cx - aw, cy);
        ctx.closePath();
      };

      // sclera
      eyePath();
      const sclera = ctx.createLinearGradient(0, cy - ah * 1.4, 0, cy + ah * 1.3);
      sclera.addColorStop(0, '#dceee8');
      sclera.addColorStop(0.42, '#a9c7bf');
      sclera.addColorStop(0.72, '#6d8c84');
      sclera.addColorStop(1, '#40564f');
      ctx.fillStyle = sclera;
      ctx.shadowColor = 'rgba(143,227,208,0.5)';
      ctx.shadowBlur = 30;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(240,161,109,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      eyePath();
      ctx.clip();

      // iris
      const ix = cx + look.x * aw * 0.17;
      const iy = cy + look.y * ah * 0.2;
      const ir = Math.min(ah * 0.92, aw * 0.27);

      const iris = ctx.createRadialGradient(ix, iy, ir * 0.1, ix, iy, ir);
      iris.addColorStop(0, '#effffb');
      iris.addColorStop(0.22, '#b9f6ea');
      iris.addColorStop(0.48, '#5fc3b1');
      iris.addColorStop(0.72, '#2a6b60');
      iris.addColorStop(0.92, '#123a33');
      iris.addColorStop(1, '#071d19');
      ctx.beginPath();
      ctx.arc(ix, iy, ir, 0, Math.PI * 2);
      ctx.fillStyle = iris;
      ctx.fill();

      // striations
      const spin = now / 12000;
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(spin);
      for (let i = 0; i < 54; i += 1) {
        const a = (i / 54) * Math.PI * 2;
        const r1 = ir * 0.32;
        const r2 = ir * (0.72 + 0.26 * Math.abs(Math.sin(i * 12.9898)));
        ctx.strokeStyle = i % 5 === 0 ? 'rgba(240,161,109,0.3)' : 'rgba(7,29,25,0.42)';
        ctx.lineWidth = i % 7 === 0 ? 1.4 : 0.7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // pupil
      const pupil = ir * 0.4 + Math.sin(now / 900) * ir * 0.015;
      const pupilGrad = ctx.createRadialGradient(ix, iy, 1, ix, iy, pupil);
      pupilGrad.addColorStop(0, '#000000');
      pupilGrad.addColorStop(0.75, '#040807');
      pupilGrad.addColorStop(1, 'rgba(4,8,7,0.65)');
      ctx.beginPath();
      ctx.arc(ix, iy, pupil, 0, Math.PI * 2);
      ctx.fillStyle = pupilGrad;
      ctx.fill();

      // iris rim
      ctx.beginPath();
      ctx.arc(ix, iy, ir, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,161,109,0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // glints
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.ellipse(ix - ir * 0.32, iy - ir * 0.36, ir * 0.22, ir * 0.12, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(ix + ir * 0.28, iy + ir * 0.3, ir * 0.07, 0, Math.PI * 2);
      ctx.fill();

      // glass bands
      const band = ctx.createLinearGradient(cx - aw, cy - ah, cx + aw, cy + ah);
      band.addColorStop(0.2, 'rgba(255,255,255,0)');
      band.addColorStop(0.44, 'rgba(255,255,255,0.2)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      band.addColorStop(0.7, 'rgba(255,255,255,0.12)');
      band.addColorStop(0.78, 'rgba(255,255,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(cx - aw, cy - ah * 1.6, aw * 2, ah * 3.2);

      // veins
      ctx.strokeStyle = 'rgba(226,1,1,0.22)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i += 1) {
        const sx = cx - aw * (0.7 + i * 0.05);
        const sy = cy + ah * (0.1 - i * 0.09);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + aw * 0.22, sy - ah * 0.2, sx + aw * 0.34, sy + ah * 0.08);
        ctx.stroke();
      }

      // shadow under upper lid
      const lid = ctx.createLinearGradient(0, cy - ah * 1.5, 0, cy - ah * 0.05);
      lid.addColorStop(0, 'rgba(5,3,2,0.95)');
      lid.addColorStop(0.55, 'rgba(5,3,2,0.55)');
      lid.addColorStop(1, 'rgba(5,3,2,0)');
      ctx.fillStyle = lid;
      ctx.fillRect(cx - aw, cy - ah * 1.6, aw * 2, ah * 1.55);

      ctx.restore();

      // eyelids
      ctx.beginPath();
      ctx.moveTo(cx - aw, cy);
      ctx.bezierCurveTo(cx - aw * 0.55, cy - ah * 1.55, cx + aw * 0.55, cy - ah * 1.55, cx + aw, cy);
      ctx.strokeStyle = 'rgba(5,3,2,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // outer lashes / rim
      ctx.beginPath();
      ctx.moveTo(cx - aw, cy);
      ctx.bezierCurveTo(cx - aw * 0.55, cy - ah * 1.62, cx + aw * 0.55, cy - ah * 1.62, cx + aw, cy);
      ctx.strokeStyle = 'rgba(240,161,109,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();

      // blink line
      if (blink > 0.35) {
        ctx.strokeStyle = `rgba(240,161,109,${blink * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - aw * 0.95, cy);
        ctx.lineTo(cx + aw * 0.95, cy);
        ctx.stroke();
      }

      // reticle corners
      ctx.strokeStyle = 'rgba(143,227,208,0.35)';
      ctx.lineWidth = 1;
      const m = 26;
      const len = 14;
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + sy * len);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sx * len, y);
        ctx.stroke();
      });

      // readout
      ctx.fillStyle = 'rgba(143,227,208,0.5)';
      ctx.font = '500 7px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('OPTIC // GLASS', m + 8, m + 4);
      ctx.textAlign = 'right';
      ctx.fillText(touched ? 'LINK: ACTIVE' : 'LINK: DORMANT', W - m - 8, m + 4);

      if (flash > 0) {
        ctx.fillStyle = `rgba(220,255,248,${flash * 0.22})`;
        ctx.fillRect(0, 0, W, H);
      }

      // scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    }

    function loop(now) {
      if (!visible) { raf = 0; return; }
      const interval = 1000 / (REDUCED ? 12 : window.innerWidth < 700 ? 30 : 48);
      if (now - last >= interval) {
        draw(now);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    }

    function engage(e) {
      const r = canvas.getBoundingClientRect();
      target.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      target.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      pointerActive = true;
    }

    card.addEventListener('pointermove', engage);
    card.addEventListener('pointerleave', () => {
      pointerActive = false;
      target.x = 0;
      target.y = 0;
    });
    function peek(e) {
      if (e && typeof e.clientX === 'number') engage(e);
      flash = 1;
      blinkStart = performance.now();
      touched = true;
      card.classList.add('is-touched');
      Sound.tone(rand(700, 1200), 0.12, 'sine', 0.02);
      showToast(pick(EYE_PHRASES), 'is-glass', 4200);
      if (hint) hint.style.opacity = '0';
    }
    canvas.addEventListener('click', peek);
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        peek();
      }
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        visible = entry.isIntersecting;
        if (visible && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(loop);
        }
      });
    }, { threshold: 0.05 });
    io.observe(canvas);

    window.addEventListener('resize', () => {
      resize();
      draw(performance.now());
    });

    resize();
    draw(performance.now());
    raf = requestAnimationFrame(loop);
  }

  /* ═══════════════════════════════════════════════════════════
     COMMAND PALETTE
     ═══════════════════════════════════════════════════════════ */
  const paletteDialog = $('#palette-dialog');
  const paletteInput = $('#palette-input');
  const paletteList = $('#palette-list');
  let paletteItems = [];
  let paletteIndex = 0;

  function buildPaletteItems() {
    const sections = [
      ['Досье', '#dossier'], ['Ядро', '#core'], ['Матрица навыков', '#skills'],
      ['Арсенал', '#arsenal'], ['Магия', '#arcane'], ['Реликвии', '#relics'],
      ['Личное дело', '#psyche'], ['Финал', '#end'],
    ].map(([label, href]) => ({ label, kind: 'РАЗДЕЛ', action: () => goTo(href) }));

    const skills = SKILLS.map((s) => ({
      label: `${s.ru} ${fmt(s.bonus)}`,
      kind: 'НАВЫК',
      action: () => openDice({ label: s.ru, bonus: s.bonus }),
    }));

    const spells = [
      ['Волшебная рука', 0], ['Малая иллюзия', 0], ['Луч холода', 0],
      ['Скрытая магия', 1], ['Усыпление', 1], ['Щит', 1],
    ].map(([label, lvl]) => ({
      label,
      kind: lvl ? 'ЗАКЛИНАНИЕ' : 'ЗАГОВОР',
      action: () => {
        goTo('#arcane');
        const card = $$('.spell').find((c) => c.querySelector('.spell__name')?.textContent.includes(label));
        if (card) { card.classList.add('is-open'); card.querySelector('.spell__head')?.setAttribute('aria-expanded', 'true'); }
      },
    }));

    const actions = [
      { label: 'Бросить d20', kind: 'ДЕЙСТВИЕ', action: () => openDice({ label: 'Проверка удачи', bonus: 0 }) },
      { label: 'Долгий отдых', kind: 'ДЕЙСТВИЕ', action: longRest },
      { label: 'Скрытая атака 2d6', kind: 'БРОСОК', action: () => rollDamage('Скрытая атака', '2d6') },
      { label: 'Включить / выключить звук', kind: 'ДЕЙСТВИЕ', action: () => toggleSound() },
      { label: 'Печать досье', kind: 'ДЕЙСТВИЕ', action: () => window.print() },
      { label: 'Перезапустить загрузку', kind: 'ДЕЙСТВИЕ', action: () => replayBoot() },
    ];

    paletteItems = [...sections, ...skills, ...spells, ...actions];
  }

  function goTo(hash) {
    const el = document.querySelector(hash);
    if (!el) return;
    if (paletteDialog?.open) paletteDialog.close();
    el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPalette(query = '') {
    if (!paletteList) return;
    const q = query.trim().toLowerCase();
    const filtered = paletteItems.filter((it) => it.label.toLowerCase().includes(q));
    paletteIndex = 0;
    if (!filtered.length) {
      paletteList.innerHTML = '<li class="palette__empty">Ничего не найдено. Даже вор иногда промахивается.</li>';
      return;
    }
    paletteList.innerHTML = filtered.map((it, i) => `
      <li><button type="button" class="palette__item${i === 0 ? ' is-sel' : ''}" data-index="${i}">
        <span>${it.label}</span><span class="palette__kind">${it.kind}</span>
      </button></li>`).join('');
    paletteList.dataset.filtered = '1';
    paletteItems._filtered = filtered;
  }

  function selectPalette(dir) {
    if (!paletteList) return;
    const buttons = $$('.palette__item', paletteList);
    if (!buttons.length) return;
    paletteIndex = (paletteIndex + dir + buttons.length) % buttons.length;
    buttons.forEach((b, i) => b.classList.toggle('is-sel', i === paletteIndex));
    buttons[paletteIndex].scrollIntoView({ block: 'nearest' });
  }

  function runPaletteIndex(i) {
    const filtered = paletteItems._filtered || [];
    const item = filtered[i];
    if (!item) return;
    if (paletteDialog?.open) paletteDialog.close();
    setTimeout(() => item.action(), 120);
  }

  function initPalette() {
    if (!paletteDialog || !paletteInput || !paletteList) return;
    buildPaletteItems();

    const openBtn = $('#palette-open');
    if (openBtn) openBtn.addEventListener('click', openPalette);

    paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPaletteIndex(paletteIndex); }
    });

    paletteList.addEventListener('click', (e) => {
      const btn = e.target.closest('.palette__item');
      if (!btn) return;
      runPaletteIndex(Number(btn.dataset.index));
    });

    paletteDialog.addEventListener('close', () => {
      if (paletteInput) paletteInput.value = '';
    });
  }

  function openPalette() {
    if (!paletteDialog) return;
    renderPalette('');
    if (!paletteDialog.open) paletteDialog.showModal();
    setTimeout(() => paletteInput?.focus(), 60);
  }

  /* ═══════════════════════════════════════════════════════════
     SOUND TOGGLE · MISC
     ═══════════════════════════════════════════════════════════ */
  function toggleSound() {
    const btn = $('#sound-toggle');
    const use = btn?.querySelector('use');
    state.sound = !state.sound;
    saveState();
    Sound.enable(state.sound);
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.sound));
      btn.setAttribute('aria-label', state.sound ? 'Выключить звук' : 'Включить звук');
    }
    if (use) use.setAttribute('href', state.sound ? '#i-sound' : '#i-mute');
    showToast(state.sound ? 'ЗВУК ВКЛЮЧЁН' : 'ЗВУК ВЫКЛЮЧЕН', state.sound ? 'is-glass' : '');
    if (state.sound) Sound.chime();
  }

  function initSound() {
    Sound.on = state.sound;
    Sound.init();
    const btn = $('#sound-toggle');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(state.sound));
    btn.setAttribute('aria-label', state.sound ? 'Выключить звук' : 'Включить звук');
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', state.sound ? '#i-sound' : '#i-mute');
    btn.addEventListener('click', toggleSound);

    // resume audio after any first gesture if the user enabled sound previously
    const resume = () => {
      if (state.sound) Sound.enable(true);
      window.removeEventListener('pointerdown', resume);
    };
    window.addEventListener('pointerdown', resume);
  }

  function replayBoot() {
    if (paletteDialog?.open) paletteDialog.close();
    if (diceDialog?.open) diceDialog.close();
    window.scrollTo({ top: 0, behavior: 'auto' });
    revealsStarted = false;
    runBoot(false);
  }

  function initPrint() {
    const openAll = () => {
      printMode = true;
      $$('[data-scramble]').forEach((el) => { if (el.dataset.final) el.textContent = el.dataset.final; });
      $$('.fact__num').forEach((el) => { if (el.dataset.count) el.textContent = el.dataset.count; });
      $$('.feature').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : '0'; d.open = true; });
      $$('.spell').forEach((sp) => { sp.dataset.wasOpen = sp.classList.contains('is-open') ? '1' : '0'; sp.classList.add('is-open'); });
    };
    const restore = () => {
      printMode = false;
      $$('.feature').forEach((d) => { d.open = d.dataset.wasOpen === '1'; });
      $$('.spell').forEach((sp) => { if (sp.dataset.wasOpen !== '1') sp.classList.remove('is-open'); });
    };
    window.addEventListener('beforeprint', openAll);
    window.addEventListener('afterprint', restore);
  }

  function initMisc() {
    const printBtn = $('#print-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    const replay = $('#replay-boot');
    if (replay) replay.addEventListener('click', replayBoot);
    const skip = $('#boot-skip');
    if (skip) skip.addEventListener('click', finishBoot);

    const heroDice = $('#hud-dice');
    if (heroDice) heroDice.addEventListener('click', () => openDice({ label: 'Проверка удачи', bonus: 0 }));

    document.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        $('#skill-search')?.focus();
      } else if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey) {
        openDice({ label: 'Проверка удачи', bonus: 0 });
      } else if (e.key === 'Escape') {
        if (paletteDialog?.open) paletteDialog.close();
        if (diceDialog?.open) diceDialog.close();
      }
    });
  }

  function initScroll() {
    const nav = $('#hud-progress');
    const railProgress = $('#rail-progress');
    const hud = $('#hud');
    const sections = $$('main section[id]');
    const railLinks = $$('.rail__list a');
    let ticking = false;

    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      if (nav) nav.style.width = `${p * 100}%`;
      if (railProgress) railProgress.style.height = `${p * 100}%`;
      if (hud) hud.classList.toggle('is-scrolled', window.scrollY > 40);

      const marker = window.scrollY + window.innerHeight * 0.38;
      let active = '';
      sections.forEach((sec) => {
        if (sec.offsetTop <= marker) active = sec.id;
      });
      railLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.section === active));
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ═══════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════ */
  function init() {
    splitLetters();
    initShader();
    initBootClock();
    initCursor();
    initLens();
    initTilt();
    renderSkills();
    initSkillSearch();
    initRadar();
    initHP();
    initSpells();
    initDice();
    initEye();
    initDeath();
    initPalette();
    initSound();
    initMisc();
    initPrint();
    initScroll();
    initRollButtons();
    applySkillFilters();

    if (REDUCED) {
      // no boot ceremony for reduced motion
      if (boot) {
        boot.classList.add('boot--done');
        boot.inert = true;
      }
      document.body.classList.remove('is-locked');
      document.body.classList.add('is-booted');
      if (!revealsStarted) { revealsStarted = true; initReveals(); }
    } else {
      runBoot();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
