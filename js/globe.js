/* =========================================================
   Globe — 点で描く地球儀（Canvas 2D）
   陸地データ：Natural Earth（world-atlas / パブリックドメイン）
   読み込めない場合は経緯線だけで描画します
   ========================================================= */
(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const HOME = [35.55, 139.78]; // 羽田
  const CITIES = [
    [51.47, -0.45], [40.64, -73.78], [49.0, 2.55], [1.36, 103.99], [25.25, 55.36],
    [21.32, -157.92], [-33.94, 151.18], [33.94, -118.4], [45.63, 8.72], [22.31, 113.91],
    [37.46, 126.44], [46.24, 6.1]
  ];

  const toVec = (lat, lon) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];

  function slerp(p, q, t) {
    const d = Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
    const w = Math.acos(d);
    if (w < 1e-4) return p.slice();
    const s = Math.sin(w);
    const k1 = Math.sin((1 - t) * w) / s;
    const k2 = Math.sin(t * w) / s;
    return [p[0] * k1 + q[0] * k2, p[1] * k1 + q[1] * k2, p[2] * k1 + q[2] * k2];
  }

  class Globe {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.points = null;
      this.rot = -HOME[1] * DEG + 0.5;
      this.tilt = 0.42;
      this.lightX = 0;
      this.targetLightX = 0;
      this.arcs = CITIES.map((c, i) => {
        const p = toVec(HOME[0], HOME[1]);
        const q = toVec(c[0], c[1]);
        const pts = [];
        const ang = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
        const lift = 0.06 + ang * 0.1;
        for (let j = 0; j <= 48; j++) {
          const t = j / 48;
          const v = slerp(p, q, t);
          const h = 1 + Math.sin(Math.PI * t) * lift;
          pts.push([v[0] * h, v[1] * h, v[2] * h]);
        }
        return { pts, phase: i / CITIES.length, speed: 0.11 + (i % 4) * 0.018, end: q };
      });
      this.home = toVec(HOME[0], HOME[1]);
      this.load();
      window.addEventListener('mousemove', (e) => {
        this.targetLightX = (e.clientX / window.innerWidth - 0.5) * 1.8;
      }, { passive: true });
    }

    async load() {
      try {
        if (!window.topojson) throw new Error('topojson not loaded');
        const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
        const topo = await res.json();
        const land = window.topojson.feature(topo, topo.objects.land);
        this.points = this.rasterize(land);
      } catch (e) {
        console.warn('[globe] 陸地データを読み込めませんでした。経緯線で表示します。', e);
        this.points = [];
      }
    }

    rasterize(geo) {
      const w = 720;
      const h = 360;
      const oc = document.createElement('canvas');
      oc.width = w;
      oc.height = h;
      const c = oc.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff';
      const feats = geo.type === 'FeatureCollection' ? geo.features : [geo];
      feats.forEach((f) => {
        const gm = f.geometry;
        const polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : [];
        polys.forEach((poly) => {
          c.beginPath();
          poly.forEach((ring) => {
            ring.forEach(([lon, lat], i) => {
              const x = ((lon + 180) / 360) * w;
              const y = ((90 - lat) / 180) * h;
              if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
            });
            c.closePath();
          });
          c.fill('evenodd');
        });
      });
      const data = c.getImageData(0, 0, w, h).data;
      const pts = [];
      const step = 1.35;
      for (let lat = -84; lat <= 84; lat += step) {
        const n = Math.max(1, Math.round((360 * Math.cos(lat * DEG)) / step));
        for (let i = 0; i < n; i++) {
          const lon = -180 + (i * 360) / n;
          const px = Math.min(w - 1, Math.floor(((lon + 180) / 360) * w));
          const py = Math.min(h - 1, Math.floor(((90 - lat) / 180) * h));
          if (data[(py * w + px) * 4 + 3] > 120) pts.push(toVec(lat, lon));
        }
      }
      return pts;
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.size = r.width || 600;
      this.dpr = dpr;
      this.canvas.width = Math.round(this.size * dpr);
      this.canvas.height = Math.round(this.size * dpr);
    }

    project(v, out) {
      const cr = Math.cos(this.rot);
      const sr = Math.sin(this.rot);
      const x = v[0] * cr + v[2] * sr;
      const z = -v[0] * sr + v[2] * cr;
      const ct = Math.cos(this.tilt);
      const st = Math.sin(this.tilt);
      const y = v[1] * ct - z * st;
      const z2 = v[1] * st + z * ct;
      out[0] = x; out[1] = y; out[2] = z2;
      return out;
    }

    render(time, dt) {
      if (!this.size) return;
      const ctx = this.ctx;
      const S = this.size * this.dpr;
      const R = S * 0.46;
      const cx = S / 2;
      const cy = S / 2;
      this.rot += dt * 0.06;
      this.lightX += (this.targetLightX - this.lightX) * Math.min(1, dt * 1.6);
      const L = [this.lightX, 0.45, 0.85];
      const ll = Math.hypot(L[0], L[1], L[2]);
      L[0] /= ll; L[1] /= ll; L[2] /= ll;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S, S);

      // 球体
      let g = ctx.createRadialGradient(cx + R * this.lightX * 0.35, cy - R * 0.3, R * 0.1, cx, cy, R);
      g.addColorStop(0, '#1d1814');
      g.addColorStop(0.7, '#0e0c0a');
      g.addColorStop(1, '#070605');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      const o = [0, 0, 0];
      // 経緯線（陸地データがない場合は主役に）
      const gridA = this.points && this.points.length ? 0.07 : 0.22;
      ctx.lineWidth = this.dpr * 0.8;
      ctx.strokeStyle = `rgba(214,191,143,${gridA})`;
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          this.project(toVec(lat, lon), o);
          if (o[2] > 0) {
            const x = cx + o[0] * R;
            const y = cy - o[1] * R;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          } else started = false;
        }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 4) {
          this.project(toVec(lat, lon), o);
          if (o[2] > 0) {
            const x = cx + o[0] * R;
            const y = cy - o[1] * R;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          } else started = false;
        }
        ctx.stroke();
      }

      // 陸地の点
      if (this.points && this.points.length) {
        const bins = [[], [], [], [], [], []];
        const pts = this.points;
        for (let i = 0; i < pts.length; i++) {
          this.project(pts[i], o);
          if (o[2] <= 0.02) continue;
          const lam = Math.max(0, o[0] * L[0] + o[1] * L[1] + o[2] * L[2]);
          const b = (0.18 + 0.82 * lam) * Math.pow(o[2], 0.35);
          const bi = Math.min(5, Math.floor(b * 6));
          bins[bi].push(cx + o[0] * R, cy - o[1] * R);
        }
        const d = this.dpr * 1.55;
        for (let k = 0; k < 6; k++) {
          const arr = bins[k];
          if (!arr.length) continue;
          const a = 0.12 + (k / 5) * 0.8;
          ctx.fillStyle = `rgba(222,200,152,${a})`;
          for (let i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i] - d / 2, arr[i + 1] - d / 2, d, d);
        }
      }

      // 輪郭光
      g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.12);
      g.addColorStop(0, 'rgba(214,191,143,0)');
      g.addColorStop(0.45, 'rgba(214,191,143,0.075)');
      g.addColorStop(1, 'rgba(214,191,143,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);

      // 航路
      ctx.lineCap = 'round';
      this.arcs.forEach((arc) => {
        const n = arc.pts.length;
        const head = ((time * arc.speed + arc.phase) % 1.4) / 1.0;
        const proj = arc.pts.map((p) => { const q = [0, 0, 0]; this.project(p, q); return q; });
        // 淡い全体線
        ctx.beginPath();
        let started = false;
        for (let j = 0; j < n; j++) {
          const q = proj[j];
          if (q[2] > -0.05) {
            const x = cx + q[0] * R;
            const y = cy - q[1] * R;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          } else started = false;
        }
        ctx.strokeStyle = 'rgba(214,191,143,0.16)';
        ctx.lineWidth = this.dpr * 0.8;
        ctx.stroke();
        // 移動する光
        const tail = 0.22;
        for (let j = 1; j < n; j++) {
          const t = j / (n - 1);
          const rel = (head - t) / tail;
          if (rel < 0 || rel > 1) continue;
          const q0 = proj[j - 1];
          const q1 = proj[j];
          if (q0[2] < -0.05 || q1[2] < -0.05) continue;
          ctx.beginPath();
          ctx.moveTo(cx + q0[0] * R, cy - q0[1] * R);
          ctx.lineTo(cx + q1[0] * R, cy - q1[1] * R);
          ctx.strokeStyle = `rgba(240,222,184,${(1 - rel) * 0.95})`;
          ctx.lineWidth = this.dpr * (0.8 + (1 - rel) * 1.2);
          ctx.stroke();
        }
        // 到着地
        this.project(arc.end, o);
        if (o[2] > 0) {
          ctx.beginPath();
          ctx.arc(cx + o[0] * R, cy - o[1] * R, this.dpr * 2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(234,220,188,0.9)';
          ctx.fill();
        }
      });
      // 拠点（羽田）
      this.project(this.home, o);
      if (o[2] > 0) {
        const x = cx + o[0] * R;
        const y = cy - o[1] * R;
        const pulse = (time * 0.8) % 1;
        ctx.beginPath();
        ctx.arc(x, y, this.dpr * (3 + pulse * 14), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(234,220,188,${0.6 * (1 - pulse)})`;
        ctx.lineWidth = this.dpr;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, this.dpr * 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f3e6c7';
        ctx.fill();
      }
    }
  }

  window.Globe = Globe;
})();
