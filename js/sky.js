/* =========================================================
   Sky — 夜の雲海をWebGLで描画
   pitch   : カメラの上下角（0 付近＝水平線、-π/2＝真下の雲海）
   travel  : 前進距離（雲が流れる量）
   dark    : 座席配置図の場面へ向けて暗転する量
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
uniform float uTime;
uniform float uPitch;
uniform float uTravel;
uniform float uDark;
uniform float uExpo;
uniform float uDusk;
uniform vec3 uMoon;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6);

// 距離に応じて細部を平均値へ置き換え、遠景のちらつきを抑える
float fbm6(vec2 p, float lod) {
  float v = 0.0;
  float a = 0.5;
  float f = 1.0;
  for (int i = 0; i < 6; i++) {
    float k = clamp(1.6 - lod * f * 2.2, 0.0, 1.0);
    v += a * mix(0.5, noise(p), k);
    p = M2 * p;
    a *= 0.5;
    f *= 2.0;
  }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = M2 * p;
    a *= 0.5;
  }
  return v;
}

float gDown;

float cloudD(vec2 p, float lod) {
  vec2 w = vec2(fbm3(p * 0.55 + vec2(0.0, uTime * 0.012)),
                fbm3(p * 0.55 + vec2(5.2, 1.3 - uTime * 0.01)));
  float d = fbm6(p + (w - 0.5) * mix(1.5, 0.55, gDown) + vec2(uTime * 0.004, 0.0), lod);
  // 見下ろしたときは、もこもことした雲の頂に見えるよう起伏を強める
  float b = 1.0 - abs(noise(p * 3.1 + 7.0) * 2.0 - 1.0);
  return d + (b - 0.6) * mix(0.09 * gDown, 0.16, uDusk);
}

vec3 nightSky(vec3 rd) {
  float y = rd.y;
  float yy = max(y, 0.0);
  vec3 zen = vec3(0.005, 0.009, 0.022);
  vec3 mid = vec3(0.016, 0.032, 0.072);
  vec3 hor = vec3(0.075, 0.085, 0.115);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, yy));
  c = mix(c, zen, smoothstep(0.14, 0.8, yy));
  // 地平線にわずかに残るシャンパンゴールドの光
  float band = exp(-abs(y) * 34.0);
  vec2 hz = normalize(rd.xz + vec2(1e-5));
  float az = pow(max(dot(hz, normalize(uMoon.xz)), 0.0), 5.0);
  c += vec3(0.78, 0.55, 0.28) * band * (0.07 + 0.36 * az);
  float md = max(dot(rd, uMoon), 0.0);
  c += vec3(0.85, 0.78, 0.62) * (pow(md, 70.0) * 0.28 + pow(md, 9.0) * 0.07 + pow(md, 2.0) * 0.015);
  return c;
}

// 夕暮れの空：上は青、地平線に向かって淡く、地平線は桃色
vec3 duskSky(vec3 rd) {
  float y = rd.y;
  float yy = max(y, 0.0);
  vec3 top = vec3(0.2, 0.38, 0.66);
  vec3 mid = vec3(0.44, 0.58, 0.78);
  vec3 low = vec3(0.86, 0.72, 0.74);
  vec3 band = vec3(1.0, 0.6, 0.47);
  vec3 c = mix(low, mid, smoothstep(0.02, 0.1, yy));
  c = mix(c, top, smoothstep(0.08, 0.34, yy));
  c = mix(c, band, exp(-abs(y) * 24.0) * 0.9);
  vec2 hz = normalize(rd.xz + vec2(1e-5));
  float az = pow(max(dot(hz, normalize(vec2(0.8, 1.0))), 0.0), 6.0);
  c += vec3(0.3, 0.15, 0.06) * az * exp(-yy * 9.0);
  return c;
}

vec3 skyColor(vec3 rd) {
  return mix(nightSky(rd), duskSky(rd), uDusk);
}

float starField(vec3 rd) {
  vec2 sp = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0)));
  vec2 g = sp * 70.0;
  vec2 id = floor(g);
  vec2 fr = fract(g) - 0.5;
  float h = hash12(id);
  vec2 off = (vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5) * 0.6;
  float d = length(fr - off);
  float big = step(0.986, h);
  float small = step(0.935, h) * (1.0 - big);
  float tw = 0.6 + 0.4 * sin(uTime * (0.7 + h * 2.4) + h * 60.0);
  float s = big * smoothstep(0.17, 0.0, d) * 1.1 + small * smoothstep(0.1, 0.0, d) * 0.45;
  return s * tw * smoothstep(0.03, 0.3, rd.y);
}

vec3 cloudsColor(vec3 ro, vec3 rd, float pixA, float down) {
  // 上層の雲（月明かりを受ける雲海）
  float t = min(ro.y / max(-rd.y, 1e-3), 90.0);
  float cs = mix(0.85, 1.7, uDusk);
  vec2 p = (ro.xz + rd.xz * t) * cs;
  float lod = t * pixA * cs;
  float d = cloudD(p, lod);
  float cov = smoothstep(mix(mix(0.36, 0.42, down), 0.4, uDusk), mix(mix(0.64, 0.7, down), 0.6, uDusk), d);
  vec2 lo = normalize(mix(uMoon.xz, vec2(0.8, 1.0), uDusk)) * 0.06;
  float d2 = cloudD(p + lo, lod);
  float lit = clamp(0.55 + (d - d2) * mix(5.0, 9.0, uDusk), 0.0, 1.0);
  float thick = smoothstep(0.42, 0.88, d);
  vec3 shadowC = vec3(0.055, 0.07, 0.105);
  vec3 litC = vec3(0.64, 0.645, 0.66);
  vec3 top = mix(shadowC, litC * vec3(1.03, 1.0, 0.95), (0.18 + 0.82 * lit) * (0.35 + 0.65 * thick));
  // 月の方向に伸びる光の道
  vec3 refl = normalize(vec3(rd.x, -rd.y, rd.z));
  float glit = pow(max(dot(refl, uMoon), 0.0), 10.0);
  top += vec3(0.95, 0.80, 0.55) * glit * (0.25 + 0.6 * thick) * 0.55;
  top *= mix(1.0, 1.35, down);
  // 夕暮れ：雲の頂は桃色、影は青みがかった灰色
  vec3 duskTop = mix(vec3(0.34, 0.37, 0.56), vec3(0.98, 0.76, 0.76), (0.12 + 0.88 * lit) * (0.35 + 0.65 * thick));
  top = mix(top, duskTop, uDusk);

  // 下層の雲
  float t2 = (ro.y + 0.9) / max(-rd.y, 1e-3);
  vec2 p2 = (ro.xz + rd.xz * t2) * 0.6 + 13.7;
  float d3 = fbm6(p2, t2 * pixA * 0.6);
  float cov2 = smoothstep(0.46, 0.8, d3);

  // 雲の切れ間に見える街の灯り
  float t3 = (ro.y + 2.4) / max(-rd.y, 1e-3);
  vec2 p3 = ro.xz + rd.xz * t3;
  float cluster = smoothstep(0.54, 0.72, fbm3(p3 * 0.24 + 3.0));
  vec2 cell = p3 * 7.0;
  vec2 cid = floor(cell);
  float hh = hash12(cid);
  vec2 jit = (vec2(hash12(cid + 1.3), hash12(cid + 5.1)) - 0.5) * 0.6;
  float dl = length(fract(cell) - 0.5 - jit);
  float on = step(0.72, hh);
  float lamp = on * (smoothstep(0.14, 0.0, dl) * 2.6 + smoothstep(0.5, 0.0, dl) * 0.35);
  vec3 city = vec3(1.0, 0.68, 0.33) * (lamp * (0.5 + 0.7 * hh) + 0.13) * cluster;
  city *= exp(-t3 * 0.16) * (1.0 - uDusk);

  vec3 ground = vec3(0.008, 0.012, 0.024);
  vec3 low = mix(ground + city * (1.0 - cov2 * 0.85), vec3(0.075, 0.085, 0.11) + city * 0.12, cov2 * 0.8);

  low = mix(low, vec3(0.3, 0.32, 0.46), uDusk);
  vec3 col = mix(low, top, cov);
  float fog = 1.0 - exp(-t * mix(0.07, 0.05, uDusk));
  col = mix(col, skyColor(normalize(vec3(rd.x, 0.012, rd.z))), fog);
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float asp = uRes.x / uRes.y;
  float th = 0.62;
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  vec3 f = vec3(0.0, sp, cp);
  vec3 r = vec3(1.0, 0.0, 0.0);
  vec3 u = vec3(0.0, cp, -sp);
  vec3 rd = normalize(f + r * (uv.x * asp * th) + u * (uv.y * th));
  float down = clamp(-uPitch / 1.5708, 0.0, 1.0);
  gDown = smoothstep(0.35, 1.0, down);
  vec3 ro = vec3(0.0, mix(1.0, 0.5, uDusk) + 1.3 * down * down, uTravel);
  float pixA = 2.0 * th / uRes.y;

  vec3 col;
  if (rd.y < -0.002) {
    col = cloudsColor(ro, rd, pixA, down);
  } else {
    col = skyColor(rd);
    col += vec3(0.95, 0.92, 0.85) * starField(rd) * (1.0 - uDusk);
    float md = dot(rd, uMoon);
    float disc = smoothstep(0.99972, 0.99986, md) * (1.0 - uDusk);
    float mott = 0.9 + 0.1 * noise(rd.xy * 900.0);
    col = mix(col, vec3(1.6, 1.48, 1.22) * mott, disc);
  }

  col = mix(col, vec3(0.017, 0.015, 0.013), uDark);
  float vig = smoothstep(1.8, 0.4, length(uv * vec2(0.85, 1.0)));
  col *= mix(0.78, 1.0, vig);
  col *= 1.18 * uExpo;
  col = col / (1.0 + col * mix(0.5, 0.22, uDusk));
  col = pow(col, vec3(0.9));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[sky] shader error', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  class Sky {
    constructor(canvas) {
      this.canvas = canvas;
      this.params = { pitch: 0.055, travel: 0, dark: 0, expo: 1, dusk: 0 };
      this.quality = 0.75;
      this.ok = false;
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl) return;
      this.gl = gl;
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
      ['uRes', 'uTime', 'uPitch', 'uTravel', 'uDark', 'uExpo', 'uDusk', 'uMoon'].forEach((n) => { this.u[n] = gl.getUniformLocation(prog, n); });
      const m = [0.12, 0.2, 1];
      const ml = Math.hypot(m[0], m[1], m[2]);
      gl.uniform3f(this.u.uMoon, m[0] / ml, m[1] / ml, m[2] / ml);
      this.ok = true;
    }

    resize() {
      if (!this.ok) return;
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      const q = w < 768 ? 0.7 : this.quality;
      const cw = Math.max(2, Math.round(w * q));
      const ch = Math.max(2, Math.round(h * q));
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw;
        this.canvas.height = ch;
      }
    }

    set(p) { Object.assign(this.params, p); }

    render(time) {
      if (!this.ok) return;
      const gl = this.gl;
      const { width, height } = this.canvas;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(this.u.uRes, width, height);
      gl.uniform1f(this.u.uTime, time);
      gl.uniform1f(this.u.uPitch, this.params.pitch);
      gl.uniform1f(this.u.uTravel, this.params.travel);
      gl.uniform1f(this.u.uDark, this.params.dark);
      gl.uniform1f(this.u.uExpo, this.params.expo == null ? 1 : this.params.expo);
      gl.uniform1f(this.u.uDusk, this.params.dusk || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 別の場面（サービス紹介の画像）用に1枚だけ描き出す
    snapshot(target, params, time) {
      if (!this.ok) return false;
      const saved = { w: this.canvas.width, h: this.canvas.height, p: Object.assign({}, this.params) };
      this.canvas.width = Math.round(target.width * 0.7);
      this.canvas.height = Math.round(target.height * 0.7);
      this.set(params);
      this.render(time);
      const ctx = target.getContext('2d');
      ctx.drawImage(this.canvas, 0, 0, target.width, target.height);
      this.canvas.width = saved.w;
      this.canvas.height = saved.h;
      this.params = saved.p;
      this.render(time);
      return true;
    }
  }

  window.Sky = Sky;
})();
