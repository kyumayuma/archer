/* =========================================================
   Cabin — 機内の壁・窓枠・ブラインドをCanvas 2Dで描画
   zoom  : 窓の中心を基準にした拡大率（窓を抜けて外へ出る演出）
   blind : 0＝閉じている / 1＝上がりきっている（初回アニメーション）
   light : ブラインドが開いて月明かりが差し込む量
   ========================================================= */
(function () {
  'use strict';

  const N = 3.3; // 窓の角の丸み（スーパー楕円の指数）

  function se(ctx, cx, cy, a, b, n, seg) {
    seg = seg || 88;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = cy + b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * t);
  const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a == null ? 1 : a})`;

  // 内張り（ライニング）の断面に沿った色：外周 → 窓際
  const LIT = [
    [0.0, hex('#6f6456')],
    [0.12, hex('#b3a58d')],
    [0.3, hex('#8c806d')],
    [0.62, hex('#5b5245')],
    [0.9, hex('#453d33')],
    [1.0, hex('#7a6f5e')]
  ];
  const SHADE = [
    [0.0, hex('#2c261f')],
    [0.12, hex('#4d443a')],
    [0.3, hex('#3a332b')],
    [0.62, hex('#27221c')],
    [0.9, hex('#1b1814')],
    [1.0, hex('#2a251f')]
  ];
  function profile(stops, k) {
    for (let i = 1; i < stops.length; i++) {
      if (k <= stops[i][0]) {
        const t = (k - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        return mix(stops[i - 1][1], stops[i][1], t);
      }
    }
    return stops[stops.length - 1][1];
  }

  class Cabin {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.state = { zoom: 1, blind: 0, light: 0 };
      this.dirty = true;
      this.geo = null;
    }

    // stageH：ヒーローの表示領域の高さ（スマートフォンのアドレスバー対策）
    resize(stageH) {
      const W = this.canvas.clientWidth || window.innerWidth;
      const H = this.canvas.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.geo = Cabin.geometry(W, H, stageH || H);
      this.W = W; this.H = H; this.dpr = dpr;
      this.dirty = true;
    }

    static geometry(W, H, stageH) {
      const mobile = W < 768;
      let ow = mobile ? W * 0.6 : Math.min(Math.max(W * 0.21, 210), 380);
      let oh = ow * 1.36;
      const maxH = stageH * (mobile ? 0.5 : 0.56);
      if (oh > maxH) { oh = maxH; ow = oh / 1.36; }
      const cx = W / 2;
      const cy = stageH * (mobile ? 0.5 : 0.53);
      const a = ow / 2;
      const b = oh / 2;
      // 画面の四隅がすべて窓の内側に入る拡大率
      let need = 1;
      [[0, 0], [W, 0], [0, H], [W, H]].forEach(([x, y]) => {
        const dx = Math.abs(x - cx) / a;
        const dy = Math.abs(y - cy) / b;
        need = Math.max(need, Math.pow(Math.pow(dx, N) + Math.pow(dy, N), 1 / N));
      });
      return { cx, cy, ow, oh, a, b, A: a * 1.5, B: b * 1.42, sEnd: need * 1.06 };
    }

    get sEnd() { return this.geo ? this.geo.sEnd : 8; }

    set(p) {
      const s = this.state;
      if (p.zoom !== s.zoom || p.blind !== s.blind || p.light !== s.light) {
        Object.assign(s, p);
        this.dirty = true;
      }
    }

    draw() {
      if (!this.dirty || !this.geo) return;
      this.dirty = false;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.state.zoom >= this.geo.sEnd) return;
      Cabin.paint(ctx, this.W, this.H, this.dpr, this.geo, this.state);
    }

    // 共通の描画処理（サービス紹介の静止画にも流用）
    static paint(ctx, W, H, dpr, g, st) {
      const s = st.zoom;
      const { cx, cy, a, b, A, B, ow, oh } = g;
      const open = st.blind;
      const light = st.light;
      const T = (v) => v * s * dpr; // 変形の影響を受けない値（影のぼかし）の換算

      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cx * s), dpr * (cy - cy * s));
      const x0 = cx - cx / s;
      const y0 = cy - cy / s;
      const x1 = cx + (W - cx) / s;
      const y1 = cy + (H - cy) / s;

      // 1. 機内の壁（読書灯のあたたかい光だまり）
      let gr = ctx.createRadialGradient(cx, cy - oh * 0.08, 0, cx, cy, Math.max(W, H) * 0.8);
      gr.addColorStop(0, '#3d3128');
      gr.addColorStop(0.2, '#2b231c');
      gr.addColorStop(0.42, '#181310');
      gr.addColorStop(0.72, '#0d0b09');
      gr.addColorStop(1, '#060505');
      ctx.fillStyle = gr;
      ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);

      // 月明かりが壁にこぼれる
      if (light > 0) {
        gr = ctx.createRadialGradient(cx + a * 0.2, cy + b * 0.35, 0, cx, cy, A * 2.4);
        gr.addColorStop(0, `rgba(170,178,200,${0.10 * light})`);
        gr.addColorStop(1, 'rgba(170,178,200,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }

      // 2. 窓枠の外周の影
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = T(46);
      ctx.shadowOffsetY = T(16);
      ctx.beginPath();
      se(ctx, cx, cy, A, B, N);
      ctx.fillStyle = '#3a3129';
      ctx.fill();
      ctx.restore();

      // 3. 内張り（外周から窓際へ段階的に塗り重ねる）
      const RINGS = 18;
      for (let i = 0; i < RINGS; i++) {
        const k = i / (RINGS - 1);
        const kk = 1 - Math.pow(1 - k, 1.6);
        const ea = lerp(A, a * 1.07, kk);
        const eb = lerp(B, b * 1.07, kk);
        const lit = profile(LIT, k);
        const shade = profile(SHADE, k);
        const lg = ctx.createLinearGradient(cx - ea * 0.8, cy - eb, cx + ea * 0.6, cy + eb);
        lg.addColorStop(0, rgb(lit));
        lg.addColorStop(0.5, rgb(mix(lit, shade, 0.55)));
        lg.addColorStop(1, rgb(shade));
        ctx.beginPath();
        se(ctx, cx, cy, ea, eb, N);
        ctx.fillStyle = lg;
        ctx.fill();
      }
      // 月明かりが内張りの下側を照らす
      if (light > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        gr = ctx.createRadialGradient(cx, cy + b * 0.9, 0, cx, cy + b * 0.9, A * 1.1);
        gr.addColorStop(0, `rgba(150,160,190,${0.16 * light})`);
        gr.addColorStop(1, 'rgba(150,160,190,0)');
        ctx.beginPath();
        se(ctx, cx, cy, A, B, N);
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      }
      // 外周のハイライト
      ctx.beginPath();
      se(ctx, cx, cy, A * 0.985, B * 0.985, N);
      ctx.strokeStyle = 'rgba(255,240,215,0.10)';
      ctx.lineWidth = Math.max(ow * 0.006, 0.8 / s);
      ctx.stroke();

      // 4. ブラインドが収まる溝
      ctx.beginPath();
      se(ctx, cx, cy, a * 1.04, b * 1.035, N);
      ctx.fillStyle = '#0e0c0a';
      ctx.fill();

      // 5. ガラス部分を抜いて、外の空を見せる
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      se(ctx, cx, cy, a, b, N);
      ctx.fill();
      ctx.restore();

      // 6. ガラスの質感
      ctx.save();
      ctx.beginPath();
      se(ctx, cx, cy, a, b, N);
      ctx.clip();
      // 縁の内側の影
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, b / a);
      gr = ctx.createRadialGradient(0, 0, a * 0.62, 0, 0, a * 1.04);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = gr;
      ctx.fillRect(-a * 1.2, -a * 1.2, a * 2.4, a * 2.4);
      ctx.restore();
      // 二重窓の内側パネル
      ctx.beginPath();
      se(ctx, cx, cy, a * 0.93, b * 0.95, N);
      ctx.strokeStyle = 'rgba(230,225,215,0.07)';
      ctx.lineWidth = ow * 0.006;
      ctx.stroke();
      // ブリーザーホール（内窓の小さな穴）
      ctx.beginPath();
      ctx.arc(cx, cy + b * 0.82, ow * 0.007, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();
      // ガラスへの淡い映り込み
      const rl = ctx.createLinearGradient(cx - a, cy - b, cx + a * 0.2, cy + b * 0.1);
      rl.addColorStop(0, 'rgba(255,240,220,0)');
      rl.addColorStop(0.45, 'rgba(255,240,220,0.045)');
      rl.addColorStop(0.55, 'rgba(255,240,220,0)');
      ctx.fillStyle = rl;
      ctx.fillRect(cx - a, cy - b, a * 2, b * 2);
      ctx.restore();

      // 7. ブラインド
      const top = cy - b * 1.035;
      const fullH = b * 2.07;
      const band = oh * 0.1;
      const bottom = lerp(top + fullH + 1, top + band, open);
      if (bottom > top + 0.5) {
        ctx.save();
        ctx.beginPath();
        se(ctx, cx, cy, a * 1.04, b * 1.035, N);
        ctx.clip();
        // 下のガラスに落ちる影
        if (open > 0) {
          const sh = ctx.createLinearGradient(0, bottom, 0, bottom + oh * 0.09);
          sh.addColorStop(0, 'rgba(0,0,0,0.5)');
          sh.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = sh;
          ctx.fillRect(cx - a * 1.1, bottom, a * 2.2, oh * 0.09);
        }
        // 本体
        const bg = ctx.createLinearGradient(0, top, 0, bottom);
        bg.addColorStop(0, '#9f927b');
        bg.addColorStop(0.55, '#b4a68d');
        bg.addColorStop(1, '#8e8270');
        ctx.fillStyle = bg;
        ctx.fillRect(cx - a * 1.1, top - 2, a * 2.2, bottom - top + 2);
        // 細かな横の筋
        ctx.fillStyle = 'rgba(40,30,20,0.05)';
        const step = oh * 0.034;
        for (let y = bottom - step; y > top; y -= step) ctx.fillRect(cx - a * 1.1, y, a * 2.2, oh * 0.004);
        // 左右の端をわずかに暗く
        const eg = ctx.createLinearGradient(cx - a * 1.04, 0, cx + a * 1.04, 0);
        eg.addColorStop(0, 'rgba(0,0,0,0.45)');
        eg.addColorStop(0.18, 'rgba(0,0,0,0)');
        eg.addColorStop(0.82, 'rgba(0,0,0,0)');
        eg.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = eg;
        ctx.fillRect(cx - a * 1.1, top, a * 2.2, bottom - top);
        // 下端のリップと取っ手
        const lipH = oh * 0.05;
        const lg2 = ctx.createLinearGradient(0, bottom - lipH, 0, bottom);
        lg2.addColorStop(0, '#766a58');
        lg2.addColorStop(1, '#3e362c');
        ctx.fillStyle = lg2;
        ctx.fillRect(cx - a * 1.1, bottom - lipH, a * 2.2, lipH);
        ctx.fillStyle = 'rgba(255,245,225,0.28)';
        ctx.fillRect(cx - a * 1.1, bottom - lipH, a * 2.2, Math.max(oh * 0.003, 0.6 / s));
        const hw = ow * 0.26;
        const hh = lipH * 0.46;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - hw / 2, bottom - lipH * 0.72, hw, hh, hh / 2);
        else ctx.rect(cx - hw / 2, bottom - lipH * 0.72, hw, hh);
        ctx.fillStyle = '#28221b';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,240,215,0.18)';
        ctx.fillRect(cx - hw / 2 + hh / 2, bottom - lipH * 0.72, hw - hh, Math.max(hh * 0.18, 0.5 / s));
        ctx.restore();
      }
      ctx.restore();

      // 8. 画面の周辺減光（窓を抜けるにつれて消える）
      const vz = Math.max(0, 1 - (s - 1) / 2.2);
      if (vz > 0) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const vg = ctx.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.78);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, `rgba(0,0,0,${0.55 * vz})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
  }

  window.Cabin = Cabin;
})();
