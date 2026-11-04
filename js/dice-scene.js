/* ═══════════════════════════════════════════════════════════════
   СЭМИАМ НЭПСЭК · АРХИВ 003 — scroll-driven 3D dice chamber
   WebGL2 · deterministic rigid-body timeline · cinematic post FX
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const canvas = document.getElementById('scene-canvas');
  const hero = document.getElementById('hero');
  if (!canvas || !hero) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.matchMedia('(max-width: 860px)').matches;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    hero.classList.add('no-scene');
    return;
  }

  function startScene() {

  /* ── math ─────────────────────────────────────────────────── */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vCross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
  const vNorm = (a) => {
    const l = vLen(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

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
    const a = vNorm(axis);
    const s = Math.sin(angle / 2);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
  };
  const qRotate = (q, v) => {
    const u = [q[0], q[1], q[2]];
    const w = q[3];
    const uv = vCross(u, v);
    const uuv = vCross(u, uv);
    return vAdd(v, vAdd(vScale(uv, 2 * w), vScale(uuv, 2)));
  };
  const qSlerp = (a, b, t) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = b.map((n) => -n); }
    if (d > 0.9995) return qNorm(a.map((n, i) => mix(n, bb[i], t)));
    const theta = Math.acos(clamp(d, -1, 1));
    const sin = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / sin;
    const w2 = Math.sin(t * theta) / sin;
    return qNorm(a.map((n, i) => n * w1 + bb[i] * w2));
  };
  const qFromMat3 = (m) => {
    const m00 = m[0], m10 = m[1], m20 = m[2];
    const m01 = m[3], m11 = m[4], m21 = m[5];
    const m02 = m[6], m12 = m[7], m22 = m[8];
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
    }
    return qNorm(q);
  };

  const m4Identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const m4Perspective = (fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  };
  const m4LookAt = (eye, center, up) => {
    const z = vNorm(vSub(eye, center));
    const x = vNorm(vCross(up, z));
    const y = vCross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -vDot(x, eye), -vDot(y, eye), -vDot(z, eye), 1,
    ]);
  };
  const m4Multiply = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  };
  const m4FromQuatPosScale = (q, p, s) => {
    const [x, y, z, w] = q;
    const sx = Array.isArray(s) ? s[0] : s;
    const sy = Array.isArray(s) ? s[1] : s;
    const sz = Array.isArray(s) ? s[2] : s;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      p[0], p[1], p[2], 1,
    ]);
  };
  const m3FromQuat = (q) => {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([
      1 - (yy + zz), xy + wz, xz - wy,
      xy - wz, 1 - (xx + zz), yz + wx,
      xz + wy, yz - wx, 1 - (xx + yy),
    ]);
  };

  function qFaceCamera(face, camPos, diePos) {
    const camDir = vNorm(vSub(camPos, diePos));
    let upW = vSub([0, 1, 0], vScale(camDir, vDot([0, 1, 0], camDir)));
    if (vLen(upW) < 0.001) upW = [0, 0, 1];
    upW = vNorm(upW);
    const lZ = vNorm(face.n);
    const lY = vNorm(vSub(face.up, vScale(lZ, vDot(face.up, lZ))));
    const lX = vCross(lY, lZ);
    const tZ = camDir;
    const tY = upW;
    const tX = vCross(tY, tZ);
    // R = T * L^T
    const r = [
      lX[0] * tX[0] + lY[0] * tY[0] + lZ[0] * tZ[0],
      lX[0] * tX[1] + lY[0] * tY[1] + lZ[0] * tZ[1],
      lX[0] * tX[2] + lY[0] * tY[2] + lZ[0] * tZ[2],
      lX[1] * tX[0] + lY[1] * tY[0] + lZ[1] * tZ[0],
      lX[1] * tX[1] + lY[1] * tY[1] + lZ[1] * tZ[1],
      lX[1] * tX[2] + lY[1] * tY[2] + lZ[1] * tZ[2],
      lX[2] * tX[0] + lY[2] * tY[0] + lZ[2] * tZ[0],
      lX[2] * tX[1] + lY[2] * tY[1] + lZ[2] * tZ[1],
      lX[2] * tX[2] + lY[2] * tY[2] + lZ[2] * tZ[2],
    ];
    return qFromMat3(r);
  }

  let rngState = 0x1a2b3c4d;
  const rnd = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
  };

  /* ── dice geometry ────────────────────────────────────────── */
  const PHI = (1 + Math.sqrt(5)) / 2;
  const DICE_DEFS = {
    d20: {
      verts: [
        [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
        [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
        [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
      ],
      faces: [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
      ],
      oppositeSum: 21,
      scale: 1.05,
      mass: 1,
      base: [0.13, 0.072, 0.032],
      accent: [1.0, 0.52, 0.22],
      numberColor: [1.0, 0.86, 0.66],
      aura: [1.0, 0.45, 0.16],
      finalNumber: 20,
      start: [1.2, 5.0, 1.4],
      vel: [0.2, -3.4, -0.15],
      spin: [2.4, 3.2, 1.1],
    },
    d8: {
      verts: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],
      faces: [
        [0,2,4],[2,1,4],[1,3,4],[3,0,4],
        [2,0,5],[1,2,5],[3,1,5],[0,3,5],
      ],
      oppositeSum: 9,
      scale: 0.93,
      mass: 0.85,
      base: [0.015, 0.075, 0.068],
      accent: [0.2, 0.85, 0.72],
      numberColor: [0.72, 1.0, 0.93],
      aura: [0.18, 0.78, 0.68],
      finalNumber: 8,
      start: [-1.0, 8.0, 0.4],
      vel: [0.35, -2.6, 0.1],
      spin: [-3.1, 2.2, 3.4],
    },
    d4: {
      verts: [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
      faces: [[0,1,2],[0,3,1],[0,2,3],[1,3,2]],
      oppositeSum: 0,
      scale: 0.86,
      mass: 0.7,
      base: [0.15, 0.014, 0.009],
      accent: [1.0, 0.18, 0.08],
      numberColor: [1.0, 0.78, 0.5],
      aura: [1.0, 0.16, 0.08],
      finalNumber: 4,
      start: [2.0, 11.0, -0.6],
      vel: [-0.2, -1.8, 0.1],
      spin: [4.2, -2.7, 2.2],
    },
  };

  const vNormals = (arr) => arr.map(vNorm);
  const vSub3 = vSub;
  const vAdd3 = vAdd;

  function prepareDie(def) {
    const verts = vNormals(def.verts);
    const centers = [];
    const rawFaces = def.faces.map((f) => {
      let [a, b, c] = f;
      let va = verts[a], vb = verts[b], vc = verts[c];
      let n = vNorm(vCross(vSub3(vb, va), vSub3(vc, va)));
      const cen = vScale(vAdd3(vAdd3(va, vb), vc), 1 / 3);
      if (vDot(n, cen) < 0) {
        [b, c] = [c, b];
        [vb, vc] = [vc, vb];
        n = vScale(n, -1);
      }
      const centroid = vScale(vAdd3(vAdd3(va, vb), vc), 1 / 3);
      const up = vNorm(vSub3(va, centroid));
      centers.push(centroid);
      return { v: [va, vb, vc], n, centroid, up };
    });

    // numbers so opposite faces sum to <oppositeSum>
    const opposite = centers.map((c, i) => {
      let best = -1;
      let bestDot = Infinity;
      centers.forEach((d, j) => {
        if (i === j) return;
        const dot = vDot(c, d);
        if (dot < bestDot) { bestDot = dot; best = j; }
      });
      return best;
    });
    const nums = new Array(rawFaces.length).fill(0);
    if (!def.oppositeSum) {
      rawFaces.forEach((f, i) => { nums[i] = i + 1; });
    } else {
      const used = new Set();
      for (let i = 0; i < rawFaces.length; i += 1) {
        if (nums[i]) continue;
        let a = 1;
        while (used.has(a) || used.has(def.oppositeSum - a) || a >= def.oppositeSum - a) a += 1;
        const b = def.oppositeSum - a;
        nums[i] = a;
        if (opposite[i] >= 0) nums[opposite[i]] = b;
        used.add(a);
        used.add(b);
        if (a === b) used.add(b);
      }
    }
    rawFaces.forEach((f, i) => { f.num = nums[i] || i + 1; });
    const unitVerts = def.verts.map(vNorm);
    return { ...def, faces: rawFaces, unitVerts };
  }

  const DICE = [prepareDie(DICE_DEFS.d20), prepareDie(DICE_DEFS.d8), prepareDie(DICE_DEFS.d4)];

  /* ── number atlas ─────────────────────────────────────────── */
  const ATLAS_CELL = 256;
  function atlasLayout(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return { cols, rows, w: cols * ATLAS_CELL, h: rows * ATLAS_CELL };
  }
  function makeAtlasCanvas(die) {
    const { cols, rows, w, h } = atlasLayout(die.faces.length);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const cell = ATLAS_CELL;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    die.faces.forEach((face, i) => {
      const cx = (i % cols) * cell;
      const cy = Math.floor(i / cols) * cell;
      const num = String(face.num);
      const px = cx + cell * 0.5;
      const py = cy + cell * 0.615;
      const size = Math.round(cell * (num.length > 1 ? 0.31 : 0.37));
      ctx.save();
      ctx.font = `700 ${size}px Unbounded, "JetBrains Mono", monospace`;
      ctx.shadowColor = `rgba(${Math.round(die.accent[0]*255)},${Math.round(die.accent[1]*255)},${Math.round(die.accent[2]*255)},0.55)`;
      ctx.shadowBlur = cell * 0.035;
      ctx.fillStyle = 'rgba(255,242,224,0.98)';
      ctx.fillText(num, px, py);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff8ee';
      ctx.fillText(num, px, py);
      ctx.restore();
    });
    return { cv, cols, rows };
  }
  function buildDieGeometry(die, cols, rows) {
    const pos = [];
    const nor = [];
    const uvs = [];
    const bary = [];
    const cell = 1 / cols;
    const rowH = 1 / rows;
    die.faces.forEach((face, i) => {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      const points = [
        [(cx + 0.5) * cell, 1 - (cy + 0.10) * rowH],
        [(cx + 0.10) * cell, 1 - (cy + 0.90) * rowH],
        [(cx + 0.90) * cell, 1 - (cy + 0.90) * rowH],
      ];
      for (let k = 0; k < 3; k += 1) {
        const v = face.v[k];
        pos.push(v[0], v[1], v[2]);
        nor.push(face.n[0], face.n[1], face.n[2]);
        uvs.push(points[k][0], points[k][1]);
        bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      }
    });
    return {
      pos: new Float32Array(pos),
      nor: new Float32Array(nor),
      uv: new Float32Array(uvs),
      bary: new Float32Array(bary),
      count: die.faces.length * 3,
    };
  }

  /* ── deterministic physics timeline ───────────────────────── */
  const SIM_HZ = 120;
  const SIM_TIME = 10.4;
  const N = Math.round(SIM_TIME * SIM_HZ) + 1;
  const FINAL_CAM = [0, 2.9, 11.2];
  const FINAL_TARGET = [0, 2.15, -0.2];
  const FINAL_POS = [
    [-2.25, 2.15, 1.15],
    [0.15, 2.85, -1.05],
    [2.45, 1.9, 0.85],
  ];
  const TWEEN_START = 7.35;
  const TWEEN_END = 9.6;

  const CAM_KEYS = [
    { p: 0.00, pos: [-3.0, 7.0, 18.0], target: [0.0, 3.4, 0.0], fov: 40 },
    { p: 0.12, pos: [-1.0, 5.2, 16.0], target: [0.6, 3.6, 0.5], fov: 38 },
    { p: 0.27, pos: [-4.0, 4.8, 16.0], target: [0.6, 2.9, 0.0], fov: 42 },
    { p: 0.42, pos: [7.0, 4.4, 14.0], target: [0.3, 2.7, -0.6], fov: 40 },
    { p: 0.56, pos: [7.5, 5.4, 14.0], target: [0.2, 2.6, -1.2], fov: 38 },
    { p: 0.70, pos: [3.0, 6.2, 16.0], target: [-0.2, 2.5, -1.6], fov: 40 },
    { p: 0.84, pos: [-0.5, 4.0, 13.5], target: [-1.6, 2.3, -0.4], fov: 37 },
    { p: 1.00, pos: [-2.0, 3.3, 12.2], target: [-1.8, 2.25, -0.2], fov: 35 },
  ];

  const CAM_KEYS_MOBILE = [
    { p: 0.00, pos: [-1.0, 7.2, 24.0], target: [0, 3.0, 0.8], fov: 45 },
    { p: 0.14, pos: [0.5, 5.2, 21.0], target: [0, 2.6, 0.6], fov: 44 },
    { p: 0.30, pos: [-3.2, 3.6, 16.0], target: [0, 1.9, 0.2], fov: 47 },
    { p: 0.46, pos: [4.8, 3.6, 15.0], target: [0, 2.0, -0.4], fov: 46 },
    { p: 0.62, pos: [5.8, 5.4, 19.0], target: [0, 2.2, -1.0], fov: 45 },
    { p: 0.78, pos: [0.8, 5.8, 21.0], target: [0, 2.5, -1.0], fov: 45 },
    { p: 0.90, pos: [0, 4.0, 20.5], target: [0, 2.5, -0.4], fov: 44 },
    { p: 1.00, pos: [0, 3.6, 21.0], target: [0, 2.5, -0.2], fov: 44 },
  ];

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3),
    ];
  }

  function sampleCamera(p) {
    const keys = MOBILE ? CAM_KEYS_MOBILE : CAM_KEYS;
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1].p) i += 1;
    const k1 = keys[i];
    const k2 = keys[i + 1];
    const k0 = keys[Math.max(0, i - 1)];
    const k3 = keys[Math.min(keys.length - 1, i + 2)];
    const local = clamp((p - k1.p) / Math.max(0.0001, k2.p - k1.p), 0, 1);
    // ease the segment a touch so holds are cinematic
    const t = local;
    return {
      pos: catmull(k0.pos, k1.pos, k2.pos, k3.pos, t),
      target: catmull(k0.target, k1.target, k2.target, k3.target, t),
      fov: mix(k1.fov, k2.fov, smoothstep(0, 1, t)),
    };
  }

  function buildTimeline() {
    const dt = 1 / SIM_HZ;
    const bodies = DICE.map((die, i) => {
      const q0 = qMul(qFromAxis([0.4, 0.7, 0.2], rnd() * TAU), qFromAxis([0.1, 1, 0.3], rnd() * TAU));
      return {
        i,
        die,
        p: die.start.slice(),
        v: die.vel.slice(),
        q: qNorm(q0),
        w: die.spin.slice(),
        radius: die.scale * 0.92,
        mass: die.mass,
        invI: 1 / (0.4 * die.mass * Math.pow(die.scale * 0.95, 2)),
        grounded: false,
      };
    });
    const timeline = DICE.map(() => ({
      pos: new Float32Array(N * 3),
      quat: new Float32Array(N * 4),
      aura: new Float32Array(N),
    }));
    const impacts = [];
    const pulses = [
      { t: 2.42, strength: 0.55 },
      { t: 4.72, strength: 0.42 },
    ];
    const finalCam = sampleCamera(1).pos;
    const finalQ = DICE.map((die, i) => {
      const face = die.faces.find((f) => f.num === die.finalNumber) || die.faces[0];
      return qFaceCamera(face, finalCam, FINAL_POS[i]);
    });

    let phase = 0;
    let tweenU = 0;
    const snapshot = bodies.map((b) => ({ p: b.p.slice(), q: b.q.slice(), aura: 0 }));
    for (let s = 0; s < N; s += 1) {
      const t = s * dt;

      if (t >= TWEEN_START && phase === 0) {
        phase = 1;
        bodies.forEach((b, i) => {
          snapshot[i].p = b.p.slice();
          snapshot[i].q = b.q.slice();
        });
      }

      if (phase === 0) {
        // magic pulses lift the dice and force collisions
        pulses.forEach((pulse) => {
          if (t > pulse.t && t < pulse.t + dt) {
            bodies.forEach((b, i) => {
              const out = vNorm([b.p[0], 0.35, b.p[2]]);
              b.v = vAdd(b.v, [out[0] * 1.6 * pulse.strength, 3.6 * pulse.strength, out[2] * 1.6 * pulse.strength]);
              b.w = vAdd(b.w, [out[2] * 1.4, out[0] * 1.1, out[1] * 1.2]);
            });
            impacts.push({ t, pos: [0, 0.02, 0], strength: 0.85 * pulse.strength, magic: true });
          }
        });

        bodies.forEach((b) => {
          b.v[1] += -21 * dt;
          b.p = vAdd(b.p, vScale(b.v, dt));
          const speed = vLen(b.w);
          if (speed > 0.0001) {
            const dq = qFromAxis(vScale(b.w, 1 / speed), speed * dt);
            b.q = qNorm(qMul(dq, b.q));
          }
          b.v = vScale(b.v, 1 - 0.07 * dt);
          b.w = vScale(b.w, 1 - 0.16 * dt);

          // lowest vertex vs ground
          let lowY = Infinity;
          let low = null;
          b.die.unitVerts.forEach((v) => {
            const wv = qRotate(b.q, v);
            const wy = b.p[1] + wv[1] * b.die.scale;
            if (wy < lowY) { lowY = wy; low = wv; }
          });
          if (lowY < 0) {
            b.p[1] -= lowY;
            const r = vScale(low, b.die.scale);
            const vc = vAdd(b.v, vCross(b.w, r));
            if (vc[1] < 0) {
              const n = [0, 1, 0];
              const rxn = vCross(r, n);
              const denom = 1 / b.mass + b.invI * vDot(vCross(rxn, r), n);
              const j = -(1.42) * vc[1] / Math.max(0.0001, denom);
              b.v = vAdd(b.v, vScale(n, j / b.mass));
              b.w = vAdd(b.w, vScale(vCross(r, vScale(n, j)), b.invI));
              const vc2 = vAdd(b.v, vCross(b.w, r));
              const tang = [vc2[0], 0, vc2[2]];
              const tl = vLen(tang);
              if (tl > 0.001) {
                const jt = Math.min(0.58 * j, tl / Math.max(0.0001, 1 / b.mass));
                const jtVec = vScale(tang, -jt / tl);
                b.v = vAdd(b.v, vScale(jtVec, 1 / b.mass));
                b.w = vAdd(b.w, vScale(vCross(r, jtVec), b.invI * 0.6));
              }
              if (Math.abs(vc[1]) > 2.2) {
                impacts.push({ t, pos: [b.p[0], 0.02, b.p[2]], strength: clamp(Math.abs(vc[1]) / 9, 0.3, 1.6) });
              }
            }
            b.v[0] *= 0.94;
            b.v[2] *= 0.94;
            b.w = vScale(b.w, 0.94);
          }
        });

        // dice collisions
        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) {
            const a = bodies[i];
            const b = bodies[j];
            const d = vSub(b.p, a.p);
            const dist = vLen(d);
            const minD = a.radius + b.radius;
            if (dist > 0.001 && dist < minD) {
              const n = vScale(d, 1 / dist);
              const overlap = minD - dist;
              a.p = vAdd(a.p, vScale(n, -overlap * 0.5));
              b.p = vAdd(b.p, vScale(n, overlap * 0.5));
              const rel = vSub(b.v, a.v);
              const vn = vDot(rel, n);
              if (vn < 0) {
                const jimp = -(1.45) * vn / (1 / a.mass + 1 / b.mass);
                a.v = vAdd(a.v, vScale(n, -jimp / a.mass));
                b.v = vAdd(b.v, vScale(n, jimp / b.mass));
                const kick = vCross(n, [0.2, 0.7, 0.1]);
                a.w = vAdd(a.w, vScale(kick, jimp * a.invI * 0.5));
                b.w = vAdd(b.w, vScale(kick, -jimp * b.invI * 0.5));
                impacts.push({ t, pos: vScale(vAdd(a.p, b.p), 0.5), strength: 0.45 });
              }
            }
          }
        }
      } else {
        const u = smoothstep(TWEEN_START, TWEEN_END, t);
        tweenU = u;
        bodies.forEach((b, i) => {
          const arc = Math.sin(Math.PI * u) * 0.9;
          b.p = [
            mix(snapshot[i].p[0], FINAL_POS[i][0], u),
            mix(snapshot[i].p[1], FINAL_POS[i][1], u) + arc,
            mix(snapshot[i].p[2], FINAL_POS[i][2], u),
          ];
          b.q = qSlerp(snapshot[i].q, finalQ[i], smoothstep(0.05, 1, u));
        });
      }

      bodies.forEach((b, i) => {
        const store = timeline[i];
        store.pos[s * 3] = b.p[0];
        store.pos[s * 3 + 1] = b.p[1];
        store.pos[s * 3 + 2] = b.p[2];
        store.quat[s * 4] = b.q[0];
        store.quat[s * 4 + 1] = b.q[1];
        store.quat[s * 4 + 2] = b.q[2];
        store.quat[s * 4 + 3] = b.q[3];
        const speed = vLen(b.v) + vLen(b.w) * 0.4;
        store.aura[s] = phase === 0 ? clamp(0.24 + speed * 0.035, 0.24, 1.15) : mix(0.7, 1.05, tweenU);
      });
    }

    // keep the strongest impacts, sorted by time
    const sorted = impacts.sort((a, b) => a.t - b.t);
    const kept = [];
    for (let i = 0; i < sorted.length && kept.length < 8; i += 1) {
      if (sorted[i].strength > 0.35) kept.push(sorted[i]);
    }
    return {
      timeline,
      impacts: kept,
      finalQ,
      finalPos: FINAL_POS,
      duration: SIM_TIME,
      tweenStart: TWEEN_START,
    };
  }

  const SIM = buildTimeline();

  function sampleDie(i, p) {
    const t = clamp(p, 0, 1) * (N - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(N - 1, i0 + 1);
    const f = t - i0;
    const st = SIM.timeline[i];
    const a = i0 * 3;
    const b = i1 * 3;
    const qa = i0 * 4;
    const qb = i1 * 4;
    const pos = [
      mix(st.pos[a], st.pos[b], f),
      mix(st.pos[a + 1], st.pos[b + 1], f),
      mix(st.pos[a + 2], st.pos[b + 2], f),
    ];
    const q = qSlerp(
      [st.quat[qa], st.quat[qa + 1], st.quat[qa + 2], st.quat[qa + 3]],
      [st.quat[qb], st.quat[qb + 1], st.quat[qb + 2], st.quat[qb + 3]],
      f
    );
    return { pos, q, aura: mix(st.aura[i0], st.aura[i1], f) };
  }

  /* ── scene constants / world ──────────────────────────────── */
  const FINAL_CAMERA = sampleCamera(1);
  const ACTS = [
    { fog: [0.055, 0.028, 0.016], rune: [1.0, 0.48, 0.17], key: [1.0, 0.56, 0.25], rim: [0.2, 0.65, 0.72] },
    { fog: [0.012, 0.038, 0.036], rune: [0.3, 0.95, 0.82], key: [0.55, 0.9, 1.0], rim: [1.0, 0.32, 0.12] },
    { fog: [0.06, 0.016, 0.012], rune: [1.0, 0.25, 0.06], key: [1.0, 0.42, 0.14], rim: [0.85, 0.95, 0.7] },
  ];

  const impactsForShader = (() => {
    const arr = SIM.impacts.slice(0, 8).map((im) => ({
      t: im.t,
      pos: im.pos,
      s: im.strength,
    }));
    while (arr.length < 8) arr.push({ t: -100, pos: [0, 0, 0], s: 0 });
    return arr;
  })();

  // monoliths
  const monoliths = (() => {
    const list = [];
    const add = (x, z, w, h, d, rot, tint) => list.push({ x, z, w, h, d, rot, tint });
    // two tall gate pillars framing the ritual
    add(-17.0, -13.0, 2.2, 25, 2.0, 0.12, 0);
    add(17.0, -13.0, 2.2, 25, 2.0, -0.12, 2);
    // distant thin spires, far enough to read as a skyline
    for (let i = 0; i < 11; i += 1) {
      const a = Math.PI + (i / 10) * Math.PI + (rnd() - 0.5) * 0.16;
      const radius = 31 + rnd() * 16;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius - 7.0;
      const h = 9 + rnd() * 13;
      const w = 0.8 + rnd() * 1.1;
      const d = 0.8 + rnd() * 1.1;
      add(x, z, w, h, d, rnd() * TAU, i % 4 === 0 ? 1 : i % 6 === 0 ? 2 : 0);
    }
    return list;
  })();

  // portal torus
  function buildTorus(R, r, seg, tube) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i += 1) {
      const u = (i / seg) * TAU;
      const cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= tube; j += 1) {
        const v = (j / tube) * TAU;
        const cv = Math.cos(v), sv = Math.sin(v);
        const n = [cu * cv, su * cv, sv];
        pos.push(R * cu + r * n[0], R * su + r * n[1], r * n[2]);
        nor.push(...n);
        uv.push(u / TAU, v / TAU);
      }
    }
    for (let i = 0; i < seg; i += 1) {
      for (let j = 0; j < tube; j += 1) {
        const a = i * (tube + 1) + j;
        const b = a + tube + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
  }
  const PORTAL = buildTorus(3.7, 0.11, 96, 10);

  // particles
  const EMBER_COUNT = MOBILE ? 260 : 520;
  const embers = (() => {
    const a = new Float32Array(EMBER_COUNT * 8);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      const x = (rnd() - 0.5) * 38;
      const y = rnd() * 16;
      const z = (rnd() - 0.5) * 38;
      const seed = rnd();
      const size = 3 + rnd() * 9;
      const color = rnd() > 0.82 ? 1 : 0;
      a[i * 8] = x; a[i * 8 + 1] = y; a[i * 8 + 2] = z; a[i * 8 + 3] = seed;
      a[i * 8 + 4] = size; a[i * 8 + 5] = color; a[i * 8 + 6] = rnd(); a[i * 8 + 7] = rnd();
    }
    return a;
  })();

  const sparks = (() => {
    const count = SIM.impacts.length * (MOBILE ? 14 : 26);
    const a = new Float32Array(count * 10);
    let k = 0;
    SIM.impacts.forEach((im) => {
      const per = MOBILE ? 14 : 26;
      for (let i = 0; i < per; i += 1) {
        const dir = vNorm([(rnd() - 0.5) * 1.6, 0.5 + rnd(), (rnd() - 0.5) * 1.6]);
        const speed = 1.5 + rnd() * 5.5 * im.strength;
        a[k * 10] = im.t;
        a[k * 10 + 1] = im.pos[0]; a[k * 10 + 2] = im.pos[1]; a[k * 10 + 3] = im.pos[2];
        a[k * 10 + 4] = dir[0] * speed; a[k * 10 + 5] = dir[1] * speed; a[k * 10 + 6] = dir[2] * speed;
        a[k * 10 + 7] = 0.6 + rnd() * 1.1;
        a[k * 10 + 8] = rnd();
        a[k * 10 + 9] = im.strength;
        k += 1;
      }
    });
    return { data: a, count };
  })();

  /* ── WebGL helpers ────────────────────────────────────────── */
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Dice scene shader error:', gl.getShaderInfoLog(sh), '\n', src);
      return null;
    }
    return sh;
  }
  function createProgram(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Dice scene link error:', gl.getProgramInfoLog(p));
      return null;
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i += 1) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  function makeBuffer(target, data, usage = gl.STATIC_DRAW) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  }
  function makeTexture(w, h, data, opts = {}) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, opts.internal || gl.RGBA8, w, h, 0, gl.RGBA, opts.type || gl.UNSIGNED_BYTE, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (opts.mip) gl.generateMipmap(gl.TEXTURE_2D);
    return tx;
  }

  function createVAO(attribs, index) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    attribs.forEach((a) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0);
      if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
    });
    if (index) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  /* ── shaders ──────────────────────────────────────────────── */
  const FULLSCREEN_VS = `#version 300 es
    out vec2 vUv;
    void main(){
      vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
      vUv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }`;

  const DICE_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNor;
    layout(location=2) in vec2 aUv;
    layout(location=3) in vec3 aBary;
    uniform mat4 uVP;
    uniform mat4 uModel;
    uniform mat3 uNormal;
    out vec3 vWorld;
    out vec3 vNor;
    out vec2 vUv;
    out vec3 vBary;
    void main(){
      vec4 w = uModel * vec4(aPos, 1.0);
      vWorld = w.xyz;
      vNor = normalize(uNormal * aNor);
      vUv = aUv;
      vBary = aBary;
      gl_Position = uVP * w;
    }`;

  const DICE_FS = `#version 300 es
    precision highp float;
    in vec3 vWorld;
    in vec3 vNor;
    in vec2 vUv;
    in vec3 vBary;
    uniform vec3 uCam;
    uniform vec3 uBase;
    uniform vec3 uAccent;
    uniform vec3 uNumColor;
    uniform vec3 uAuraColor;
    uniform vec3 uFogColor;
    uniform float uFog;
    uniform float uAura;
    uniform float uAuraScale;
    uniform float uTint;
    uniform float uTime;
    uniform float uSeed;
    uniform sampler2D uAtlas;
    uniform vec3 uKey;
    uniform vec3 uRim;
    out vec4 fragColor;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
    }
    float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }

    void main(){
      vec3 N = normalize(vNor);
      vec3 V = normalize(uCam - vWorld);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

      vec3 L1 = normalize(vec3(-0.45, 0.9, 0.55));
      vec3 L2 = normalize(vec3(0.8, 0.25, -0.4));
      vec3 H1 = normalize(L1 + V);
      vec3 H2 = normalize(L2 + V);
      float d1 = max(dot(N, L1), 0.0);
      float d2 = max(dot(N, L2), 0.0);
      float s1 = pow(max(dot(N, H1), 0.0), 42.0);
      float s2 = pow(max(dot(N, H2), 0.0), 28.0);

      float grain = fbm(vWorld.xz * 3.2 + vWorld.y * 1.7 + uSeed);
      vec3 col = uBase * (0.75 + grain * 0.55);
      col *= 0.52 + 0.85 * d1 + 0.22 * max(N.y, 0.0);
      vec3 keyCol = mix(uKey, uAuraColor, uTint);
      vec3 rimCol = mix(uRim, uAuraColor, uTint * 0.55);
      col += keyCol * (d1 * 0.44 + s1 * 0.55);
      col += rimCol * (d2 * 0.22 + s2 * 0.34);

      float edge = min(vBary.x, min(vBary.y, vBary.z));
      float rim = smoothstep(0.085, 0.0, edge);
      col += uAccent * rim * (0.28 + uAura * uAuraScale * 0.55);

      vec4 tx = texture(uAtlas, vUv);
      float ink = smoothstep(0.22, 0.82, tx.a);
      col = mix(col, tx.rgb, ink * 0.92);
      col += tx.rgb * smoothstep(0.0, 0.55, tx.a) * 0.16;

      col += uAuraColor * fres * (0.18 + uAura * uAuraScale * 0.3);
      col += uAuraColor * uAura * uAuraScale * 0.016;

      float dist = length(uCam - vWorld);
      float fog = 1.0 - exp(-dist * uFog);
      col = mix(col, uFogColor, clamp(fog, 0.0, 0.82));

      fragColor = vec4(col, 1.0);
    }`;

  const GROUND_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    uniform mat4 uVP;
    out vec3 vWorld;
    void main(){
      vWorld = aPos;
      gl_Position = uVP * vec4(aPos, 1.0);
    }`;

  const GROUND_FS = `#version 300 es
    precision highp float;
    in vec3 vWorld;
    uniform vec3 uCam;
    uniform vec3 uFogColor;
    uniform vec3 uRune;
    uniform float uFog;
    uniform float uTime;
    uniform float uP;
    uniform float uSigil;
    uniform float uPortal;
    uniform vec3 uDicePos0;
    uniform vec3 uDicePos1;
    uniform vec3 uDicePos2;
    uniform vec3 uDiceCol0;
    uniform vec3 uDiceCol1;
    uniform vec3 uDiceCol2;
    uniform float uAura0;
    uniform float uAura1;
    uniform float uAura2;
    uniform float uImpactT[8];
    uniform vec3 uImpactPos[8];
    uniform float uImpactS[8];
    out vec4 fragColor;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
    }
    float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }
    float line(float x, float w){ return smoothstep(w, 0.0, abs(x)); }

    void main(){
      vec2 p = vWorld.xz;
      float r = length(p);
      float a = atan(p.y, p.x);
      float dist = length(uCam - vWorld);

      float stone = fbm(p * 0.23 + 4.0);
      vec3 col = mix(vec3(0.030,0.020,0.015), vec3(0.085,0.052,0.032), stone);
      col += uRune * pow(fbm(p * 0.11 + 9.0), 2.0) * 0.06;
      col += uRune * smoothstep(14.0, 0.0, r) * 0.06 * (0.35 + uSigil * 0.65);

      float grid = line(fract(p.x * 0.5) - 0.5, 0.012) + line(fract(p.y * 0.5) - 0.5, 0.012);
      col += vec3(0.07,0.04,0.025) * grid * 0.25;

      // arcane circle
      float ring1 = line(r - 4.4, 0.018);
      float ring2 = line(r - 6.15, 0.012);
      float ring3 = line(r - 7.9, 0.026);
      float dash = step(0.35, fract(a * 34.0 / 6.2831));
      float ticks = line(r - 7.62, 0.055) * step(0.72, fract(a * 72.0 / 6.2831));
      float runes = 0.0;
      float ang = a * 24.0 / 6.2831;
      float band = step(0.55, hash(vec2(floor(ang), 3.0))) * line(r - 5.35, 0.05);
      runes += band * step(0.55, fract(ang));
      float ringGlow = (ring1 + ring2 * 0.6 + ring3 * 0.8 + ticks * 0.6 + runes * 0.8) * uSigil;
      col += uRune * ringGlow * 1.35;
      col += uRune * smoothstep(8.6, 3.0, r) * 0.035 * uSigil;

      // hexagram sigil
      float hex = 0.0;
      for (int i = 0; i < 3; i++) {
        float aa = float(i) * 2.0944 + 1.5708;
        vec2 A = vec2(cos(aa), sin(aa)) * 4.4;
        vec2 B = vec2(cos(aa + 2.0944), sin(aa + 2.0944)) * 4.4;
        vec2 AB = B - A;
        float h = clamp(dot(p - A, AB) / dot(AB, AB), 0.0, 1.0);
        hex += line(length(p - (A + AB * h)), 0.014);
      }
      col += uRune * hex * uSigil * 1.05;

      // impact ripples
      for (int i = 0; i < 8; i++) {
        float age = uTime - uImpactT[i];
        if (age > 0.0 && age < 2.2) {
          float rad = age * 6.4;
          float d = length(p - uImpactPos[i].xz);
          float band = line(d - rad, 0.13 + age * 0.06) * exp(-age * 1.35);
          col += uRune * band * uImpactS[i] * 1.2;
          col += uRune * smoothstep(0.5, 0.0, d) * exp(-age * 3.0) * uImpactS[i] * 0.2;
        }
      }

      // dice light pools / contact shadow
      for (int i = 0; i < 3; i++) {
        vec3 dp = i == 0 ? uDicePos0 : (i == 1 ? uDicePos1 : uDicePos2);
        vec3 dc = i == 0 ? uDiceCol0 : (i == 1 ? uDiceCol1 : uDiceCol2);
        float au = i == 0 ? uAura0 : (i == 1 ? uAura1 : uAura2);
        vec2 d2 = p - dp.xz;
        float dd = length(d2);
        float height = max(dp.y, 0.15);
        float pool = 1.0 / (1.0 + dd * dd * (0.6 + height * 0.2));
        col += dc * pool * (0.18 + au * 0.3);
        col *= 1.0 - 0.5 * exp(-dd * dd * 2.2) * clamp(1.0 - height * 0.18, 0.0, 1.0);
      }

      float portalPool = smoothstep(10.0, 0.0, length(p - vec2(0.0, -12.0))) * uPortal;
      col += uRune * portalPool * 0.09;
      col += vec3(0.25,0.10,0.04) * smoothstep(16.0, 0.0, r) * 0.02;

      float fog = 1.0 - exp(-dist * uFog * 1.15);
      col = mix(col, uFogColor, clamp(fog, 0.0, 0.94));
      fragColor = vec4(col, 1.0);
    }`;

  const SKY_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform float uP;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform vec3 uRune;
    out vec4 fragColor;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
    }
    float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }
    void main(){
      vec2 uv = vUv;
      vec3 top = vec3(0.008,0.006,0.009);
      vec3 bottom = uFogColor * 0.75;
      vec3 col = mix(bottom, top, smoothstep(0.0, 0.95, uv.y));
      float horizon = exp(-pow((uv.y - 0.42) * 5.2, 2.0));
      col += uRune * horizon * 0.14;
      col += uRune * smoothstep(0.95, 0.1, uv.y) * 0.045;
      float glow = exp(-pow((uv.x - 0.70) * 2.0, 2.0) - pow((uv.y - 0.52) * 3.0, 2.0));
      col += uRune * glow * 0.16;
      vec2 g = uv * vec2(90.0, 52.0);
      vec2 id = floor(g); vec2 f = fract(g) - 0.5;
      float h = hash(id);
      float star = smoothstep(0.02, 0.0, length(f)) * step(0.985, h);
      col += vec3(1.0,0.78,0.55) * star * 0.55;
      float clouds = fbm(vec2(uv.x * 2.1, uv.y * 3.4 + uTime * 0.01));
      col += uRune * pow(clouds, 3.0) * 0.10;
      float neb = fbm(vec2(uv.x * 3.2 + 5.0, uv.y * 2.4 - uTime * 0.008));
      col += mix(uRune, vec3(0.2,0.5,0.55), 0.5) * pow(neb, 4.0) * 0.08;
      col += vec3(1.0,0.82,0.6) * star * 0.35;
      fragColor = vec4(col, 1.0);
    }`;

  const SKY_DISC_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    uniform mat4 uVP;
    uniform vec3 uCenter;
    uniform float uSize;
    out vec2 vUv;
    void main(){
      vec3 w = uCenter + vec3(aPos.xy * uSize, 0.0);
      vUv = aPos.xy * 0.5 + 0.5;
      gl_Position = uVP * vec4(w, 1.0);
    }`;

  const SKY_DISC_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform vec3 uColor;
    uniform float uTime;
    out vec4 fragColor;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float rim = smoothstep(1.0, 0.93, r) * (1.0 - smoothstep(0.93, 0.85, r));
      float corona = (1.0 - smoothstep(0.85, 1.0, r));
      float rays = 0.5 + 0.5 * sin(a * 21.0 + uTime * 0.22);
      vec3 col = vec3(0.004, 0.003, 0.003);
      col += uColor * rim * 0.75;
      col += uColor * corona * 0.04;
      col += uColor * smoothstep(1.0, 0.8, r) * rays * 0.02;
      fragColor = vec4(col, 1.0);
    }`;

  const MONO_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNor;
    layout(location=2) in vec3 aLocal;
    layout(location=3) in mat4 aModel;
    layout(location=7) in vec3 aColor;
    layout(location=8) in float aSeed;
    uniform mat4 uVP;
    out vec3 vWorld;
    out vec3 vNor;
    out vec3 vLocal;
    out vec3 vColor;
    out float vSeed;
    void main(){
      vec4 w = aModel * vec4(aPos, 1.0);
      vWorld = w.xyz;
      vNor = normalize(mat3(aModel) * aNor);
      vLocal = aLocal;
      vColor = aColor;
      vSeed = aSeed;
      gl_Position = uVP * w;
    }`;

  const MONO_FS = `#version 300 es
    precision highp float;
    in vec3 vWorld;
    in vec3 vNor;
    in vec3 vLocal;
    in vec3 vColor;
    in float vSeed;
    uniform vec3 uCam;
    uniform vec3 uFogColor;
    uniform vec3 uRune;
    uniform float uFog;
    uniform float uTime;
    out vec4 fragColor;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    void main(){
      vec3 N = normalize(vNor);
      vec3 V = normalize(uCam - vWorld);
      float fres = pow(1.0 - max(dot(N,V),0.0), 2.0);

      float side = abs(N.x) > abs(N.z) ? abs(vLocal.z) : abs(vLocal.x);
      float u = clamp(side * 2.0, 0.0, 1.0);
      float v = clamp(vLocal.y + 0.5, 0.0, 1.0);

      vec3 col = vec3(0.003, 0.0025, 0.0025);
      col += vec3(0.01, 0.007, 0.006) * max(N.y, 0.0);

      float lines = 0.0;
      float traceX = 0.16 + 0.68 * hash(vec2(vSeed, 1.0));
      lines += smoothstep(0.012, 0.0, abs(u - traceX)) * 0.9;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float hy = 0.18 + 0.66 * hash(vec2(vSeed, fi + 3.0));
        float cx = 0.15 + 0.7 * hash(vec2(vSeed, fi + 9.0));
        float halfW = 0.08 + 0.24 * hash(vec2(vSeed, fi + 17.0));
        float on = step(0.25, hash(vec2(vSeed, fi + 23.0)));
        lines += smoothstep(0.009, 0.0, abs(v - hy)) * step(abs(u - cx), halfW) * on;
      }
      float edgeSeam = smoothstep(0.045, 0.0, abs(u - 1.0));
      lines += edgeSeam * 0.55;

      vec2 cell = vec2(u * 9.0 + vSeed * 4.0, v * 12.0 + vSeed * 3.0);
      vec2 cid = floor(cell);
      vec2 cf = fract(cell) - 0.5;
      float glyph = step(0.7, hash(cid)) * smoothstep(0.30, 0.10, length(cf));
      lines += glyph * 0.85;

      vec3 ink = mix(uRune, vColor, 0.55);
      col += ink * lines * (0.7 + fres * 0.5);
      col += ink * fres * 0.025;

      float dist = length(uCam - vWorld);
      float fog = 1.0 - exp(-dist * uFog * 1.25);
      col = mix(col, uFogColor, clamp(fog, 0.0, 0.72));
      fragColor = vec4(col, 1.0);
    }`;

  const PORTAL_DISC_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uTime;
    uniform float uPower;
    out vec4 fragColor;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y); }
    float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 9.0 - uTime * 0.55 + sin(a * 3.0 + uTime * 0.2) * 1.6);
      float n = fbm(vec2(a * 2.5, r * 4.0 - uTime * 0.15));
      float energy = smoothstep(1.0, 0.12, r) * (0.3 + 0.7 * swirl * (0.55 + n * 0.6));
      vec3 col = mix(uColorA, uColorB, clamp(swirl * 0.65 + n * 0.35, 0.0, 1.0));
      col *= 0.55 + energy;
      float rim = smoothstep(1.0, 0.86, r) * (1.0 - smoothstep(0.9, 0.8, r));
      col += uColorB * rim * 1.6;
      fragColor = vec4(col * uPower, energy * 0.55 * uPower);
    }`;

  const BEAM_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    uniform mat4 uVP;
    uniform vec3 uCenter;
    uniform vec2 uSize;
    uniform float uSlant;
    out vec2 vUv;
    void main(){
      vec3 w = vec3(uCenter.x + aPos.x * uSize.x + aPos.y * uSlant, aPos.y * uSize.y, uCenter.z);
      vUv = vec2(aPos.x + 0.5, aPos.y);
      gl_Position = uVP * vec4(w, 1.0);
    }`;

  const BEAM_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    out vec4 fragColor;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y); }
    void main(){
      float a = smoothstep(0.0, 0.24, vUv.x) * smoothstep(1.0, 0.76, vUv.x);
      a *= smoothstep(0.0, 0.10, vUv.y) * (1.0 - vUv.y);
      a *= 0.65 + 0.35 * noise(vec2(vUv.x * 7.0 + vUv.y * 2.0, uTime * 0.15));
      fragColor = vec4(uColor, a * uOpacity);
    }`;

  const AURA_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    uniform mat4 uVP;
    uniform vec3 uCenter;
    uniform vec3 uRight;
    uniform vec3 uUp;
    uniform float uSize;
    out vec2 vUv;
    void main(){
      vUv = aPos.xy + 0.5;
      vec3 w = uCenter + uRight * aPos.x * uSize + uUp * aPos.y * uSize;
      gl_Position = uVP * vec4(w, 1.0);
    }`;

  const AURA_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform vec3 uColor;
    uniform float uIntensity;
    out vec4 fragColor;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float a = smoothstep(1.0, 0.05, r);
      a *= a;
      fragColor = vec4(uColor * a, a * uIntensity);
    }`;

  const PARTICLE_VS = `#version 300 es
    layout(location=0) in vec3 aSeed;
    layout(location=1) in float aSize;
    layout(location=2) in float aKind;
    uniform mat4 uVP;
    uniform float uTime;
    uniform vec3 uCam;
    out float vAlpha;
    out vec3 vColor;
    void main(){
      float t = uTime;
      float speed = 0.25 + aSeed.x * 0.55;
      float y = mod(aSeed.y - t * speed * 0.55, 16.0);
      vec3 p = vec3((aSeed.x - 0.5) * 34.0, y, (aSeed.z - 0.5) * 34.0);
      p.x += sin(t * 0.4 + aSeed.y * 9.0) * 0.8;
      p.z += cos(t * 0.31 + aSeed.x * 8.0) * 0.8;
      vec4 clip = uVP * vec4(p, 1.0);
      gl_Position = clip;
      float dist = length(uCam - p);
      gl_PointSize = clamp(aSize * (110.0 / max(dist, 0.5)), 1.0, 22.0);
      float fade = smoothstep(0.0, 2.0, y) * smoothstep(16.0, 12.0, y);
      vAlpha = fade * (0.5 + 0.5 * aSeed.y);
      vColor = aKind > 0.5 ? vec3(0.35,0.95,0.82) : vec3(1.0,0.52,0.2);
    }`;

  const PARTICLE_FS = `#version 300 es
    precision highp float;
    in float vAlpha;
    in vec3 vColor;
    out vec4 fragColor;
    void main(){
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float a = smoothstep(1.0, 0.0, length(p));
      fragColor = vec4(vColor, a * vAlpha);
    }`;

  const SPARK_VS = `#version 300 es
    layout(location=0) in float aSpawn;
    layout(location=1) in vec3 aPos;
    layout(location=2) in vec3 aVel;
    layout(location=3) in float aSize;
    layout(location=4) in float aSeed;
    layout(location=5) in float aStrength;
    uniform mat4 uVP;
    uniform float uTime;
    uniform vec3 uCam;
    out float vAlpha;
    out vec3 vColor;
    void main(){
      float age = uTime - aSpawn;
      float life = 1.2 + aSeed * 0.8;
      vAlpha = 0.0;
      gl_Position = vec4(2.0,2.0,2.0,1.0);
      gl_PointSize = 0.0;
      if (age < 0.0 || age > life) return;
      vec3 p = aPos + aVel * age + vec3(0.0, -9.0, 0.0) * age * age * 0.5;
      gl_Position = uVP * vec4(p, 1.0);
      float dist = length(uCam - p);
      gl_PointSize = clamp(aSize * (90.0 / max(dist, 0.5)) * (1.0 - age / life), 1.0, 10.0);
      vAlpha = (1.0 - age / life) * 0.9 * aStrength;
      vColor = mix(vec3(1.0,0.85,0.4), vec3(1.0,0.3,0.08), aSeed);
    }`;

  const SPARK_FS = `#version 300 es
    precision highp float;
    in float vAlpha;
    in vec3 vColor;
    out vec4 fragColor;
    void main(){
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float a = smoothstep(1.0, 0.0, length(p));
      fragColor = vec4(vColor, a * vAlpha);
    }`;

  const PORTAL_VS = `#version 300 es
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNor;
    layout(location=2) in vec2 aUv;
    uniform mat4 uVP;
    uniform vec3 uCenter;
    out vec3 vNor;
    out vec2 vUv;
    out vec3 vWorld;
    void main(){
      vec4 w = vec4(aPos + uCenter, 1.0);
      vWorld = w.xyz;
      vNor = aNor;
      vUv = aUv;
      gl_Position = uVP * w;
    }`;

  const PORTAL_FS = `#version 300 es
    precision highp float;
    in vec3 vNor;
    in vec2 vUv;
    in vec3 vWorld;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uTime;
    uniform float uPower;
    uniform vec3 uCam;
    out vec4 fragColor;
    void main(){
      float u = vUv.x;
      float v = vUv.y;
      float wave = 0.5 + 0.5 * sin(u * 40.0 + v * 12.0 - uTime * 0.8);
      float wave2 = 0.5 + 0.5 * sin(u * 13.0 - v * 20.0 + uTime * 0.5);
      vec3 col = mix(uColorA, uColorB, wave * 0.7 + wave2 * 0.3);
      float fres = pow(1.0 - abs(dot(normalize(vNor), normalize(uCam - vWorld))), 1.5);
      col *= 0.7 + fres * 1.3;
      fragColor = vec4(col * uPower, 1.0);
    }`;

  const BRIGHT_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform float uThreshold;
    out vec4 fragColor;
    void main(){
      vec3 c = texture(uTex, vUv).rgb;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      vec3 b = c * smoothstep(uThreshold, uThreshold + 0.25, l);
      fragColor = vec4(b, 1.0);
    }`;

  const BLUR_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uDir;
    out vec4 fragColor;
    void main(){
      vec3 c = texture(uTex, vUv).rgb * 0.227027;
      c += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
      c += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
      c += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
      c += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
      fragColor = vec4(c, 1.0);
    }`;

  const COMPOSITE_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uScene;
    uniform sampler2D uBloom;
    uniform float uBloomStrength;
    uniform float uFlash;
    uniform float uP;
    uniform vec3 uHaze;
    uniform vec2 uRes;
    out vec4 fragColor;

    vec3 aces(vec3 x){
      const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      float ca = 0.0016 * (0.4 + length(cc));
      vec3 scene;
      scene.r = texture(uScene, uv + cc * ca).r;
      scene.g = texture(uScene, uv).g;
      scene.b = texture(uScene, uv - cc * ca).b;
      vec3 bloom = texture(uBloom, uv).rgb;
      vec3 col = scene + bloom * uBloomStrength;

      col = aces(col * 1.15);
      float vig = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.23);
      col *= 0.35 + 0.65 * vig;
      float haze = exp(-pow((uv.y - 0.52) * 3.2, 2.0));
      col = mix(col, uHaze, haze * 0.055);
      col += uFlash * vec3(1.0, 0.55, 0.25) * 0.08;
      col += (hash(gl_FragCoord.xy + uP * 17.0) - 0.5) * 0.018;
      fragColor = vec4(col, 1.0);
    }`;

  /* ── programs / buffers ───────────────────────────────────── */
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const progDice = createProgram(DICE_VS, DICE_FS);
  const progGround = createProgram(GROUND_VS, GROUND_FS);
  const progSky = createProgram(FULLSCREEN_VS, SKY_FS);
  const progMono = createProgram(MONO_VS, MONO_FS);
  const progAura = createProgram(AURA_VS, AURA_FS);
  const progParticle = createProgram(PARTICLE_VS, PARTICLE_FS);
  const progSpark = createProgram(SPARK_VS, SPARK_FS);
  const progPortal = createProgram(PORTAL_VS, PORTAL_FS);
  const progDisc = createProgram(SKY_DISC_VS, SKY_DISC_FS);
  const progBeam = createProgram(BEAM_VS, BEAM_FS);
  const progPortalDisc = createProgram(SKY_DISC_VS, PORTAL_DISC_FS);
  const progBright = createProgram(FULLSCREEN_VS, BRIGHT_FS);
  const progBlur = createProgram(FULLSCREEN_VS, BLUR_FS);
  const progComposite = createProgram(FULLSCREEN_VS, COMPOSITE_FS);

  if (!progDice || !progGround || !progSky || !progMono || !progAura || !progParticle || !progSpark || !progPortal || !progDisc || !progBeam || !progPortalDisc || !progBright || !progBlur || !progComposite) {
    hero.classList.remove('is-scene-ready');
    hero.classList.add('no-scene');
    return;
  }

  // fullscreen empty vao
  const emptyVAO = gl.createVertexArray();

  // dice geometry/atlases
  const diceGPU = DICE.map((die) => {
    const layout = atlasLayout(die.faces.length);
    const atlas = makeAtlasCanvas(die);
    const geom = buildDieGeometry(die, layout.cols, layout.rows);
    const atlasTex = makeTexture(atlas.cv.width, atlas.cv.height, atlas.cv, { mip: true });
    const bufs = {
      pos: makeBuffer(gl.ARRAY_BUFFER, geom.pos),
      nor: makeBuffer(gl.ARRAY_BUFFER, geom.nor),
      uv: makeBuffer(gl.ARRAY_BUFFER, geom.uv),
      bary: makeBuffer(gl.ARRAY_BUFFER, geom.bary),
    };
    const vao = createVAO([
      { buf: bufs.pos, loc: 0, size: 3 },
      { buf: bufs.nor, loc: 1, size: 3 },
      { buf: bufs.uv, loc: 2, size: 2 },
      { buf: bufs.bary, loc: 3, size: 3 },
    ]);
    return { die, geom, vao, atlasTex, atlasCanvas: atlas.cv };
  });

  // cube
  const CUBE = (() => {
    const pos = [], nor = [], loc = [], idx = [];
    const faces = [
      { n: [0,0,1], v: [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]] },
      { n: [0,0,-1], v: [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]] },
      { n: [1,0,0], v: [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]] },
      { n: [-1,0,0], v: [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]] },
      { n: [0,1,0], v: [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]] },
      { n: [0,-1,0], v: [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]] },
    ];
    faces.forEach((f) => {
      const base = pos.length / 3;
      f.v.forEach((v) => {
        pos.push(...v); nor.push(...f.n); loc.push(...v);
      });
      idx.push(base, base+1, base+2, base, base+2, base+3);
    });
    return {
      pos: new Float32Array(pos), nor: new Float32Array(nor), loc: new Float32Array(loc),
      idx: new Uint16Array(idx),
    };
  })();

  const MONO_COUNT = monoliths.length;
  const monoMat = new Float32Array(MONO_COUNT * 16);
  const monoCol = new Float32Array(MONO_COUNT * 3);
  const monoSeed = new Float32Array(MONO_COUNT);
  const tintCols = [[0.95,0.35,0.12],[0.24,0.9,0.78],[1.0,0.18,0.08]];
  monoliths.forEach((m, i) => {
    const q = qFromAxis([0,1,0], m.rot);
    const s = [m.w, m.h, m.d];
    monoMat.set(m4FromQuatPosScale(q, [m.x, m.h/2, m.z], s), i * 16);
    const tc = tintCols[m.tint];
    monoCol.set([tc[0]*0.32, tc[1]*0.32, tc[2]*0.32], i * 3);
    monoSeed[i] = rnd();
  });
  const cubeBufs = {
    pos: makeBuffer(gl.ARRAY_BUFFER, CUBE.pos),
    nor: makeBuffer(gl.ARRAY_BUFFER, CUBE.nor),
    loc: makeBuffer(gl.ARRAY_BUFFER, CUBE.loc),
    idx: makeBuffer(gl.ELEMENT_ARRAY_BUFFER, CUBE.idx),
    mat: makeBuffer(gl.ARRAY_BUFFER, monoMat),
    col: makeBuffer(gl.ARRAY_BUFFER, monoCol),
    seed: makeBuffer(gl.ARRAY_BUFFER, monoSeed),
  };
  const monoVAO = gl.createVertexArray();
  gl.bindVertexArray(monoVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.nor); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.loc); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,0,0);
  const monoAttrs = [3,4,5,6];
  monoAttrs.forEach((loc, k) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.mat);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, k * 16);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.col); gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7,3,gl.FLOAT,false,0,0); gl.vertexAttribDivisor(7,1);
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBufs.seed); gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8,1,gl.FLOAT,false,0,0); gl.vertexAttribDivisor(8,1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeBufs.idx);
  gl.bindVertexArray(null);

  // ground
  const groundVerts = new Float32Array([
    -80, 0, -80, 80, 0, -80, 80, 0, 80,
    -80, 0, -80, 80, 0, 80, -80, 0, 80,
  ]);
  const groundVAO = createVAO([{ buf: makeBuffer(gl.ARRAY_BUFFER, groundVerts), loc: 0, size: 3 }]);

  // aura quad
  const auraVerts = new Float32Array([
    -0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0,
    -0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0,
  ]);
  const auraVAO = createVAO([{ buf: makeBuffer(gl.ARRAY_BUFFER, auraVerts), loc: 0, size: 3 }]);

  // sky disc quad
  const discVerts = new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ]);
  const discVAO = createVAO([{ buf: makeBuffer(gl.ARRAY_BUFFER, discVerts), loc: 0, size: 3 }]);

  const beamVerts = new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0,
    -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
  ]);
  const beamVAO = createVAO([{ buf: makeBuffer(gl.ARRAY_BUFFER, beamVerts), loc: 0, size: 3 }]);
  const BEAMS = [
    { x: -8.5, z: -9.0, w: 4.2, h: 30.0, slant: 2.4 },
    { x: -2.5, z: -5.0, w: 2.8, h: 28.0, slant: -1.2 },
    { x: 4.5, z: -8.0, w: 3.6, h: 32.0, slant: 1.6 },
    { x: 10.0, z: -12.0, w: 4.8, h: 30.0, slant: -2.6 },
  ];

  // particles
  const particleVAO = gl.createVertexArray();
  gl.bindVertexArray(particleVAO);
  const emberBuf = {
    seed: makeBuffer(gl.ARRAY_BUFFER, embers),
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, emberBuf.seed);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.FLOAT,false,32,12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,32,16);
  gl.bindVertexArray(null);

  const sparkVAO = gl.createVertexArray();
  gl.bindVertexArray(sparkVAO);
  const sparkBuf = makeBuffer(gl.ARRAY_BUFFER, sparks.data);
  gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,1,gl.FLOAT,false,40,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,40,4);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,40,16);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.FLOAT,false,40,28);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,1,gl.FLOAT,false,40,32);
  gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,40,36);
  gl.bindVertexArray(null);

  // portal
  const portalVAO = createVAO([
    { buf: makeBuffer(gl.ARRAY_BUFFER, PORTAL.pos), loc: 0, size: 3 },
    { buf: makeBuffer(gl.ARRAY_BUFFER, PORTAL.nor), loc: 1, size: 3 },
    { buf: makeBuffer(gl.ARRAY_BUFFER, PORTAL.uv), loc: 2, size: 2 },
  ], makeBuffer(gl.ELEMENT_ARRAY_BUFFER, PORTAL.idx));

  /* ── framebuffers ─────────────────────────────────────────── */
  let W = 1, H = 1, DPR = 1;
  let sceneTex = null, sceneFBO = null, depthRB = null;
  let bloomA = null, bloomB = null, bloomFA = null, bloomFB = null;
  let bloomW = 1, bloomH = 1;

  function deleteFBOs() {
    if (sceneFBO) gl.deleteFramebuffer(sceneFBO);
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (depthRB) gl.deleteRenderbuffer(depthRB);
    if (bloomFA) gl.deleteFramebuffer(bloomFA);
    if (bloomFB) gl.deleteFramebuffer(bloomFB);
    if (bloomA) gl.deleteTexture(bloomA);
    if (bloomB) gl.deleteTexture(bloomB);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.35 : 1.6);
    let w = Math.max(2, Math.round(rect.width * DPR));
    let h = Math.max(2, Math.round(rect.height * DPR));
    const maxPixels = MOBILE ? 1.1e6 : 2.6e6;
    if (w * h > maxPixels) {
      const s = Math.sqrt(maxPixels / (w * h));
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    if (w === W && h === H && sceneFBO) return;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    deleteFBOs();
    sceneTex = makeTexture(W, H, null);
    sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    depthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
    bloomW = Math.max(2, Math.floor(W / 2));
    bloomH = Math.max(2, Math.floor(H / 2));
    bloomA = makeTexture(bloomW, bloomH, null);
    bloomB = makeTexture(bloomW, bloomH, null);
    bloomFA = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomA, 0);
    bloomFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomB, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ── state / UI ───────────────────────────────────────────── */
  const els = {
    act: document.getElementById('scene-act'),
    name: document.getElementById('scene-name'),
    progress: document.getElementById('scene-progress'),
    percent: document.getElementById('scene-percent'),
  };
  const ACT_NAMES = ['ПАДЕНИЕ', 'СХВАТКА', 'ПРИГОВОР'];
  let pSmooth = 0;
  let lastAct = -1;
  let running = false;
  let visible = true;
  let raf = 0;
  let lastTime = 0;
  let idleFrames = 0;

  function updateUI(p) {
    const act = p < 0.34 ? 0 : p < 0.67 ? 1 : 2;
    if (act !== lastAct) {
      lastAct = act;
      if (els.act) els.act.textContent = String(act + 1).padStart(2, '0');
      if (els.name) els.name.textContent = ACT_NAMES[act];
    }
    if (els.progress) els.progress.style.width = `${(p * 100).toFixed(1)}%`;
    if (els.percent) els.percent.textContent = `${String(Math.round(p * 100)).padStart(2, '0')}%`;
    hero.style.setProperty('--hp', p.toFixed(4));
    const intro = 1 - smoothstep(0.38, 0.72, p) * 0.7;
    hero.style.setProperty('--intro', intro.toFixed(3));
  }

  function getScrollP(target) {
    const rect = hero.getBoundingClientRect();
    const total = Math.max(1, hero.offsetHeight - window.innerHeight);
    return clamp(-rect.top / total, 0, 1);
  }

  function actWeights(p) {
    const a1 = smoothstep(0.30, 0.42, p);
    const a2 = smoothstep(0.62, 0.74, p);
    return { a1, a2 };
  }

  function envFor(p) {
    const { a1, a2 } = actWeights(p);
    const c0 = ACTS[0], c1 = ACTS[1], c2 = ACTS[2];
    const fog = mix3(mix3(c0.fog, c1.fog, a1), c2.fog, a2);
    const rune = mix3(mix3(c0.rune, c1.rune, a1), c2.rune, a2);
    const key = mix3(mix3(c0.key, c1.key, a1), c2.key, a2);
    const rim = mix3(mix3(c0.rim, c1.rim, a1), c2.rim, a2);
    const flash = Math.exp(-Math.pow((p - 0.335) / 0.018, 2)) + Math.exp(-Math.pow((p - 0.665) / 0.018, 2));
    const sigil = 0.38 + smoothstep(0.02, 0.22, p) * (0.45 + a1 * 0.2 + a2 * 0.5);
    const portal = smoothstep(0.56, 0.82, p);
    return { fog, rune, key, rim, flash: clamp(flash, 0, 1), sigil, portal, a1, a2 };
  }

  function cameraAt(p) {
    const cam = sampleCamera(p);
    const t = p * SIM.duration;
    let shake = 0;
    impactsForShader.forEach((im) => {
      shake += im.s * Math.exp(-Math.pow((t - im.t) / 0.14, 2));
    });
    const sh = Math.min(0.12, shake * 0.012);
    return {
      pos: [cam.pos[0] + Math.sin(t * 80.0) * sh, cam.pos[1] + Math.cos(t * 63.0) * sh * 0.7, cam.pos[2]],
      target: cam.target,
      fov: cam.fov,
    };
  }

  /* ── rendering ────────────────────────────────────────────── */
  let vp = new Float32Array(16);

  function setSceneUniforms(p) {
    const env = envFor(p);
    const cam = cameraAt(p);
    const aspect = W / H;
    const look = m4LookAt(cam.pos, cam.target, [0, 1, 0]);
    const proj = m4Perspective((cam.fov * Math.PI) / 180, aspect, 0.1, 160);
    vp = m4Multiply(proj, look);
    return { env, cam, vp, aspect };
  }

  function drawScene(p) {
    const { env, cam, aspect } = setSceneUniforms(p);
    const t = p * SIM.duration;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.018, 0.010, 0.008, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    // sky
    gl.useProgram(progSky.p);
    gl.uniform1f(progSky.u.uP, p);
    gl.uniform1f(progSky.u.uTime, t);
    gl.uniform3fv(progSky.u.uFogColor, env.fog);
    gl.uniform3fv(progSky.u.uRune, env.rune);
    gl.bindVertexArray(emptyVAO);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    // distant eclipse / ritual gate
    gl.useProgram(progDisc.p);
    gl.uniformMatrix4fv(progDisc.u.uVP, false, vp);
    gl.uniform3fv(progDisc.u.uCenter, [0, 22, -72]);
    gl.uniform1f(progDisc.u.uSize, 14.0);
    gl.uniform3fv(progDisc.u.uColor, mix3(mix3([1.0, 0.5, 0.2], [0.25, 0.9, 0.8], env.a1), [1.0, 0.25, 0.08], env.a2));
    gl.uniform1f(progDisc.u.uTime, t);
    gl.bindVertexArray(discVAO);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // monoliths
    gl.useProgram(progMono.p);
    gl.uniformMatrix4fv(progMono.u.uVP, false, vp);
    gl.uniform3fv(progMono.u.uCam, cam.pos);
    gl.uniform3fv(progMono.u.uFogColor, env.fog);
    gl.uniform3fv(progMono.u.uRune, env.rune);
    gl.uniform1f(progMono.u.uFog, 0.014 + env.a2 * 0.008);
    gl.uniform1f(progMono.u.uTime, t);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.bindVertexArray(monoVAO);
    gl.drawElementsInstanced(gl.TRIANGLES, CUBE.idx.length, gl.UNSIGNED_SHORT, 0, MONO_COUNT);

    // ground
    gl.useProgram(progGround.p);
    gl.uniformMatrix4fv(progGround.u.uVP, false, vp);
    gl.uniform3fv(progGround.u.uCam, cam.pos);
    gl.uniform3fv(progGround.u.uFogColor, env.fog);
    gl.uniform3fv(progGround.u.uRune, env.rune);
    gl.uniform1f(progGround.u.uFog, 0.015);
    gl.uniform1f(progGround.u.uTime, t);
    gl.uniform1f(progGround.u.uP, p);
    gl.uniform1f(progGround.u.uSigil, env.sigil);
    gl.uniform1f(progGround.u.uPortal, env.portal);
    const samples = [0, 1, 2].map((i) => sampleDie(i, p));
    gl.uniform3fv(progGround.u.uDicePos0, samples[0].pos);
    gl.uniform3fv(progGround.u.uDicePos1, samples[1].pos);
    gl.uniform3fv(progGround.u.uDicePos2, samples[2].pos);
    gl.uniform3fv(progGround.u.uDiceCol0, DICE[0].aura);
    gl.uniform3fv(progGround.u.uDiceCol1, DICE[1].aura);
    gl.uniform3fv(progGround.u.uDiceCol2, DICE[2].aura);
    gl.uniform1f(progGround.u.uAura0, samples[0].aura);
    gl.uniform1f(progGround.u.uAura1, samples[1].aura);
    gl.uniform1f(progGround.u.uAura2, samples[2].aura);
    const iT = new Float32Array(8);
    const iS = new Float32Array(8);
    const iPos = new Float32Array(24);
    impactsForShader.forEach((im, i) => {
      iT[i] = im.t;
      iS[i] = im.s;
      iPos[i*3] = im.pos[0]; iPos[i*3+1] = im.pos[1]; iPos[i*3+2] = im.pos[2];
    });
    gl.uniform1fv(progGround.u.uImpactT, iT);
    gl.uniform1fv(progGround.u.uImpactS, iS);
    gl.uniform3fv(progGround.u.uImpactPos, iPos);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(groundVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // volumetric light shafts
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(progBeam.p);
    gl.uniformMatrix4fv(progBeam.u.uVP, false, vp);
    gl.uniform1f(progBeam.u.uTime, t);
    gl.uniform3fv(progBeam.u.uColor, mix3(mix3([1.0,0.5,0.22],[0.22,0.9,0.8], env.a1),[1.0,0.3,0.1], env.a2));
    gl.uniform1f(progBeam.u.uOpacity, 0.10);
    gl.bindVertexArray(beamVAO);
    BEAMS.forEach((b) => {
      gl.uniform3f(progBeam.u.uCenter, b.x, 0, b.z);
      gl.uniform2f(progBeam.u.uSize, b.w, b.h);
      gl.uniform1f(progBeam.u.uSlant, b.slant);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });

    // transparent magic is drawn before the opaque dice so the dice stay crisp
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    const fwd = vNorm(vSub(cam.target, cam.pos));
    const right = vNorm(vCross(fwd, [0, 1, 0]));
    const up = vCross(right, fwd);

    gl.useProgram(progAura.p);
    gl.uniformMatrix4fv(progAura.u.uVP, false, vp);
    gl.uniform3fv(progAura.u.uRight, right);
    gl.uniform3fv(progAura.u.uUp, up);
    gl.bindVertexArray(auraVAO);

    // portal energy field
    if (env.portal > 0.01) {
      gl.useProgram(progPortalDisc.p);
      gl.uniformMatrix4fv(progPortalDisc.u.uVP, false, vp);
      gl.uniform3fv(progPortalDisc.u.uCenter, [0, 4.2, -12.04]);
      gl.uniform1f(progPortalDisc.u.uSize, 3.7);
      gl.uniform3fv(progPortalDisc.u.uColorA, mix3([0.12, 0.6, 0.55], [0.9, 0.25, 0.06], env.a2));
      gl.uniform3fv(progPortalDisc.u.uColorB, mix3([1.0, 0.55, 0.2], [1.0, 0.18, 0.04], env.a2));
      gl.uniform1f(progPortalDisc.u.uTime, t);
      gl.uniform1f(progPortalDisc.u.uPower, env.portal);
      gl.bindVertexArray(discVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // portal glow
    if (env.portal > 0.01) {
      gl.useProgram(progAura.p);
      gl.uniform3fv(progAura.u.uCenter, [0, 4.2, -12.0]);
      gl.uniform1f(progAura.u.uSize, 9.5);
      gl.uniform3fv(progAura.u.uColor, mix3([0.2, 0.85, 0.75], [1.0, 0.4, 0.1], env.a2));
      gl.uniform1f(progAura.u.uIntensity, env.portal * 0.32);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // portal ring
    if (env.portal > 0.01) {
      gl.useProgram(progPortal.p);
      gl.uniformMatrix4fv(progPortal.u.uVP, false, vp);
      gl.uniform3fv(progPortal.u.uCenter, [0, 4.2, -12.0]);
      gl.uniform3fv(progPortal.u.uColorA, mix3([0.25, 0.9, 0.8], [1.0, 0.45, 0.12], env.a2));
      gl.uniform3fv(progPortal.u.uColorB, mix3([0.9, 0.55, 0.2], [0.9, 0.12, 0.04], env.a2));
      gl.uniform1f(progPortal.u.uTime, t);
      gl.uniform1f(progPortal.u.uPower, env.portal * 0.85);
      gl.uniform3fv(progPortal.u.uCam, cam.pos);
      gl.bindVertexArray(portalVAO);
      gl.drawElements(gl.TRIANGLES, PORTAL.idx.length, gl.UNSIGNED_INT, 0);
    }

    // dice halos, behind the dice
    gl.useProgram(progAura.p);
    gl.uniformMatrix4fv(progAura.u.uVP, false, vp);
    gl.uniform3fv(progAura.u.uRight, right);
    gl.uniform3fv(progAura.u.uUp, up);
    gl.bindVertexArray(auraVAO);
    for (let i = 0; i < 3; i += 1) {
      const s = sampleDie(i, p);
      const die = DICE[i];
      gl.uniform3fv(progAura.u.uCenter, s.pos);
      gl.uniform1f(progAura.u.uSize, die.scale * (2.5 + s.aura * 0.8));
      gl.uniform3fv(progAura.u.uColor, die.aura);
      gl.uniform1f(progAura.u.uIntensity, (0.1 + s.aura * 0.12) * (i === 1 ? 0.65 : 1.0));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // dice
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(progDice.p);
    gl.uniformMatrix4fv(progDice.u.uVP, false, vp);
    gl.uniform3fv(progDice.u.uCam, cam.pos);
    gl.uniform3fv(progDice.u.uFogColor, env.fog);
    gl.uniform1f(progDice.u.uFog, 0.012);
    gl.uniform1f(progDice.u.uTime, t);
    gl.uniform3fv(progDice.u.uKey, env.key);
    gl.uniform3fv(progDice.u.uRim, env.rim);
    for (let i = 0; i < 3; i += 1) {
      const die = DICE[i];
      const gpu = diceGPU[i];
      const s = sampleDie(i, p);
      const model = m4FromQuatPosScale(s.q, s.pos, die.scale);
      const normal = m3FromQuat(s.q);
      gl.uniformMatrix4fv(progDice.u.uModel, false, model);
      gl.uniformMatrix3fv(progDice.u.uNormal, false, normal);
      gl.uniform3fv(progDice.u.uBase, die.base);
      gl.uniform3fv(progDice.u.uAccent, die.accent);
      gl.uniform3fv(progDice.u.uNumColor, die.numberColor);
      gl.uniform3fv(progDice.u.uAuraColor, die.aura);
      const auraScale = i === 1 ? 0.55 : i === 2 ? 0.9 : 1.0;
      gl.uniform1f(progDice.u.uAura, s.aura + Math.sin(p * 28 + i * 2.1) * 0.08);
      gl.uniform1f(progDice.u.uAuraScale, auraScale);
      gl.uniform1f(progDice.u.uTint, i === 1 ? 0.62 : i === 2 ? 0.42 : 0.18);
      gl.uniform1f(progDice.u.uSeed, i * 3.7);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gpu.atlasTex);
      gl.uniform1i(progDice.u.uAtlas, 0);
      gl.bindVertexArray(gpu.vao);
      gl.drawArrays(gl.TRIANGLES, 0, gpu.geom.count);
    }

    // particles need additive blending again
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    // embers
    gl.useProgram(progParticle.p);
    gl.uniformMatrix4fv(progParticle.u.uVP, false, vp);
    gl.uniform1f(progParticle.u.uTime, t);
    gl.uniform3fv(progParticle.u.uCam, cam.pos);
    gl.bindVertexArray(particleVAO);
    gl.drawArrays(gl.POINTS, 0, EMBER_COUNT);

    // sparks
    gl.useProgram(progSpark.p);
    gl.uniformMatrix4fv(progSpark.u.uVP, false, vp);
    gl.uniform1f(progSpark.u.uTime, t);
    gl.uniform3fv(progSpark.u.uCam, cam.pos);
    gl.bindVertexArray(sparkVAO);
    gl.drawArrays(gl.POINTS, 0, sparks.count);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // bloom
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFA);
    gl.viewport(0, 0, bloomW, bloomH);
    gl.useProgram(progBright.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(progBright.u.uTex, 0);
    gl.uniform1f(progBright.u.uThreshold, 0.62);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFB);
    gl.useProgram(progBlur.p);
    gl.bindTexture(gl.TEXTURE_2D, bloomA);
    gl.uniform1i(progBlur.u.uTex, 0);
    gl.uniform2f(progBlur.u.uDir, 1 / bloomW, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFA);
    gl.bindTexture(gl.TEXTURE_2D, bloomB);
    gl.uniform2f(progBlur.u.uDir, 0, 1 / bloomH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComposite.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(progComposite.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomA);
    gl.uniform1i(progComposite.u.uBloom, 1);
    gl.uniform1f(progComposite.u.uBloomStrength, 0.42);
    gl.uniform1f(progComposite.u.uFlash, env.flash);
    gl.uniform1f(progComposite.u.uP, p);
    gl.uniform3fv(progComposite.u.uHaze, mix3(env.fog, env.rune, 0.25));
    gl.uniform2f(progComposite.u.uRes, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  /* ── loop / lifecycle ─────────────────────────────────────── */
  function frame(now) {
    if (!running) return;
    if (!lastTime) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const target = REDUCED ? 0.84 : getScrollP();
    pSmooth = REDUCED ? target : pSmooth + (target - pSmooth) * (1 - Math.exp(-dt * 9));
    updateUI(pSmooth);
    drawScene(pSmooth);
    if (!REDUCED && Math.abs(target - pSmooth) < 0.00035) {
      idleFrames += 1;
      if (idleFrames > 2) {
        running = false;
        raf = 0;
        return;
      }
    } else {
      idleFrames = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function setupObservers() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        visible = e.isIntersecting;
        if (visible && !REDUCED) start();
        else if (!visible) stop();
      });
    }, { threshold: 0.01 });
    io.observe(hero);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else if (visible && !REDUCED) start();
    });
  }

  function init() {
    resize();
    updateUI(REDUCED ? 0.84 : 0);
    drawScene(REDUCED ? 0.84 : 0);
    hero.classList.add('is-scene-ready');
    window.addEventListener('scroll', () => {
      if (visible && !REDUCED) start();
    }, { passive: true });
    setupObservers();
    if (REDUCED) {
      updateUI(0.84);
      drawScene(0.84);
    } else {
      start();
    }
    window.addEventListener('resize', () => {
      resize();
      if (REDUCED) drawScene(0.84);
      else start();
    });
  }

  // Wait for the display font to be ready so engraved numbers use Unbounded.
  const fontReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
    // rebuild atlases with the real font
    diceGPU.forEach((gpu) => {
      gl.deleteTexture(gpu.atlasTex);
      const atlas = makeAtlasCanvas(gpu.die);
      gpu.atlasTex = makeTexture(atlas.cv.width, atlas.cv.height, atlas.cv, { mip: true });
    });
    init();
  }).catch(() => {
    hero.classList.remove('is-scene-ready');
    hero.classList.add('no-scene');
  });
  }

  function waitForBoot() {
    if (document.body.classList.contains('is-booted') || REDUCED) {
      requestAnimationFrame(startScene);
    } else {
      setTimeout(waitForBoot, 100);
    }
  }
  waitForBoot();
})();
