/* =========================================================
   ARCHER — 演出の制御
   ・初回演出（プリローダー → ブラインドが上がる）は時間で進むアニメーション
   ・それ以降の場面転換はすべてスクロール量から計算（上に戻ると同じ状態に戻る）
   ========================================================= */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  root.classList.add('js');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (v, a, b) => clamp((v - a) / (b - a));
  const E = {
    sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in2: (t) => t * t
  };

  // 変更があったときだけスタイルを書き換える
  const tf = (el, v) => { if (el && el._tf !== v) { el.style.transform = v; el._tf = v; } };
  const op = (el, v) => { if (!el) return; v = Math.round(v * 1000) / 1000; if (el._op !== v) { el.style.opacity = v; el._op = v; } };
  const vis = (el, on) => { if (el && el._vis !== on) { el.style.visibility = on ? 'visible' : 'hidden'; el._vis = on; } };

  function splitChars(el) {
    const text = el.textContent;
    el.textContent = '';
    const chars = [];
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      el.appendChild(s);
      chars.push(s);
    }
    return chars;
  }

  /* ---------- 要素 ---------- */
  const els = {
    hero: $('.hero'), heroStage: $('.hero__stage'),
    about: $('.about'), statement: $('[data-highlight]'),
    flight: $('.flight'), flightStage: $('.flight__stage'),
    global: $('.global'), globalStage: $('.global__stage'),
    skyCanvas: $('#sky'), cabinCanvas: $('#cabin'),
    jet: $('#jet'), jetClip: $('#jetClip'), jetClipInner: $('#jetClipInner'), jetShadow: $('.jet__shadow'), navlights: $$('.navlight'),
    plan: $('#plan'), planClip: $('#planClip'), planClipInner: $('#planClipInner'), scan: $('#scanline'), grid: $('.flight__grid'),
    titles: $('#flightTitles'), specs: $$('[data-spec]'), legend: $$('#legend li'),
    logo: $('#logo'), header: $('#header'), cta: $('#cta'),
    heroL: $$('[data-hero="l"]'), heroR: $$('[data-hero="r"]'),
    giant: $('#giant'), globeWrap: $('#globeWrap'), words: $('.global__words'), footer: $('#footer')
  };

  /* ---------- 描画モジュール ---------- */
  const sky = new window.Sky(els.skyCanvas);
  // 窓はWebGLで描画し、使えない環境ではCanvas 2Dで描画する
  let cabin = window.CabinGL ? new window.CabinGL(els.cabinCanvas) : null;
  const cabinIsGL = !!(cabin && cabin.ok);
  if (!cabinIsGL) {
    if (cabin) {
      const fresh = els.cabinCanvas.cloneNode(false);
      els.cabinCanvas.replaceWith(fresh);
      els.cabinCanvas = fresh;
    }
    cabin = new window.Cabin(els.cabinCanvas);
  }
  const globe = new window.Globe($('#globe'));

  /* ---------- 文字の分割 ---------- */
  const hlChars = [];
  if (els.statement) {
    const phrases = els.statement.textContent.split('|');
    els.statement.textContent = '';
    phrases.forEach((p) => {
      const w = document.createElement('span');
      w.className = 'ph';
      for (const ch of p) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        w.appendChild(s);
        hlChars.push(s);
      }
      els.statement.appendChild(w);
    });
  }
  const flightChars = $$('.ft').map(splitChars);

  $$('[data-roll-chars]').forEach((el) => {
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    [...text].forEach((ch, i) => {
      const w = document.createElement('span');
      w.className = 'ch';
      w.setAttribute('aria-hidden', 'true');
      const a = document.createElement('span');
      const b = document.createElement('span');
      a.textContent = b.textContent = ch;
      a.style.transitionDelay = b.style.transitionDelay = `${i * 0.02}s`;
      w.append(a, b);
      el.appendChild(w);
    });
  });

  /* ---------- スムーススクロール ---------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false });
  }

  /* ---------- レイアウトの計測 ---------- */
  const L = { vw: 0, vh: 0 };
  const S = { blind: 0, light: 0, logoA: 0, ctaIntro: 0, bookK: 0, bookY: 0 };
  const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;

  function measure(force) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const widthChanged = vw !== L.vw;
    L.vw = vw;
    L.vh = vh;
    L.mobile = vw < 768;
    L.pad = clamp(vw * 0.032, 20, 48);
    L.stageH = els.heroStage.offsetHeight;
    L.fStageH = els.flightStage.offsetHeight;
    L.gStageH = els.globalStage.offsetHeight;
    ['hero', 'about', 'flight', 'global'].forEach((k) => { L[k] = { top: docTop(els[k]), h: els[k].offsetHeight }; });
    if (els.statement) { L.stTop = docTop(els.statement); L.stH = els.statement.offsetHeight; }

    // 画面サイズが大きく変わったときだけCanvasを作り直す（アドレスバーの伸縮では作り直さない）
    if (force || widthChanged || Math.abs((L.canvasH || 0) - vh) > 140) {
      L.canvasH = vh;
      cabin.resize(L.stageH);
      sky.resize();
    }
    L.skyW = els.skyCanvas.clientWidth || vw;
    L.skyH = els.skyCanvas.clientHeight || vh;
    // 参考写真のように、地平線が窓の下から3分の1あたりに来るようカメラの角度を決める
    {
      const g = cabin.geo;
      const yc = 1 - (2 * g.cy) / L.skyH;
      const hN = g.oh / L.skyH;
      L.heroPitch = Math.atan(-(yc + hN - 2 * hN * 0.66) * 0.62);
    }

    // 機体の大きさ
    const sh = L.fStageH;
    L.jetH = L.mobile ? sh * 0.98 : sh * 1.42;
    L.jetW = (L.jetH * 1000) / 1040;
    let fH;
    if (L.mobile) {
      fH = sh * 0.64;
    } else {
      const panel = Math.min(300, vw * 0.24);
      const avail = vw - 2 * (panel + L.pad + 28);
      fH = Math.min(sh * 0.8, (avail * 1040) / 1000);
    }
    L.fH = fH;
    L.fW = (fH * 1000) / 1040;
    L.jetSF = fH / L.jetH;
    L.jetYF = L.mobile ? sh * 0.07 : sh * 0.012;
    els.jet.style.width = `${L.jetW}px`;
    els.jet.style.height = `${L.jetH}px`;
    els.plan.style.width = `${L.fW}px`;
    els.plan.style.height = `${L.fH}px`;

    // ロゴ：窓の中央 → ヘッダー
    // ヘッダーは初回演出で動いているため、変形の影響を受けない offsetTop で測る
    L.logoDY = cabin.geo.cy - (els.logo.offsetTop + els.logo.offsetHeight / 2);
    // 窓の幅に収まる大きさで表示する
    L.logoS = clamp((cabin.geo.ow * 0.74) / Math.max(els.logo.offsetWidth, 1), 1, 1.9);

    // 予約ボタンの基準位置
    const ctaH = els.cta.offsetHeight;
    const ctaBottom = parseFloat(getComputedStyle(els.cta).bottom) || 20;
    L.ctaCY = vh - ctaBottom - ctaH / 2;

    globe.resize();
    L.globeSize = els.globeWrap.offsetWidth;
    L.globeCY = L.mobile ? vh * 0.6 : vh * 0.66;
    L.sEndLog = Math.log(cabin.sEnd * 1.01);
    cabin.dirty = true;
  }

  /* ---------- スクロール連動の演出（毎フレーム） ---------- */
  let introTl = null;
  let flightRevealed = false;

  function update(time, dt) {
    const y = window.scrollY;
    const vw = L.vw;
    const vh = L.vh;

    // 初回演出の途中でスクロールされたら、残りを早送りして操作を待たせない
    if (introTl && introTl.isActive() && y > 4 && introTl.timeScale() === 1) introTl.timeScale(3.2);

    /* 1. ヒーロー：窓を抜けて外へ */
    const hp = clamp((y - L.hero.top) / (L.hero.h - L.stageH));
    const zt = E.sine(range(hp, 0, 0.8));
    const zoom = Math.exp(L.sEndLog * zt);
    const cabinOn = zoom < cabin.sEnd && y < L.hero.top + L.hero.h;
    vis(els.cabinCanvas, cabinOn);
    if (cabinOn) {
      cabin.set({ zoom, blind: S.blind, light: S.light });
      if (cabinIsGL) cabin.draw(time);
      else cabin.draw();
    }
    const tp = E.in2(range(hp, 0, 0.6));
    const tOp = 1 - range(hp, 0.26, 0.58);
    els.heroL.forEach((el) => { tf(el, `translate3d(${(-0.5 * vw * tp).toFixed(1)}px,0,0)`); op(el, tOp); });
    els.heroR.forEach((el) => { tf(el, `translate3d(${(0.5 * vw * tp).toFixed(1)}px,0,0)`); op(el, tOp); });

    const lp = E.inOut(range(hp, 0.02, 0.42));
    tf(els.logo, `translate3d(0,${(L.logoDY * (1 - lp)).toFixed(1)}px,0) scale(${lerp(L.logoS, 1, lp).toFixed(3)})`);
    op(els.logo, S.logoA);

    /* 2. 夜空：文章を読み進めながら、視線が雲海へ下りていく */
    const aStart = L.about.top - vh;
    const ap = clamp((y - aStart) / (L.flight.top - aStart));
    if (hlChars.length && y > L.stTop - vh * 1.2 && y < L.stTop + L.stH + vh) {
      const prog = range(y, L.stTop - vh * 0.8, L.stTop + L.stH - vh * 0.4);
      const head = prog * (hlChars.length + 10);
      for (let i = 0; i < hlChars.length; i++) op(hlChars[i], 0.16 + 0.84 * clamp((head - i) / 10));
    }

    /* 3. 機体 → 座席配置 */
    const fp = clamp((y - L.flight.top) / (L.flight.h - L.fStageH));
    let pitch = lerp(L.heroPitch, L.heroPitch * 0.4, hp);
    pitch = lerp(pitch, -Math.PI / 2 + 0.0008, E.sine(range(ap, 0.2, 1)));
    const dark = E.sine(range(fp, 0.55, 0.8)) * 0.94;
    const travel = time * 0.016 + hp * 0.6 + ap * 1.8 + fp * 5.2;
    const skyOn = y < L.flight.top + L.flight.h;
    vis(els.skyCanvas, skyOn);
    if (skyOn) {
      // 窓の外は夕暮れ。文章を読み進めるうちに夜へ移っていく
      const dusk = 1 - E.sine(range(ap, 0.05, 0.55));
      sky.set({ pitch, travel, dark, expo: 1, dusk });
      sky.render(time);
    }

    if (!flightRevealed && y > L.flight.top - vh * 0.6) revealFlight();

    if (y > L.flight.top - vh * 1.2 && y < L.flight.top + L.flight.h + vh) {
      const sh = L.fStageH;
      const rise = E.sine(range(fp, 0.03, 0.46));
      const yStart = sh * 0.5 + L.jetH * 0.5 + 40;
      const yMid = L.mobile ? sh * 0.06 : 0;
      const shr = E.inOut(range(fp, 0.53, 0.71));
      const sc = lerp(1, L.jetSF, shr);
      const ty = lerp(lerp(yStart, yMid, rise), L.jetYF, shr);
      const alive = 1 - range(fp, 0.68, 0.74);
      const bob = Math.sin(time * 0.8) * 5 * alive;
      const roll = Math.sin(time * 0.5) * 0.4 * alive;
      tf(els.jet, `translate3d(-50%,-50%,0) translate3d(0,${(ty + bob).toFixed(1)}px,0) rotate(${roll.toFixed(3)}deg) scale(${sc.toFixed(4)})`);

      const scanP = range(fp, 0.76, 0.93);
      const scanY = lerp(-20, 1075, E.sine(scanP));
      const k = clamp(scanY / 1040);
      const jy = k * L.jetH;
      tf(els.jetClip, `translate3d(0,${jy.toFixed(1)}px,0)`);
      tf(els.jetClipInner, `translate3d(0,${(-jy).toFixed(1)}px,0)`);
      const py = k * L.fH;
      tf(els.plan, `translate3d(-50%,-50%,0) translate3d(0,${L.jetYF.toFixed(1)}px,0)`);
      tf(els.planClip, `translate3d(0,${(py - L.fH).toFixed(1)}px,0)`);
      tf(els.planClipInner, `translate3d(0,${(L.fH - py).toFixed(1)}px,0)`);
      vis(els.plan, scanP > 0);
      op(els.jetShadow, 0.6 * (1 - range(fp, 0.64, 0.74)));
      const nl = 1 - range(fp, 0.64, 0.72);
      els.navlights.forEach((n) => op(n, nl));

      const sy = sh / 2 + L.jetYF + (scanY / 1040 - 0.5) * L.fH;
      tf(els.scan, `translate3d(0,${sy.toFixed(1)}px,0)`);
      op(els.scan, scanP > 0 && scanP < 1 ? Math.min(1, Math.sin(Math.PI * scanP) * 4) : 0);
      els.legend.forEach((li) => {
        const on = scanY > +li.dataset.zone;
        if (on !== li._on) { li.classList.toggle('is-on', on); li._on = on; }
      });

      const tOut = range(fp, 0.52, 0.62);
      op(els.titles, 1 - tOut);
      tf(els.titles, `translate3d(0,${(-tOut * 40).toFixed(1)}px,0)`);
      const sp = range(fp, 0.62, 0.8);
      els.specs.forEach((el, i) => {
        const v = E.out(clamp(sp * 1.7 - i * 0.09));
        op(el, v);
        tf(el, `translate3d(0,${((1 - v) * 26).toFixed(1)}px,0)`);
      });
      op(els.grid, range(fp, 0.7, 0.9) * 0.9);
    }

    /* 5. 就航地：地球儀が昇り、最後に予約ボタンが地球儀の中心へ */
    let ctaShift = 0;
    const gp = clamp((y - L.global.top) / (L.global.h - L.gStageH));
    const globeOn = y > L.global.top - vh * 1.1;
    if (globeOn) {
      const g1 = E.out(range(gp, 0, 0.8));
      tf(els.giant, `translate3d(-50%,${lerp(vh * 1.02, L.mobile ? vh * 0.36 : vh * 0.07, g1).toFixed(1)}px,0)`);
      const gc = lerp(vh * 1.7, L.globeCY, g1);
      tf(els.globeWrap, `translate3d(-50%,${(gc - L.globeSize / 2).toFixed(1)}px,0) scale(${lerp(2, 1, g1).toFixed(3)})`);
      // スマートフォンではカードが重なる前に都市名を下げる
      const wOut = L.mobile ? range(gp, 0.06, 0.18) : range(gp, 0.5, 0.68);
      op(els.words, 1 - wOut);
      tf(els.words, `translate3d(-50%,${(-wOut * 40).toFixed(1)}px,0)`);
      const fIn = range(gp, 0.84, 0.97);
      op(els.footer, fIn);
      const act = fIn > 0.5;
      if (act !== els.footer._act) { els.footer.classList.toggle('is-active', act); els.footer._act = act; }
      if (!L.mobile) ctaShift = E.inOut(range(gp, 0.84, 1)) * (L.globeCY - L.ctaCY);
      globe.render(time, dt);
    }

    const baseY = S.ctaIntro + ctaShift;
    tf(els.cta, `translate3d(-50%,${lerp(baseY, S.bookY, S.bookK).toFixed(1)}px,0)`);
  }

  /* ---------- 初回演出 ---------- */
  function intro() {
    const pre = $('#preloader');
    const preChars = splitChars($('.preloader__text'));
    const heroLines = $$('.hero .reveal-line');
    const finish = () => { body.classList.remove('is-loading'); if (lenis) lenis.start(); };

    if (reduce || !window.gsap) {
      pre.remove();
      finish();
      Object.assign(S, { blind: 1, light: 1, logoA: 1, ctaIntro: 0 });
      return;
    }
    gsap.set(heroLines, { opacity: 0, filter: 'blur(20px)', y: 18 });
    gsap.set(els.header, { yPercent: -100, opacity: 0 });
    S.ctaIntro = 140;

    let visited = false;
    try { visited = sessionStorage.getItem('archer-visited') === '1'; sessionStorage.setItem('archer-visited', '1'); } catch (e) { /* 保存できない環境 */ }
    const hold = visited ? 0.6 : 1.7;
    if (lenis) lenis.stop();
    window.scrollTo(0, 0);

    const tl = gsap.timeline({ onComplete: () => { introTl = null; } });
    tl.fromTo(preChars, { opacity: 0, filter: 'blur(14px)' }, { opacity: 1, filter: 'blur(0px)', duration: 1, stagger: 0.035, ease: 'power3.out' }, 0.15);
    tl.to(preChars, { opacity: 0, filter: 'blur(14px)', duration: 0.5, stagger: 0.012, ease: 'power3.in' }, hold);
    tl.to(pre, { autoAlpha: 0, duration: 0.9, ease: 'power3.inOut', onComplete: () => pre.remove() }, hold + 0.3);
    tl.add(finish, hold + 0.35);
    // ブラインド：ゆっくり上がり、外の景色が現れる（スクロールとは独立）
    tl.to(S, { blind: 1, duration: 3.2, ease: 'power3.inOut' }, hold + 0.8);
    tl.to(S, { light: 1, duration: 2.8, ease: 'sine.inOut' }, hold + 1.2);
    tl.to(S, { logoA: 1, duration: 1.4, ease: 'sine.inOut' }, hold + 2.1);
    tl.to(heroLines, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.3, stagger: 0.09, ease: 'power3.out', clearProps: 'filter' }, hold + 2.2);
    tl.to(els.header, { yPercent: 0, opacity: 1, duration: 1.2, ease: 'power3.out' }, hold + 2.4);
    tl.to(S, { ctaIntro: 0, duration: 1.2, ease: 'power3.out' }, hold + 2.4);
    introTl = tl;
  }

  function revealFlight() {
    flightRevealed = true;
    if (!window.gsap || reduce) {
      flightChars.flat().forEach((c) => { c.style.opacity = 1; });
      $$('[data-flight-reveal]').forEach((el) => { el.style.opacity = 1; });
      return;
    }
    flightChars.forEach((chars, i) => {
      gsap.fromTo(chars, { opacity: 0, filter: 'blur(24px)' }, { opacity: 1, filter: 'blur(0px)', duration: 1.3, stagger: 0.08, ease: 'power3.out', delay: 0.2 + i * 0.2, clearProps: 'filter' });
    });
    gsap.fromTo('[data-flight-reveal]', { opacity: 0, filter: 'blur(16px)', y: 16 }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.2, stagger: 0.12, ease: 'power3.out', delay: 0.7, clearProps: 'filter' });
  }

  /* ---------- 画面に入ったときの表示 ---------- */
  function initReveals() {
    const targets = $$('[data-reveal], [data-card]');
    if (reduce || !window.gsap || !('IntersectionObserver' in window)) return;
    gsap.set(targets, { opacity: 0, y: 34, filter: 'blur(14px)' });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const sibs = Array.from(el.parentElement.children).filter((c) => c.matches('[data-reveal]'));
        const idx = Math.max(0, sibs.indexOf(el));
        gsap.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, delay: 0.08 + (el.matches('.feature') ? idx * 0.1 : 0), ease: 'power3.out', clearProps: 'filter' });
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    targets.forEach((el) => io.observe(el));
  }

  /* ---------- サービス（アコーディオンと画像） ---------- */
  function initAccordion() {
    const items = $$('.acc__item');
    const medias = $$('.media');
    let current = -1;
    let z = 1;
    const showMedia = (i, animate) => {
      const m = medias[i];
      if (!m) return;
      z += 1;
      m.style.zIndex = z;
      m.classList.add('is-shown');
      if (!animate || !window.gsap || reduce) return;
      gsap.fromTo(m, { yPercent: 100 }, { yPercent: 0, duration: 1.1, ease: 'power3.out' });
      gsap.fromTo(m.querySelector('.media__img'), { yPercent: -45, scale: 1.7 }, { yPercent: 0, scale: 1, duration: 1.1, ease: 'power3.out' });
    };
    const setOpen = (i, on) => {
      const it = items[i];
      it.classList.toggle('is-open', on);
      it.querySelector('.acc__btn').setAttribute('aria-expanded', on ? 'true' : 'false');
    };
    items.forEach((it, i) => {
      it.querySelector('.acc__btn').addEventListener('click', () => {
        if (current === i) { setOpen(i, false); current = -1; return; }
        if (current >= 0) setOpen(current, false);
        setOpen(i, true);
        showMedia(i, true);
        current = i;
      });
    });
    setOpen(0, true);
    showMedia(0, false);
    current = 0;
  }

  // 「24時間365日」の画像：夜空を描き出し、半分開いたブラインドの窓を重ねる
  function paintMediaWindow() {
    const cv = $('#mediaWindow');
    if (!cv) return;
    const W = cv.width;
    const H = cv.height;
    const ctx = cv.getContext('2d');
    const skyC = document.createElement('canvas');
    skyC.width = W;
    skyC.height = H;
    if (!sky.snapshot(skyC, { pitch: 0.1, travel: 7.3, dark: 0, expo: 1, dusk: 1 }, 42)) {
      const g = skyC.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#05070d');
      gr.addColorStop(0.6, '#1c1b20');
      gr.addColorStop(1, '#0b0a09');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    ctx.drawImage(skyC, 0, 0);
    const cab = document.createElement('canvas');
    cab.width = W;
    cab.height = H;
    const ow = W * 0.46;
    const oh = ow * 1.36;
    const geo = { cx: W / 2, cy: H * 0.5, ow, oh, a: ow / 2, b: oh / 2, A: (ow / 2) * 1.5, B: (oh / 2) * 1.42 };
    const st = { zoom: 1, blind: 0.44, light: 1 };
    if (!(cabinIsGL && cabin.renderTo(cab, geo, st, 42))) {
      window.Cabin.paint(cab.getContext('2d'), W, H, 1, geo, st);
    }
    ctx.drawImage(cab, 0, 0);
  }

  /* ---------- 就航地の都市名（縦に流れる） ---------- */
  function initWords() {
    const list = $('#words');
    if (!list || !window.gsap) return;
    let idx = 2;
    const h = () => list.firstElementChild.offsetHeight;
    const setCur = () => Array.from(list.children).forEach((li, k) => li.classList.toggle('is-current', k === idx));
    gsap.set(list, { y: 0 });
    setCur();
    setInterval(() => {
      if (document.hidden || reduce) return;
      idx += 1;
      setCur();
      gsap.to(list, {
        y: -(idx - 2) * h(), duration: 0.8, ease: 'power3.out',
        onComplete: () => {
          list.appendChild(list.firstElementChild);
          idx -= 1;
          gsap.set(list, { y: -(idx - 2) * h() });
          setCur();
        }
      });
    }, 1800);
  }

  function initClock() {
    const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
    const tick = () => $$('[data-clock]').forEach((el) => { el.textContent = fmt.format(new Date()); });
    tick();
    setInterval(tick, 10000);
  }

  /* ---------- メニュー・ページ内リンク ---------- */
  let menuOpen = false;
  function setMenu(open) {
    const btn = $('#menuBtn');
    const menu = $('#menu');
    if (!btn || open === menuOpen) return;
    menuOpen = open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    if (open) {
      menu.hidden = false;
      if (lenis) lenis.stop();
      if (window.gsap) {
        gsap.fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' });
        gsap.fromTo($$('.menu__nav a, .menu__contact', menu), { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.7, stagger: 0.07, ease: 'power3.out' });
      }
    } else {
      const done = () => { menu.hidden = true; };
      if (lenis) lenis.start();
      if (window.gsap) gsap.to(menu, { opacity: 0, duration: 0.4, ease: 'power2.in', onComplete: done }); else done();
    }
  }

  function targetY(hash) {
    if (hash === '#top') return 0;
    if (hash === '#flight') return L.flight.top + (L.flight.h - L.fStageH) * 0.96;
    const el = $(hash);
    return el ? docTop(el) : null;
  }

  function initLinks() {
    $('#menuBtn')?.addEventListener('click', () => setMenu(!menuOpen));
    $$('[data-scroll-to]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const ty = targetY(a.getAttribute('href'));
        if (ty == null) return;
        e.preventDefault();
        setMenu(false);
        if (lenis) {
          const dist = Math.abs(ty - window.scrollY);
          lenis.scrollTo(ty, { duration: Math.min(3.2, 1.2 + dist / 7000), easing: (t) => 1 - Math.pow(1 - t, 4) });
        } else {
          window.scrollTo({ top: ty, behavior: reduce ? 'auto' : 'smooth' });
        }
      });
    });
  }

  /* ---------- 予約フォーム ---------- */
  let bookingOpen = false;
  let lastFocus = null;
  function initBooking() {
    const booking = $('#booking');
    const panel = $('.booking__panel', booking);
    const overlay = $('.booking__overlay', booking);
    const form = $('#bookingForm');
    const err = $('#bookingError');
    const main = $('#bookingMain');
    const done = $('#bookingDone');
    const iconBtn = $('.cta__icon');

    const open = () => {
      if (bookingOpen) return;
      bookingOpen = true;
      lastFocus = document.activeElement;
      booking.hidden = false;
      body.classList.add('is-booking');
      iconBtn.setAttribute('aria-label', 'フォームを閉じる');
      if (lenis) lenis.stop();
      const ph = panel.offsetHeight;
      const panelBottom = L.mobile ? 10 : 16;
      S.bookY = (L.vh - panelBottom - ph - 16 - els.cta.offsetHeight / 2) - L.ctaCY;
      if (window.gsap) {
        gsap.fromTo(panel, { yPercent: 115 }, { yPercent: 0, duration: 1, ease: 'power3.out' });
        gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });
        gsap.to(S, { bookK: 1, duration: 1, ease: 'power3.out' });
      } else S.bookK = 1;
      setTimeout(() => { const f = $('input', panel); if (f) f.focus({ preventScroll: true }); }, 450);
    };
    const close = () => {
      if (!bookingOpen) return;
      bookingOpen = false;
      body.classList.remove('is-booking');
      iconBtn.setAttribute('aria-label', 'フライトを予約');
      if (lenis) lenis.start();
      const fin = () => {
        booking.hidden = true;
        main.hidden = false;
        done.hidden = true;
        form.reset();
        err.textContent = '';
      };
      if (window.gsap) {
        gsap.to(panel, { yPercent: 115, duration: 0.9, ease: 'power3.inOut', onComplete: fin });
        gsap.to(overlay, { opacity: 0, duration: 0.7, ease: 'power2.inOut' });
        gsap.to(S, { bookK: 0, duration: 1, ease: 'power3.inOut' });
      } else { S.bookK = 0; fin(); }
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };

    $$('[data-open-booking]').forEach((b) => b.addEventListener('click', () => (bookingOpen ? close() : open())));
    $$('[data-close-booking]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (bookingOpen) close();
      else if (menuOpen) setMenu(false);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      const email = String(fd.get('email') || '').trim();
      if (!name) { err.textContent = 'お名前をご入力ください。'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'メールアドレスをご確認ください。'; return; }
      if (!fd.get('agree')) { err.textContent = 'プライバシーポリシーへの同意をお願いいたします。'; return; }
      err.textContent = '';
      main.hidden = true;
      done.hidden = false;
      if (window.gsap) gsap.fromTo(done, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' });
    });
  }

  /* ---------- マグネット効果 ---------- */
  function initMagnetic() {
    if (!canHover || !window.gsap || reduce) return;
    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        gsap.to(el, { x: ((e.clientX - r.left) / r.width - 0.5) * 12, y: ((e.clientY - r.top) / r.height - 0.5) * 10, duration: 1.2, ease: 'power4.out', overwrite: 'auto' });
      });
      el.addEventListener('mouseleave', () => {
        gsap.to(el, { x: 0, y: 0, duration: 1.5, ease: 'elastic.out(1, 0.35)', overwrite: 'auto' });
      });
    });
  }

  /* ---------- 起動 ---------- */
  measure(true);
  intro();
  initReveals();
  initAccordion();
  initWords();
  initClock();
  initLinks();
  initBooking();
  initMagnetic();
  paintMediaWindow();

  if (window.gsap) {
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add((time, deltaMs) => {
      if (lenis) lenis.raf(time * 1000);
      update(time, Math.min(0.1, deltaMs / 1000));
    });
  } else {
    let last = performance.now();
    const loop = (now) => {
      if (lenis) lenis.raf(now);
      update(now / 1000, Math.min(0.1, (now - last) / 1000));
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  let rT = 0;
  const onResize = () => { clearTimeout(rT); rT = setTimeout(() => measure(false), 120); };
  window.addEventListener('resize', onResize);
  // 表示領域の変化を取りこぼさないよう、要素の大きさの変化も監視する
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(els.skyCanvas);
  window.addEventListener('load', () => measure(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measure(true));
})();
