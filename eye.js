/*
 * Eye — a stare drawn in characters.
 * Gurjot Singh, 2026.
 *
 * One WebGL fragment shader, no images, no libraries. The screen is cut into
 * character cells. For each cell the shader works out how bright the eye is
 * at that spot, then picks a glyph of matching weight from a strip of
 * characters drawn once into a texture. The pupil is a window onto a smaller
 * copy of the same eye, so zooming in never reaches the bottom.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('eye');
  const gl =
    canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' }) ||
    canvas.getContext('experimental-webgl');
  if (!gl) {
    document.documentElement.classList.add('no-gl', 'ready');
    return;
  }

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Characters ordered from lightest to heaviest ink
  const RAMP = ".'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

  /* ------------------------------------------------------------- shader */

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0;

  const FRAG = `
    precision ${highp ? 'highp' : 'mediump'} float;

    uniform vec2 uRes;        // canvas size, px
    uniform vec2 uCell;       // one character cell, px
    uniform float uUnit;      // px per eye-unit (the eye is 2 units wide)
    uniform float uTime;
    uniform float uF;         // how far through the current dive, 0..1
    uniform float uLevel;     // how many eyes deep we are
    uniform vec2 uGaze;       // where the iris sits, in eye-units
    uniform float uFlicker;   // glyph changes per second
    uniform float uN;         // glyphs in the atlas
    uniform sampler2D uAtlas;

    const float K = 0.08;     // each eye is this much smaller than the one holding it
    const float RP = 0.2;     // pupil radius
    const float RI = 0.5;     // iris radius

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    // 1 = open, 0 = shut. Every eye blinks on its own clock.
    float lidOpen(float lvl, float idx) {
      if (idx < 0.5) return 1.0;                       // the eye we are inside of never shuts on us
      float period = 4.0 + 2.6 * hash(vec2(lvl, 3.7));
      float ph = mod(uTime + lvl * 1.37, period);
      float o = 1.0 - smoothstep(0.0, 0.07, ph) * (1.0 - smoothstep(0.09, 0.3, ph));
      if (idx < 1.5) o = mix(o, 1.0, smoothstep(0.015, 0.1, uF));   // nor does the one we are diving into
      return o;
    }

    // Sparse drifting specks in the dark around an eye. Each lights one cell.
    float stars(vec2 l, vec2 cl, float lvl) {
      l += vec2(uTime * 0.006, uTime * 0.0035);
      const float G = 0.16;
      vec2 g = floor(l / G);
      float h = hash(g + lvl * 19.0);
      if (h > 0.2) return 0.0;
      if (max(cl.x, cl.y) > G * (0.12 + 2.2 * h)) return 0.0;      // too far away to make out yet
      vec2 sp = (g + vec2(hash(g + 4.1), hash(g + 9.3))) * G;
      vec2 dd = abs(l - sp);
      if (dd.x > cl.x * 0.5 || dd.y > cl.y * 0.5) return 0.0;
      return 0.4 + 0.5 * (0.5 + 0.5 * sin(uTime * (0.8 + 8.0 * h) + h * 90.0));
    }

    // Colour (rgb) and brightness (a) of one eye at point l, in that eye's own
    // units. Sets pup when l falls through the pupil to the next eye down.
    vec4 eye(vec2 l, float lvl, float idx, vec2 cl, out float pup) {
      pup = 0.0;
      float open = lidOpen(lvl, idx);
      float x = clamp(l.x, -1.0, 1.0);
      float s = 1.0 - x * x;
      float tilt = 0.05 * x;
      float up0 = 0.52 * pow(s, 0.68) + tilt;          // upper lid, fully open
      float lo = -0.36 * pow(s, 0.9) + tilt;           // lower lid
      float up = mix(lo + 0.03 * s, up0, open);        // upper lid right now
      bool inX = abs(l.x) < 1.0;

      vec3 col = vec3(0.0);
      float b = 0.0;

      if (inX && l.y < up && l.y > lo) {
        vec2 d = l - uGaze;
        float r = length(d);
        if (r < RP) { pup = 1.0; return vec4(0.0); }

        float shade = 1.0 - 0.55 * smoothstep(0.22, 0.0, up - l.y);   // shadow under the lid
        if (r < RI) {
          float rr = (r - RP) / (RI - RP);
          vec2 dir = d / r;
          float fibre = 0.55 * noise(dir * 9.0 + 3.0) + 0.45 * noise(dir * 26.0 + lvl);
          b = 0.5 + 0.42 * fibre + 0.12 * noise(d * 11.0);
          b += 0.22 * exp(-pow((rr - 0.2) / 0.12, 2.0));              // bright ring near the pupil
          b *= 1.0 - 0.6 * smoothstep(0.72, 1.0, rr);                 // dark rim of the iris
          b *= 0.55 + 0.45 * smoothstep(0.0, 0.1, rr);
          col = mix(vec3(1.0, 0.7, 0.26), vec3(0.86, 0.34, 0.1), rr);
          if (length(d - vec2(-0.2, 0.24)) < 0.075) {                 // catch-light
            b = 1.0 / shade;
            col = vec3(1.0, 0.97, 0.9);
          }
        } else {
          b = 0.4 - 0.18 * smoothstep(0.35, 1.0, abs(l.x)) + 0.08 * noise(l * 14.0);
          col = vec3(0.9, 0.86, 0.8);
        }
        b *= shade;
      } else {
        float dU = l.y - up, dL = lo - l.y;
        float w = max(0.034, max(cl.x, cl.y) * 0.9);                 // never thinner than a cell
        float edge = 0.0;
        if (abs(l.x) < 1.04) {
          edge = max(smoothstep(w * 1.3, w * 0.45, abs(dU)), 0.85 * smoothstep(w * 1.3, w * 0.45, abs(dL)));
        }
        float crease = 0.0;
        if (abs(l.x) < 0.93) crease = 0.4 * s * smoothstep(w, 0.0, abs(l.y - (up0 * 1.16 + 0.07)));
        float lash = 0.0;
        if (inX && dU > 0.0 && dU < 0.11) {
          float stripe = fract(l.x * 13.0 - dU * 5.0 * sign(l.x + 0.3));
          lash = 0.6 * step(0.62, stripe) * (1.0 - dU / 0.11) * smoothstep(0.0, 0.25, s);
        }
        float lid = (inX && l.y >= up && l.y < up0) ? 0.27 + 0.1 * noise(l * 9.0) : 0.0;
        float away = max(max(dU, dL), abs(l.x) - 1.0);
        float halo = 0.15 * exp(-away * away / 0.011);

        b = max(max(edge, crease), max(lash, max(lid, halo)));
        col = vec3(0.98, 0.74, 0.46);
        float st = stars(l, cl, lvl);
        if (st > b) { b = st; col = vec3(0.8, 0.82, 0.9); }
      }
      return vec4(col, b);
    }

    void main() {
      vec2 cell = floor(gl_FragCoord.xy / uCell);
      vec2 cuv = fract(gl_FragCoord.xy / uCell);
      vec2 p = ((cell + 0.5) * uCell - 0.5 * uRes) / uUnit;

      // Camera: zooms toward the pupil so that uF = 1 lands exactly on the
      // next eye, looking the way uF = 0 looked on this one.
      float sc = pow(K, uF);
      vec2 q = uGaze * (1.0 - sc) / (1.0 - K) + p * sc;

      // Start from the eye that contains the one on screen and walk inward.
      vec2 l = q * K + uGaze;
      float ls = sc * K;
      vec2 cl = uCell / uUnit;
      vec3 col = vec3(0.0);
      float b = 0.0;
      for (int i = 0; i < 4; i++) {
        float pup;
        vec4 e = eye(l, uLevel + float(i) - 1.0, float(i), cl * ls, pup);
        if (pup < 0.5) { col = e.rgb; b = e.a; break; }
        l = (l - uGaze) / K;
        ls /= K;
      }

      // Brightness to glyph. Faint areas are left mostly empty rather than
      // filled with dots, which is what gives the scattered edges.
      b = clamp(b, 0.0, 1.0);
      float h0 = hash(cell + 17.0);
      float h1 = hash(cell + floor(uTime * uFlicker) * vec2(3.1, 7.7));
      float lit = 1.0;
      if (b < 0.3) {
        lit = step(h0, b / 0.3 * 0.9);
        b = 0.22 + 0.25 * h1;
      }
      float gi = floor(clamp(b + (h1 - 0.5) * 0.14, 0.0, 1.0) * (uN - 1.0) + 0.5);
      float ink = texture2D(uAtlas, vec2((gi + cuv.x) / uN, cuv.y)).r;

      gl_FragColor = vec4(col * (0.4 + 0.75 * b) * ink * lit + vec3(0.017, 0.013, 0.01), 1.0);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'shader failed to compile');
    }
    return sh;
  }

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
  } catch (err) {
    console.error(err);
    document.documentElement.classList.add('no-gl', 'ready');
    return;
  }
  gl.useProgram(prog);

  // One oversized triangle covers the screen
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const name of ['uRes', 'uCell', 'uUnit', 'uTime', 'uF', 'uLevel', 'uGaze', 'uFlicker', 'uN', 'uAtlas']) {
    U[name] = gl.getUniformLocation(prog, name);
  }

  /* -------------------------------------------------------- glyph atlas */

  const atlas = gl.createTexture();
  let cellW = 0, cellH = 0;

  function buildAtlas() {
    const a = document.createElement('canvas');
    a.width = RAMP.length * cellW;
    a.height = cellH;
    const c = a.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, a.width, a.height);
    c.fillStyle = '#fff';
    c.font = `500 ${Math.round(cellH * 0.86)}px "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < RAMP.length; i++) c.fillText(RAMP[i], (i + 0.5) * cellW, cellH * 0.54);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* -------------------------------------------------------------- state */

  let W = 0, H = 0, DPR = 1, unit = 1;         // unit: CSS px per eye-unit
  let time = 0, last = 0;

  // Depth. Whole numbers are eyes; the fraction is how far into the next one.
  const asked = parseFloat(new URLSearchParams(window.location.search).get('z'));
  let z = Number.isFinite(asked) ? asked : 0;
  let zTo = z, zVel = 0;

  const gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  let touched = -1e9;                          // last time the visitor did anything
  let wanderAt = 0, nextDive = 0;
  let shownDepth = null;
  const depthEl = document.getElementById('depth');

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Big enough to fill the view, and big enough that the dark of the
    // enclosing pupil reaches every corner of the screen.
    unit = Math.max(Math.min(W / 3.6, H / 2.2), Math.hypot(W, H) / 2 / 2.4);

    const ch = Math.round(Math.max(10, Math.min(15, Math.min(H / 66, W / 88))) * DPR);
    const cw = Math.round(ch * 0.56);
    if (ch !== cellH || cw !== cellW) {
      cellH = ch;
      cellW = cw;
      buildAtlas();
    }
  }

  function look(clientX, clientY) {
    gaze.tx = Math.max(-0.26, Math.min(0.26, ((clientX - W / 2) / unit) * 0.3));
    gaze.ty = Math.max(-0.1, Math.min(0.12, (-(clientY - H / 2) / unit) * 0.22));
    touched = performance.now();
  }

  function dive(by) {
    zTo = (by > 0 ? Math.floor(zTo + 1e-3) : Math.ceil(zTo - 1e-3)) + by;
    touched = performance.now();
  }

  function step(dt, now) {
    const idle = now - touched;

    // Left alone, the eye looks around by itself...
    if (idle > 2500 && now > wanderAt) {
      gaze.tx = (Math.random() - 0.5) * 0.44;
      gaze.ty = (Math.random() - 0.5) * 0.18;
      wanderAt = now + 900 + Math.random() * 2400;
    }
    const snap = 1 - Math.exp(-dt * 7);
    gaze.x += (gaze.tx - gaze.x) * snap;
    gaze.y += (gaze.ty - gaze.y) * snap;

    // ...and every so often falls into itself
    if (!calm && idle > 6500 && now > nextDive) {
      zTo = Math.floor(zTo + 1e-3) + 1;
      nextDive = now + 6500;
    }

    // critically damped spring toward the requested depth
    const w = 2.6;
    zVel += ((zTo - z) * w * w - 2 * w * zVel) * dt;
    z += zVel * dt;

    const d = Math.round(z);
    if (d !== shownDepth && depthEl) {
      shownDepth = d;
      depthEl.textContent = 'Depth ' + (d < 0 ? '-' : '') + String(Math.abs(d)).padStart(2, '0');
    }
  }

  function draw() {
    const level = Math.floor(z);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uCell, cellW, cellH);
    gl.uniform1f(U.uUnit, unit * DPR);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uF, z - level);
    gl.uniform1f(U.uLevel, level);
    gl.uniform2f(U.uGaze, gaze.x, gaze.y);
    gl.uniform1f(U.uFlicker, calm ? 1.5 : 7);
    gl.uniform1f(U.uN, RAMP.length);
    gl.uniform1i(U.uAtlas, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    const dt = Math.min(0.034, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    step(dt, now);
    draw();
    requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- input */

  canvas.addEventListener('pointermove', (e) => look(e.clientX, e.clientY));
  canvas.addEventListener('pointerdown', (e) => look(e.clientX, e.clientY));
  canvas.addEventListener('click', (e) => dive(e.shiftKey ? -1 : 1));
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    dive(-1);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zTo += Math.max(-0.5, Math.min(0.5, lines * 0.0011));
      touched = performance.now();
    },
    { passive: false }
  );
  window.addEventListener('keydown', (e) => {
    if (e.target !== document.body && e.target !== canvas) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      dive(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'Backspace') {
      e.preventDefault();
      dive(-1);
    }
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => window.location.reload());

  if (window.matchMedia('(pointer: coarse)').matches) {
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'Drag to hold its gaze · Tap to fall in';
  }

  resize();
  // Redraw the glyphs once the web font has arrived
  if (document.fonts && document.fonts.load) {
    document.fonts.load('500 16px "JetBrains Mono"').then(buildAtlas).catch(() => {});
  }

  last = performance.now();
  touched = last - 1000;
  nextDive = last + 6500;
  requestAnimationFrame((now) => {
    document.documentElement.classList.add('ready');
    frame(now);
  });
})();
