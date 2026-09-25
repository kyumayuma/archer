/* =========================================================
   CabinGL — 機内の窓をWebGLで描画（ヒーロー用）
   窓まわりを曲面として扱い、1画素ごとに光の当たり方を計算します。
   ・太い外枠と、ガラスへ向かう3段の細い段差
   ・上部のブラインド収納部
   ・窓の右外から差し込む夕日が、左側の内張りと壁を照らす
   ・閉じたブラインドは夕日で透けて光る
   ========================================================= */
(function () {
  'use strict';

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uView;
uniform vec2 uCenter;
uniform vec2 uAB;
uniform vec2 uOut;
uniform float uZoom;
uniform float uLight;
uniform float uBlind;
uniform float uBlindY;
uniform float uTime;

const float NO = 3.6;
const float NW = 3.1;
const vec3 SUN = vec3(1.0, 0.7, 0.47);
const vec3 SKYL = vec3(0.86, 0.62, 0.62);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float se(vec2 q, vec2 ax, float n) {
  vec2 t = abs(q) / ax;
  return pow(pow(t.x, n) + pow(t.y, n), 1.0 / n);
}
// 内張りの位置：0＝ガラス側、1＝壁との境目
float kOf(vec2 q) {
  float ri = se(q, uAB * vec2(1.06, 1.045), NO);
  float ro = se(q, uOut, NW);
  return (ri - 1.0) / max(ri - ro, 1e-4);
}
// 内張りの断面：すり鉢状の面＋ガラス側の3段の段差＋太い外枠のふくらみ
float hOf(float k) {
  float kk = clamp(k, 0.0, 1.0);
  float base = -pow(1.0 - kk, 1.5);
  // ガラス側の3段の段差（なめらかな波形で、細い線がちらつかないように）
  float lin = clamp((kk - 0.04) / 0.46, 0.0, 1.0);
  float env = sin(lin * 3.14159);
  float terr = -sin(lin * 6.28318 * 3.0) * 0.022 * env;
  float ridge = 0.0;
  float bezel = 0.15 * exp(-pow((kk - 0.67) / 0.17, 2.0));
  float roll = -0.06 * smoothstep(0.88, 1.0, kk);
  return base + terr + ridge + bezel + roll;
}
vec4 over(vec4 dst, vec3 c, float a) {
  return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}
float boxSdf(vec2 p, vec2 hs, float r) {
  vec2 d = abs(p) - hs + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 q = (p - uCenter) / uZoom;
  float px = 1.0 / uZoom;
  float a = uAB.x;
  float b = uAB.y;
  float ow = 2.0 * a;
  float oh = 2.0 * b;
  float zf = clamp((uZoom - 1.0) / 1.6, 0.0, 1.0);
  // ブラインドが閉じていても、夕日は少し透けて入る
  float lo = 0.14 + 0.86 * uLight;

  float rOpen = se(q, uAB, NO);
  float aa = abs(se(q + vec2(px, 0.0), uAB, NO) - rOpen) + abs(se(q + vec2(0.0, px), uAB, NO) - rOpen) + 1e-5;
  float glass = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, rOpen);
  float rCh = se(q, uAB * vec2(1.04, 1.03), NO);
  float ro = se(q, uOut, NW);

  /* ---- 内張りの面 ---- */
  float k = kOf(q);
  float e = max(px, 0.35);
  vec2 gk = vec2(kOf(q + vec2(e, 0.0)) - k, kOf(q + vec2(0.0, e)) - k) / e;
  float depth = 0.72 * a;
  float dhdk = (hOf(k + 0.003) - hOf(k - 0.003)) / 0.006;
  float inL = step(0.0, k) * step(k, 1.0);
  vec3 n = normalize(vec3(-dhdk * depth * gk * inL, 1.0));
  float h = hOf(clamp(k, 0.0, 1.0)) * depth * inL;
  vec3 P = vec3(q, h);

  // 窓の右外、低い位置からの夕日（左側の内張りが照らされる）
  vec3 Ls = normalize(vec3(0.95, 0.22, -0.06));
  float reach = exp(-max(k, 0.0) * 1.0);
  float difS = max(dot(n, Ls), 0.0) * reach;
  float specS = pow(max(dot(n, normalize(Ls + vec3(0.0, 0.0, 1.0))), 0.0), 26.0) * reach;
  // 窓から入る空の光
  vec3 Lw = vec3(0.0, 0.0, -0.3 * depth) - P;
  float dw = length(Lw);
  float att = 1.0 / (1.0 + pow(dw / (a * 0.95), 2.0));
  float difW = max(dot(n, Lw / dw), 0.0) * att;
  // 機内のほのかな明かり
  float difC = max(dot(n, normalize(vec3(-0.3, -0.8, 0.5))), 0.0);

  float lin = clamp((k - 0.04) / 0.46, 0.0, 1.0);
  float groove = 1.0 - 0.14 * (0.5 + 0.5 * cos(lin * 6.28318 * 3.0)) * sin(lin * 3.14159);
  float ao = mix(0.25, 1.0, smoothstep(-0.01, 0.06, k)) * groove * (1.0 - 0.35 * exp(-pow((k - 0.99) / 0.025, 2.0)));
  vec3 alb = vec3(0.92, 0.82, 0.74) * (0.975 + 0.05 * noise(q * 0.9));
  vec3 lining = alb * (0.05
      + SUN * difS * 4.4 * lo
      + SKYL * difW * 1.7 * lo
      + SKYL * 0.08 * lo
      + vec3(1.0, 0.82, 0.66) * difC * 0.07) * ao;
  lining += SUN * specS * 0.5 * lo;

  // 壁：細かな布地、窓の左に夕日の光だまり
  float dOut = max(ro - 1.0, 0.0);
  float fabric = 0.9 + 0.12 * hash12(floor(p * 1.1)) + 0.08 * (noise(p * 0.35) - 0.5);
  vec3 wallAlb = vec3(0.32, 0.25, 0.24) * fabric;
  float rp = se(q - vec2(-1.62 * a, 0.12 * b), vec2(0.58 * a, 1.05 * b), 2.4);
  float patch = (1.0 - smoothstep(0.45, 1.05, rp)) * lo;
  float wallAO = (1.0 - 0.6 * exp(-dOut * 16.0)) * (1.0 - 0.3 * exp(-max(se(q - vec2(0.0, 0.05 * b), uOut, NW) - 1.0, 0.0) * 9.0));
  vec3 wall = wallAlb * (0.025 + SUN * patch * 1.5 + SKYL * 0.32 * exp(-dOut * 3.2) * lo) * wallAO;

  vec3 surf = mix(lining, wall, smoothstep(0.995, 1.005, k));
  surf = 1.0 - exp(-surf * 1.4);
  // ブラインドの溝
  float chan = step(k, 0.0);
  surf = mix(surf, vec3(0.02, 0.016, 0.016) + SUN * 0.06 * lo * exp(-max(rOpen - 1.0, 0.0) / 0.012), chan);
  vec4 opaque = vec4(surf, 1.0);

  /* ---- ガラス ---- */
  vec4 gv = vec4(0.0);
  gv = over(gv, vec3(0.05, 0.03, 0.04), smoothstep(0.8, 1.0, rOpen) * 0.35);
  float ring = exp(-pow((rOpen - 0.955) / 0.005, 2.0));
  gv = over(gv, vec3(1.0, 0.92, 0.88), ring * 0.14 * lo);
  gv = over(gv, vec3(0.95, 0.85, 0.85), 0.035);
  float refl = exp(-pow((q.x * 0.72 + q.y * 0.7 + a * 0.3) / (a * 0.14), 2.0)) * step(rOpen, 0.94);
  gv = over(gv, vec3(1.0, 0.96, 0.92), refl * 0.045);
  float hole = smoothstep(ow * 0.009, ow * 0.005, length(q - vec2(0.0, b * 0.84)));
  gv = over(gv, vec3(0.1, 0.06, 0.06), hole * 0.5);

  /* ---- ブラインド ---- */
  float top = -1.03 * b;
  float yb = uBlindY;
  float lipH = oh * 0.045;
  float inBlind = step(rCh, 1.0) * step(q.y, yb);
  float shT = clamp((q.y - yb) / (oh * 0.08), 0.0, 1.0);
  gv = over(gv, vec3(0.04, 0.02, 0.03), step(rCh, 1.0) * step(yb, q.y) * (1.0 - shT) * (1.0 - shT) * 0.55);

  vec4 col = mix(opaque, gv, glass);

  if (inBlind > 0.5) {
    float edge = 1.0 - rCh;
    // ガラスを覆っている間は夕日で透け、収納部に入ると暗くなる
    float cover = clamp((yb - top) / (oh * 0.5), 0.0, 1.0);
    float trans = mix(0.1, 0.62, cover);
    float leak = exp(-edge / 0.014) * 0.5 * cover;
    vec3 balb = vec3(0.8, 0.7, 0.66) * (0.975 + 0.05 * noise(q * 0.7));
    float vgrad = clamp((q.y - top) / max(yb - top, 1.0), 0.0, 1.0);
    vec3 bc = balb * (0.04 + SUN * trans * (0.75 + 0.25 * vgrad) + SKYL * 0.05);
    bc *= mix(0.5, 1.0, smoothstep(0.0, 0.1, edge));
    bc += SUN * leak;
    float lv = clamp((q.y - (yb - lipH)) / lipH, 0.0, 1.0);
    vec3 lipC = vec3(0.4, 0.32, 0.3) * (0.25 + 0.75 * (1.0 - lv)) * (0.35 + 0.5 * lo);
    lipC += vec3(1.0, 0.9, 0.82) * exp(-lv / 0.08) * 0.16 * lo;
    lipC += SUN * exp(-(1.0 - lv) / 0.15) * 0.3 * lo * uBlind;
    bc = mix(bc, lipC, step(yb - lipH, q.y));
    float hd = boxSdf(q - vec2(0.0, yb - lipH * 0.5), vec2(ow * 0.13, lipH * 0.22), lipH * 0.22);
    float hm = 1.0 - smoothstep(-px, px, hd);
    bc = mix(bc, vec3(0.13, 0.1, 0.09) + vec3(1.0, 0.9, 0.8) * 0.18 * smoothstep(0.0, -lipH * 0.1, hd) * step(q.y, yb - lipH * 0.55), hm);
    float bAA = 1.0 - smoothstep(yb - px, yb + px, q.y);
    col = mix(col, vec4(bc, 1.0), bAA * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, rCh)));
  }

  // 窓のまわりのやわらかな光
  float halo = exp(-max(rOpen - 1.0, 0.0) * 6.0) * 0.06 * lo * (1.0 - glass) * (1.0 - zf);
  col.rgb += SKYL * halo * col.a;

  // 周辺減光（参考写真のように周囲は暗く落とす）
  vec2 vv = (p / uView - 0.5) * vec2(1.15, 1.0);
  float vig = smoothstep(0.85, 0.18, length(vv));
  col = over(col, vec3(0.0), (1.0 - vig) * 0.8 * (1.0 - zf));

  col.rgb = min(col.rgb, vec3(col.a));
  gl_FragColor = col;
}
`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[cabin-gl] shader error', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  // ブラインド下端の位置（0＝閉じている、1＝上がりきっている）
  function blindBottom(b, oh, t) {
    const top = -1.03 * b;
    const closed = top + 2.06 * b + 2;
    const open = top + oh * 0.11;
    return closed + (open - closed) * t;
  }

  class CabinGL {
    constructor(canvas) {
      this.canvas = canvas;
      this.state = { zoom: 1, blind: 0, light: 0 };
      this.ok = false;
      this.geo = null;
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!gl) return;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      ['uRes', 'uDpr', 'uView', 'uCenter', 'uAB', 'uOut', 'uZoom', 'uLight', 'uBlind', 'uBlindY', 'uTime']
        .forEach((nm) => { this.u[nm] = gl.getUniformLocation(prog, nm); });
      this.gl = gl;
      this.ok = true;
    }

    resize(stageH) {
      const W = this.canvas.clientWidth || window.innerWidth;
      const H = this.canvas.clientHeight || window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(W * this.dpr);
      this.canvas.height = Math.round(H * this.dpr);
      this.W = W;
      this.H = H;
      this.geo = window.Cabin.geometry(W, H, stageH || H);
    }

    get sEnd() { return this.geo ? this.geo.sEnd : 8; }

    set(p) { Object.assign(this.state, p); }

    draw(time) {
      if (!this.ok || !this.geo) return;
      this.render(this.canvas.width, this.canvas.height, this.dpr, this.W, this.H, this.geo, this.state, time);
    }

    render(cw, ch, dpr, W, H, g, st, time) {
      const gl = this.gl;
      const u = this.u;
      gl.viewport(0, 0, cw, ch);
      gl.uniform2f(u.uRes, cw, ch);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform2f(u.uView, W, H);
      gl.uniform2f(u.uCenter, g.cx, g.cy);
      gl.uniform2f(u.uAB, g.a, g.b);
      gl.uniform2f(u.uOut, g.A, g.B);
      gl.uniform1f(u.uZoom, st.zoom);
      gl.uniform1f(u.uLight, st.light);
      gl.uniform1f(u.uBlind, st.blind);
      gl.uniform1f(u.uBlindY, blindBottom(g.b, g.oh, st.blind));
      gl.uniform1f(u.uTime, time || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // サービス紹介の画像用に、別の大きさで1枚描き出す
    renderTo(target, g, st, time) {
      if (!this.ok) return false;
      const sw = this.canvas.width;
      const sh = this.canvas.height;
      this.canvas.width = target.width;
      this.canvas.height = target.height;
      this.render(target.width, target.height, 1, target.width, target.height, g, st, time);
      target.getContext('2d').drawImage(this.canvas, 0, 0);
      this.canvas.width = sw;
      this.canvas.height = sh;
      return true;
    }
  }

  window.CabinGL = CabinGL;
})();
