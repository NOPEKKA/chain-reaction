// ══ เอฟเฟกต์ของการ์ดแต่ละใบ ══
// โหลดหลังสคริปต์หลักของ index.html (ใช้ FX.K, STATE, SFX, CRLogic, paintCellAs, updateCellDisplay ของหน้านั้น)
//
// หลักเดียวกันทุกใบ:
//   1. ค้างภาพกระดาน "ก่อนใช้การ์ด" ไว้ก่อน (K.stage) — ออฟไลน์ state เปลี่ยนไปแล้วตั้งแต่กดใช้ · ออนไลน์ state ยังไม่ซิงก์
//   2. เล่นท่าของการ์ด แล้วเผยค่าใหม่ของแต่ละช่อง "ตอนที่ท่ามาถึงช่องนั้น" (V.reveal / land)
//   3. ความยาวของทุกใบ = CRLogic.CARD_VFX_MS (ตารางเดียวกับ server และคิวของโหมดออนไลน์) ไม่ขึ้นกับจำนวนช่อง
// การ์ดบางใบในโหมดออฟไลน์ "เปลี่ยน state ตอนเอฟเฟกต์ลงช่อง" (ของเดิมเป็นแบบนี้ — ดู land(..., fn)) กติกาส่วนนั้นคงไว้ตามเดิมทุกตัวอักษร
// ไม่มีอิโมจิ: ทุกอย่างเป็นรูปทรง/แสง/การเคลื่อนที่ของช่องและลูกบอลจริง
(function () {
'use strict';
const K = FX.K;
const wait = ms => new Promise(res => setTimeout(res, ms));

// ช่องที่การ์ดใบนี้เปลี่ยน: [{ r, c, fromCount, fromOwner, toCount, toOwner }]
//   ออฟไลน์: เทียบ snapshot ที่เก็บก่อนใช้การ์ด (ตัวเดียวกับที่ Rewind ใช้) กับ state ปัจจุบัน
//   ออนไลน์: เทียบกระดานบนจอ (ยังไม่ซิงก์) กับกระดานหลังผลของการ์ดที่ server ส่งมา (vfxData._after: [count, owner, ...])
function cardDiff(vfxData, online) {
  const out = [], cells = STATE.cells;
  if (!cells) return out;
  if (online) {
    const a = vfxData._after;
    if (!a) return out;
    let i = 0;
    for (let r = 0; r < cells.length; r++) for (let c = 0; c < cells[r].length; c++, i += 2) {
      const ce = cells[r][c], n = a[i], o = n > 0 ? a[i + 1] : -1;
      if (ce.count !== n || (n > 0 && ce.owner !== o)) out.push({ r, c, fromCount: ce.count, fromOwner: ce.owner, toCount: n, toOwner: o });
    }
  } else {
    const s = STATE._snapshot && STATE._snapshot.cells;
    if (!s) return out;
    for (let r = 0; r < cells.length; r++) for (let c = 0; c < cells[r].length; c++) {
      const b = s[r] && s[r][c], ce = cells[r][c];
      if (b && (b.count !== ce.count || (ce.count > 0 && b.owner !== ce.owner))) out.push({ r, c, fromCount: b.count, fromOwner: b.owner, toCount: ce.count, toOwner: ce.count > 0 ? ce.owner : -1 });
    }
  }
  return out;
}
// ช่องเยอะ: ให้ "ท่าของช่อง" (transform) เฉพาะตัวอย่าง ~20 ช่อง — ทุกช่องยังเผยค่าใหม่ครบ
const some = (i, n) => n <= 28 || i % Math.ceil(n / 20) === 0;
const HEX = 'polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)';
const TRI = 'polygon(50% 100%,0 0,100% 0)';

// อุกกาบาตหนึ่งลูกลงที่ช่องเป้าหมาย · second = ลูกที่สอง (มาจากอีกฝั่ง ร้อนขาวกว่า แรงกว่า)
function meteor(x, second) { const { r, c, V, at, P, cs, t, u } = x, p = P(r, c), H = window.innerHeight, side = second ? -1 : 1, T1 = second ? 300 : 340;
  const a = { x: p.x + side * Math.max(cs * 5, H * .5), y: p.y - Math.max(cs * 7, H * .78) }, head = Math.round(cs * (second ? .64 : .54)), EASE = 'cubic-bezier(.55,.085,.68,.53)';
  const along = k => { const e = k * k; return { x: a.x + (p.x - a.x) * e, y: a.y + (p.y - a.y) * e }; };
  // องก์ 1: ฟ้ามืด เป้าเตือนหุบเข้าหาช่อง
  K.vignette('rgba(24,6,0,.62)', T1 + 520, t ? 1 : .5); SFX.fx('whistle');
  K.ringIn(p.x, p.y, cs * 3.2, '#ff7a3c', .3, T1 - 40, 0, 3); K.ringIn(p.x, p.y, cs * 3.2, '#ffd9a8', .3, T1 - 140, 100, 2);
  // องก์ 2: ลูกไฟ + หางไฟ + ควัน
  K.comet(a, p, { color: second ? '#ffd9a8' : '#ff8a3c', size: Math.round(head * .9), tail: cs * 3.6, dur: T1, ease: EASE, prio: 2 });
  K.fly(a, p, { color: '#fff3d6', size: head, dur: T1, ease: EASE, s0: 1, prio: 2 });
  K.P.stream({ at: along, dur: T1, rate: 170, k: 'fire', jx: cs * .12, jy: cs * .12, v0: 10 * u, v1: 60 * u, l0: 240, l1: 460, s0: cs * .34, s1: cs * .06, drag: 2, al: .7 });
  K.P.stream({ at: along, dur: T1, rate: 46, k: 'smoke', jx: cs * .2, jy: cs * .2, v0: 8 * u, v1: 40 * u, l0: 500, l1: 900, s0: cs * .3, s1: cs * .7, drag: 1.5, al: .6 });
  // องก์ 3: กระแทก
  at(T1, () => { V.reveal(r, c, 'ignite'); SFX.fx('impact'); K.flash(second ? '#fff1d6' : '#ffb46b', 240, second ? .42 : .34); K.shake(second ? 10 : 8, 340);
    K.box(p.x, p.y, cs * 3.4, cs * 3.4, 'border-radius:50%;background:radial-gradient(circle,rgba(12,4,0,.78) 0,rgba(40,12,0,.5) 38%,rgba(0,0,0,0) 68%);', [{ opacity: 0, t: 'scale(.4)' }, { opacity: 1, t: 'scale(1)', offset: .12 }, { opacity: .8, t: 'scale(1)', offset: .6 }, { opacity: 0, t: 'scale(1.05)' }], { duration: 1100, easing: 'ease-out' });
    if (t) K.rings(p.x, p.y, ['#ffffff', '#ff8a3c', '#b3260c'], cs, 4.2, 520, 80);
    K.P.burst(p.x, p.y, 90, { k: 'fire', v0: 140 * u, v1: 640 * u, l0: 280, l1: 580, s0: cs * .34, s1: cs * .05, drag: 2.8, al: .55 });
    K.P.burst(p.x, p.y, 12, { k: 'hot', v0: 40 * u, v1: 220 * u, l0: 160, l1: 300, s0: cs * .32, s1: cs * .06, drag: 3, al: .75 });
    K.P.burst(p.x, p.y, 30, { k: 'lava', a0: -2.9, a1: -.25, v0: 260 * u, v1: 620 * u, g: 1300 * u, l0: 500, l1: 900, s0: cs * .13, s1: cs * .05, drag: .3 });
    K.P.burst(p.x, p.y, 14, { k: 'smoke', v0: 30 * u, v1: 120 * u, vy: -40 * u, l0: 700, l1: 1200, s0: cs * .4, s1: cs * 1.1, drag: 1.2, al: .55 });
    K.P.burst(p.x, p.y, 26, { k: 'ember', v0: 80 * u, v1: 300 * u, g: -80 * u, l0: 600, l1: 1100, s0: cs * .07, s1: cs * .02, drag: .8, wob: 40 * u }); }); }

const CARD = {
  // ───────────── เติมลูกให้ตัวเอง ─────────────
  // Overload: ฟ้าผ่าลงช่องสองครั้ง ครั้งละลูก
  c1(x) { const { r, c, V, at, P, cs, t, tk } = x, p = P(r, c);
    K.ringIn(p.x, p.y, cs * 2.4, '#ffe66b', .35, 190);
    [0, 150].forEach((d, i) => {
      if (t) K.bolt(p.x + (i ? cs * .12 : -cs * .1), p.y + cs * .1, { delay: d });
      at(d + 45, () => { if (i) V.reveal(r, c); else V.part(r, c, .5); tk(r, c, 'zap'); SFX.fx('zap');
        if (t) { K.sparks(p.x, p.y, t === 2 ? 7 : 4, '#ffe66b', cs * 1.3, { white: true, dur: 300 }); K.ring(p.x, p.y, cs, '#fff3a0', 1.9, 300, 0, 1, 2); } });
    });
    at(210, () => K.num(r, c, 2, { color: '#ffe66b' })); },
  // Pulse: ช่องกลางอัดพลัง แล้วยิงลูกออกไปช่องรอบข้างพร้อมกัน
  c2(x) { const { r, c, pi, col, V, at, land, P, cs, t, tk, d } = x, p = P(r, c), area = d.area || [], lite = K.mix(col, '#ffffff', .35);
    tk(r, c, 'ignite'); K.ringIn(p.x, p.y, cs * 2.2, col, .4, 170);
    at(160, () => { SFX.fx('pop');
      if (t) K.tile(r, c, { css: `border:3px solid ${lite};`, radius: '6px', frames: [{ opacity: .95, t: 'rotate(45deg) scale(.5)' }, { opacity: 0, t: 'rotate(45deg) scale(3)' }], dur: 430, ease: 'cubic-bezier(.2,.7,.3,1)' });
      area.forEach(([nr, nc]) => K.fly(p, P(nr, nc), { color: lite, size: x.orb, dur: 210 })); });
    at(375, () => area.forEach(([nr, nc]) => land(nr, nc, 'placed', ce => { ce.count++; ce.owner = pi; }))); },
  // Store: ลูกสองลูกหล่นจากด้านบนลงช่อง
  c11(x) { const { V, at, P, cs, t, d, col } = x;
    (d.boosted || []).forEach(([ro, co], i) => { const p = P(ro, co), dl = i * 140;
      K.fly({ x: p.x, y: p.y - cs * 2.4 }, p, { color: K.mix(col, '#ffffff', .3), size: Math.round(x.orb * 1.15), dur: 230, delay: dl, ease: 'cubic-bezier(.6,0,1,.7)', s0: 1 });
      at(dl + 215, () => { V.reveal(ro, co, 'placed'); K.num(ro, co, 1); SFX.fx('thud'); if (t) K.ring(p.x, p.y, cs, col, 1.8, 300, 0, 1, 2); }); }); },
  // Double Shot: ยิงสองนัดจากป้ายคะแนนของผู้ใช้
  u3(x) { const { V, at, P, cs, t, d, col, from } = x;
    (d.boosted || []).forEach(([ro, co], i) => { const p = P(ro, co), dl = i * 130;
      at(dl, () => { K.line(from, p, { color: K.mix(col, '#ffffff', .4), w: 3, dur: 150, grow: .5 }); SFX.fx('zap'); });
      at(dl + 70, () => { V.reveal(ro, co, 'placed'); K.num(ro, co, 1);
        if (t) { K.ring(p.x, p.y, cs, col, 1.9, 300, 0, 1, 2); K.sparks(p.x, p.y, t === 2 ? 6 : 3, col, cs * 1.1, { white: true, dur: 280 }); } }); }); },
  // Boost: ประกายจากช่องที่เลือกโค้งไปหาช่องข้างๆ
  c14(x) { const { r, c, V, at, P, cs, t, d } = x, p = P(r, c), bs = (d.boosted || [[r, c]]).filter(([ro, co]) => !(ro === r && co === c)); SFX.fx('chime');
    K.glyph(p.x, p.y, '✦', { size: Math.round(cs * .8), glow: '#c98bff', dur: 360, frames: [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(-60deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.3) rotate(20deg)', offset: .4 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(.5) rotate(120deg)' }] });
    at(100, () => { V.reveal(r, c, 'placed'); K.num(r, c, 1, { color: '#d9b8ff' }); });
    at(150, () => bs.forEach(([ro, co]) => K.fly(p, P(ro, co), { color: '#e7d2ff', size: Math.round(x.orb * .8), dur: 250, arc: cs * .45 })));
    at(400, () => bs.forEach(([ro, co]) => { V.reveal(ro, co, 'placed'); const q = P(ro, co); if (t) K.sparks(q.x, q.y, 3, '#d9b8ff', cs * .9, { white: true, dur: 260 }); })); },
  // Mega Burst: พื้นใต้ 3×3 แตกร้าวเรืองแสง → ปะทุเป็นน้ำพุลาวา → ก้อนลาวาโค้งไปตกทุกช่อง
  r1(x) { const { r, c, V, at, P, cs, g, t, tk, d, u } = x, p = P(r, c), area = d.area || [], sz = Math.round(cs * 3.6), lx = (p.x - g.wx).toFixed(1), ly = (p.y - g.wy).toFixed(1);
    // องก์ 1: รอยร้าวแผ่จากกลาง พื้นสั่น
    SFX.fx('rumble'); K.shake(2, 260); tk(r, c, 'ignite');
    const crack = K.clip(0, `width:${sz}px;height:${sz}px;margin:${-sz / 2}px 0 0 ${-sz / 2}px;border-radius:50%;background:repeating-conic-gradient(from 8deg,rgba(255,225,150,0) 0 13deg,rgba(255,225,150,.95) 13deg 15deg,rgba(255,225,150,0) 15deg 34deg,rgba(255,150,60,.9) 34deg 35.5deg,rgba(255,150,60,0) 35.5deg 52deg),radial-gradient(circle,rgba(255,214,130,.95) 0,rgba(255,96,20,.75) 26%,rgba(120,20,0,.5) 52%,rgba(0,0,0,0) 70%);-webkit-mask-image:radial-gradient(circle,#000 30%,transparent 70%);mask-image:radial-gradient(circle,#000 30%,transparent 70%);`);
    if (crack) { const B = `translate(${lx}px,${ly}px)`; crack.animate([{ transform: B + ' scale(.2) rotate(0deg)', opacity: 0 }, { transform: B + ' scale(.82) rotate(6deg)', opacity: .9, offset: .24 }, { transform: B + ' scale(1) rotate(8deg)', opacity: 1, offset: .33 }, { transform: B + ' scale(1.04) rotate(9deg)', opacity: .7, offset: .72 }, { transform: B + ' scale(1.06) rotate(9deg)', opacity: 0 }], { duration: 880, easing: 'ease-out' }); K.hold(900); }
    K.P.stream({ at: p, dur: 250, rate: 44, k: 'ember', jx: cs * 1.2, jy: cs * 1.2, a0: -2, a1: -1.1, v0: 60 * u, v1: 200 * u, g: -40 * u, l0: 400, l1: 800, s0: cs * .06, s1: cs * .02, drag: .6 });
    // องก์ 2: ปะทุ
    at(270, () => { SFX.fx('impact'); K.flash('#ff8a2a', 220, .24); K.shake(6, 300);
      K.P.burst(p.x, p.y, 46, { k: 'lava', a0: -2.75, a1: -.4, v0: 300 * u, v1: 720 * u, g: 1500 * u, l0: 520, l1: 880, s0: cs * .15, s1: cs * .05, drag: .25 });
      K.P.burst(p.x, p.y, 80, { k: 'fire', v0: 80 * u, v1: 440 * u, vy: -160 * u, l0: 320, l1: 620, s0: cs * .38, s1: cs * .06, drag: 2.4, al: .52, st: 1.3 });
      K.P.burst(p.x, p.y, 10, { k: 'hot', v0: 40 * u, v1: 200 * u, l0: 180, l1: 320, s0: cs * .3, s1: cs * .06, drag: 3, al: .7 });
      K.P.burst(p.x, p.y, 10, { k: 'smoke', v0: 20 * u, v1: 90 * u, vy: -70 * u, l0: 800, l1: 1200, s0: cs * .45, s1: cs * 1.2, drag: 1, al: .5 });
      if (t) K.rings(p.x, p.y, ['#ffe2a8', '#ff7a1a'], cs, 3.6, 480, 80);
      area.forEach(([ro, co]) => { if (ro === r && co === c) { V.reveal(ro, co, 'first'); return; }
        const dist = Math.abs(ro - r) + Math.abs(co - c);
        K.fly(p, P(ro, co), { color: '#ffb347', size: Math.round(x.orb * 1.15), dur: 300 + dist * 30, lift: cs * (1 + dist * .25), ease: 'cubic-bezier(.3,0,.7,1)', prio: 2 }); }); });
    // องก์ 3: ลาวาตกถึงช่อง ไฟแลบแล้วมอด
    area.forEach(([ro, co], i) => { if (ro === r && co === c) return; const dist = Math.abs(ro - r) + Math.abs(co - c);
      at(555 + dist * 30, () => { V.reveal(ro, co, 'placed'); const q = P(ro, co); if (i % 3 === 0) SFX.fx('pop');
        K.P.burst(q.x, q.y, 9, { k: 'fire', a0: -2.5, a1: -.64, v0: 80 * u, v1: 260 * u, l0: 260, l1: 460, s0: cs * .22, s1: cs * .04, drag: 2.2, al: .65 }); }); }); },
  // Nova: ช่องที่ใกล้ระเบิดที่สุดหดตัว → วาบเป็นดาว ยิงลูกคู่ไปช่องรอบข้าง
  ep5(x) { const { pi, at, land, P, cs, t, tk, d } = x; if (!d.best) return; const [br, bc] = d.best, p = P(br, bc), bs = d.boosted || [];
    K.ringIn(p.x, p.y, cs * 3, '#ffe07a', .3, 230); K.ringIn(p.x, p.y, cs * 3, '#ffffff', .3, 230, 130, 2); tk(br, bc, 'ignite'); SFX.fx('rise');
    at(310, () => { SFX.fx('boom'); K.flash('#ffe9a8', 240, .22); K.shake(4, 240);
      if (t) { K.rays(p.x, p.y, '#ffe07a', Math.round(cs * 5.5), 620, 0, .9); K.ring(p.x, p.y, cs, '#ffffff', 3.2, 420, 0, 2, 3); }
      K.P.burst(p.x, p.y, 60, { k: 'gold', v0: 120 * x.u, v1: 560 * x.u, l0: 350, l1: 700, s0: cs * .14, s1: cs * .03, drag: 2.2 });
      bs.forEach(([ro, co]) => { const q = P(ro, co); K.fly(p, q, { color: '#ffe07a', size: x.orb, dur: 220 }); K.fly(p, q, { color: '#fff3c4', size: Math.round(x.orb * .8), dur: 220, delay: 70 }); }); });
    at(590, () => { bs.forEach(([ro, co]) => { land(ro, co, 'first', ce => { ce.count += 2; ce.owner = pi; }); K.num(ro, co, 2, { color: '#ffe07a' }); }); SFX.fx('chime'); }); },
  // Inferno: กระดานร้อนแดงจากด้านล่าง → แนวไฟกวาดเฉียง ทุกช่องของเรามีเปลวสูงลุกขึ้น → กำแพงไฟลุกท่วมทั้งกระดานจากขอบล่าง แล้วมอดเป็นควันกับสะเก็ดไฟ
  ep6(x) { const { at, land, P, cs, g, t, d, u } = x, cells = (d.cells || []).map(q => ({ q, p: P(q[0], q[1]) })), n = cells.length; if (!n) return;
    // องก์ 1: ความร้อนขึ้นจากพื้น
    K.vignette('rgba(60,8,0,.72)', 1250, t ? 1 : .5); SFX.fx('rumble'); SFX.fx('burn');
    const heat = K.clip(0, 'left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse 90% 70% at 50% 115%,rgba(255,120,20,.6),rgba(160,30,0,.35) 55%,rgba(20,0,0,.3));');
    if (heat) { heat.animate([{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: .85, offset: .7 }, { opacity: 0 }], { duration: 1250, easing: 'ease-out' }); K.hold(1280); }
    // องก์ 2: แนวไฟกวาดเฉียง 8 จังหวะ — เปลวสูงราวช่องครึ่ง ฐานเหลือง ปลายแดง
    let lo = Infinity, hi = -Infinity; cells.forEach(o => { o.k = o.p.x + o.p.y; lo = Math.min(lo, o.k); hi = Math.max(hi, o.k); });
    const G = 8, cap = t === 2 ? 20 : t === 1 ? 9 : 0, step = Math.max(1, Math.ceil(n / Math.max(1, cap))), groups = Array.from({ length: G }, () => []);
    cells.forEach((o, i) => { o.i = i; groups[hi > lo ? Math.min(G - 1, Math.floor((o.k - lo) / (hi - lo) * G)) : 0].push(o); });
    groups.forEach((gr, k) => { if (!gr.length) return;
      at(140 + k * 70, () => { if (k % 3 === 0) SFX.fx('crackle');
        gr.forEach(o => { land(o.q[0], o.q[1], some(o.i, n) ? 'placed' : '', ce => { ce.count++; });
          const base = { x: o.p.x, y: o.p.y + cs * .4 };
          if (cap && o.i % step === 0) {
            K.P.stream({ at: base, dur: 460, rate: 74, k: 'fire', jx: cs * .3, a0: -1.72, a1: -1.42, v0: 210 * u, v1: 430 * u, l0: 360, l1: 660, s0: cs * .3, s1: cs * .04, drag: 1.3, wob: 46 * u, al: .5, st: 1.8 });
            K.P.stream({ at: base, dur: 380, rate: 10, k: 'hot', jx: cs * .18, a0: -1.7, a1: -1.44, v0: 120 * u, v1: 240 * u, l0: 200, l1: 340, s0: cs * .16, s1: cs * .04, drag: 1.4, al: .7 });
            K.P.stream({ at: base, dur: 520, rate: 8, k: 'ember', jx: cs * .35, a0: -2, a1: -1.1, v0: 220 * u, v1: 480 * u, g: -60 * u, l0: 600, l1: 1000, s0: cs * .06, s1: cs * .02, drag: .5, wob: 40 * u });
            K.tile(o.q[0], o.q[1], { css: 'background:radial-gradient(ellipse 60% 45% at 50% 88%,rgba(255,170,60,.85),rgba(255,80,10,.4) 55%,rgba(255,60,0,0) 80%);', frames: [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], dur: 560 });
          } else K.P.burst(base.x, base.y, 8, { k: 'fire', jx: cs * .25, a0: -1.72, a1: -1.42, v0: 160 * u, v1: 360 * u, l0: 300, l1: 520, s0: cs * .26, s1: cs * .04, drag: 1.3, al: .5, st: 1.8 }); }); }); });
    // องก์ 3: กำแพงไฟลุกท่วมจากขอบล่างของกระดาน แล้วมอด
    at(760, () => { K.flash('#ff7a1a', 300, .18); K.shake(5, 300); SFX.fx('boom'); SFX.fx('burn');
      const floor = () => ({ x: g.wx + Math.random() * g.ww, y: g.wy + g.wh });
      K.P.stream({ at: floor, dur: 320, rate: 820, k: 'fire', jy: cs * .25, a0: -1.7, a1: -1.44, v0: 380 * u, v1: 940 * u, l0: 420, l1: 820, s0: cs * .5, s1: cs * .07, drag: 1.5, wob: 60 * u, al: .42, st: 2 });
      K.P.stream({ at: floor, dur: 300, rate: 40, k: 'hot', a0: -1.7, a1: -1.44, v0: 200 * u, v1: 420 * u, l0: 220, l1: 380, s0: cs * .24, s1: cs * .05, drag: 1.6, al: .6 });
      K.P.stream({ at: () => ({ x: g.wx + Math.random() * g.ww, y: g.wy + g.wh * (.35 + Math.random() * .65) }), delay: 120, dur: 380, rate: 150, k: 'ember', a0: -2, a1: -1.14, v0: 200 * u, v1: 560 * u, g: -50 * u, l0: 700, l1: 1300, s0: cs * .07, s1: cs * .02, drag: .45, wob: 50 * u }); });
    at(1040, () => cells.forEach(o => { if (cap && o.i % (step * 2) === 0) K.P.burst(o.p.x, o.p.y, 2, { k: 'smoke', v0: 10 * u, v1: 40 * u, vy: -90 * u, l0: 600, l1: 1000, s0: cs * .35, s1: cs * .95, drag: .9, al: .4 }); })); },
  // Tsunami: คลื่นวิ่งตามแถว ช่องไหนโดนยอดคลื่นได้ลูกตอนนั้น
  e2(x) { const { r, V, at, P, cs, t, d } = x, cols = STATE.cells[0].length, a = P(r, 0), b = P(r, cols - 1), row = d.row || [], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len,
      A = { x: a.x - ux * cs * .9, y: a.y - uy * cs * .9 }, B = { x: b.x + ux * cs * .4, y: b.y + uy * cs * .4 }; SFX.fx('water');
    K.line(A, B, { w: Math.round(cs * .86), bg: 'linear-gradient(90deg,rgba(60,140,255,0),rgba(90,170,255,.42) 30%,rgba(150,210,255,.55) 80%,rgba(255,255,255,.75))', dur: 760, grow: .62, hold: .72, glow: false });
    if (t) K.comet(A, B, { color: '#9fd8ff', size: Math.round(cs * .95), tail: cs * 1.4, dur: 500, ease: 'cubic-bezier(.3,0,.5,1)', prio: 2 });
    K.P.stream({ at: k => ({ x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k }), dur: 500, rate: 130, k: 'water', jx: cs * .3, jy: cs * .3, a0: -2.5, a1: -.64, v0: 80 * x.u, v1: 300 * x.u, g: 900 * x.u, l0: 300, l1: 600, s0: cs * .12, s1: cs * .03, drag: .6 });
    row.forEach(([ro, co]) => { const q = P(ro, co), f = ((q.x - a.x) * ux + (q.y - a.y) * uy) / len; at(Math.round(70 + f * 430), () => V.reveal(ro, co, 'placed')); });
    at(520, () => { SFX.fx('splash'); if (t) K.sparks(B.x, B.y, t === 2 ? 12 : 6, '#cfeaff', cs * 1.6, { white: true, dur: 380, grav: 8 });
      K.P.burst(B.x, B.y, 34, { k: 'water', a0: -2.9, a1: -.25, v0: 160 * x.u, v1: 460 * x.u, g: 1000 * x.u, l0: 350, l1: 650, s0: cs * .13, s1: cs * .03, drag: .5 }); }); },
  // Pillar: เสาแสงพุ่งผ่านทั้งแนว
  e4(x) { const { c, V, at, P, cs, t, d } = x, rows = STATE.cells.length, a = P(0, c), b = P(rows - 1, c), col = d.col || [], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len,
      A = { x: a.x - ux * cs * .7, y: a.y - uy * cs * .7 }, B = { x: b.x + ux * cs * .6, y: b.y + uy * cs * .6 }; SFX.fx('rise');
    K.line(A, B, { w: Math.round(cs * .92), bg: 'linear-gradient(180deg,transparent,rgba(255,226,150,.75) 22%,#fff 50%,rgba(255,226,150,.75) 78%,transparent)', dur: 700, grow: .32, hold: .6, glow: false, prio: 2 });
    K.P.stream({ at: k => ({ x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k }), dur: 260, rate: 170, k: 'gold', jx: cs * .35, jy: cs * .35, v0: 10 * x.u, v1: 60 * x.u, vy: -70 * x.u, l0: 400, l1: 800, s0: cs * .09, s1: cs * .02, drag: .8 });
    col.forEach(([ro, co]) => { const q = P(ro, co), f = ((q.x - a.x) * ux + (q.y - a.y) * uy) / len; at(Math.round(40 + f * 220), () => V.reveal(ro, co, 'placed')); });
    at(270, () => { SFX.fx('thud'); K.shake(3, 200); if (t) col.forEach(([ro, co], i) => { if (i % 2 === 0) { const q = P(ro, co); K.sparks(q.x, q.y, 3, '#ffe9a8', cs * 1.1, { dur: 420, grav: -10 }); } }); });
    at(430, () => SFX.fx('chime')); },

  // ───────────── ระเบิด ─────────────
  // Instant Burst: ช่องหดตัวอัดแน่น → ระเบิดเล็กๆ (ไฟ + สะเก็ด + ควันบาง) แล้วลูกโซ่เริ่ม
  u1(x) { const { r, c, V, at, P, cs, t, tk, u } = x, p = P(r, c);
    K.ringIn(p.x, p.y, cs * 2.6, '#ffd9a8', .25, 180, 0, 3); tk(r, c, 'ignite'); SFX.fx('tick');
    at(175, () => { V.reveal(r, c); SFX.fx('thud'); K.shake(3, 180);
      K.tile(r, c, { size: 1.5, radius: '50%', css: 'background:radial-gradient(circle,#fff 0,#ffe2a8 45%,rgba(255,140,40,0) 78%);', frames: [{ opacity: 1, t: 'scale(.5)' }, { opacity: 0, t: 'scale(1.5)' }], dur: 240 });
      if (t) K.ring(p.x, p.y, cs, '#ffb347', 2.6, 340, 0, 1, 3);
      K.P.burst(p.x, p.y, 40, { k: 'fire', v0: 110 * u, v1: 400 * u, l0: 220, l1: 420, s0: cs * .27, s1: cs * .04, drag: 3, al: .58 });
      K.P.burst(p.x, p.y, 5, { k: 'hot', v0: 30 * u, v1: 120 * u, l0: 140, l1: 240, s0: cs * .24, s1: cs * .05, drag: 3, al: .7 });
      K.P.burst(p.x, p.y, 12, { k: 'ember', v0: 140 * u, v1: 380 * u, g: 500 * u, l0: 300, l1: 520, s0: cs * .07, s1: cs * .02, drag: 1 });
      K.P.burst(p.x, p.y, 4, { k: 'smoke', v0: 10 * u, v1: 50 * u, vy: -50 * u, l0: 400, l1: 700, s0: cs * .3, s1: cs * .7, drag: 1.2, al: .4 }); }); },
  // Meteor: ท้องฟ้ามืด เป้าเตือนหุบเข้า → ลูกไฟพุ่งลงมาพร้อมหางไฟและควัน → กระแทก: รอยไหม้ คลื่นกระแทก เศษหินร้อนกระเด็น
  // ระเบิดสองรอบ = อุกกาบาตสองลูก: ลูกแรกจากขวาบน (e1) → ลูกโซ่รอบแรก → ลูกที่สองจากซ้ายบน (e1b) → ลูกโซ่รอบสอง
  e1(x) { meteor(x, false); },
  e1b(x) { meteor(x, true); },
  // Nuclear: ทุกช่องร้อนขาวเป็นคลื่นจากกลางกระดาน แล้วระเบิดใหญ่
  l2(x) { const { V, at, P } = x, m = K.mid(), cells = [];
    for (let ro = 0; ro < STATE.cells.length; ro++) for (let co = 0; co < STATE.cells[ro].length; co++) { const dd = V.get(ro, co), ce = STATE.cells[ro][co]; if (dd ? dd.toCount > 0 : ce.count > 0) { const p = P(ro, co); cells.push({ ro, co, dist: Math.hypot(p.x - m.x, p.y - m.y) }); } }
    cells.sort((a, b) => a.dist - b.dist); const n = cells.length, G = Math.min(Math.max(1, n), 6); SFX.fx('rise');
    for (let k = 0; k < G && n; k++) { const i0 = Math.floor(k * n / G), part = cells.slice(i0, Math.floor((k + 1) * n / G)); at(40 + k * 60, () => part.forEach((o, j) => V.reveal(o.ro, o.co, some(i0 + j, n) ? 'ignite' : ''))); }
    at(420, () => { FX.HL.nuclear(); SFX.fx('impact'); const u = x.u, cs = x.cs;
      K.P.burst(m.x, m.y, 150, { k: 'fire', v0: 200 * u, v1: 1100 * u, l0: 400, l1: 900, s0: cs * .5, s1: cs * .1, drag: 2.2, al: .55 });
      K.P.burst(m.x, m.y, 70, { k: 'ember', v0: 200 * u, v1: 900 * u, g: 300 * u, l0: 600, l1: 1200, s0: cs * .08, s1: cs * .02, drag: .9 });
      K.P.burst(m.x, m.y, 26, { k: 'smoke', v0: 60 * u, v1: 300 * u, vy: -60 * u, l0: 900, l1: 1500, s0: cs * .7, s1: cs * 2, al: .5, drag: 1.4 }); }); },
  // Big Bang: ทุกช่องของตัวเองร้อนขาว ยุบเข้ากลาง แล้วระเบิดออก
  m2(x) { const { V, at, d } = x, ex = d.exploded || []; SFX.fx('rise');
    ex.forEach(([ro, co], i) => V.reveal(ro, co, some(i, ex.length) ? 'ignite' : ''));
    FX.HL.bigbang();
    at(300, () => { const m = K.mid(), u = x.u, cs = x.cs; SFX.fx('impact');
      K.P.burst(m.x, m.y, 130, { k: 'fire', v0: 200 * u, v1: 1000 * u, l0: 400, l1: 850, s0: cs * .45, s1: cs * .08, drag: 2.2, al: .55 });
      K.P.burst(m.x, m.y, 70, { k: 'violet', v0: 200 * u, v1: 900 * u, l0: 500, l1: 1000, s0: cs * .14, s1: cs * .03, drag: 1.6 });
      K.P.burst(m.x, m.y, 60, { k: 'spark', v0: 300 * u, v1: 1100 * u, l0: 400, l1: 800, s0: cs * .08, s1: cs * .02, drag: 1.4 }); }); },

  // ───────────── โจมตี ─────────────
  // Sniper: เป้าเล็งหมุนเข้าล็อก → เส้นกระสุนจากป้ายคะแนนของผู้ยิง → โดน
  c3(x) { const { r, c, V, at, land, P, cs, t, d, from } = x, tg = d.target || (V.has(r, c) ? [r, c] : null); if (!tg) return; const [tr, tc] = tg, p = P(tr, tc);
    K.tile(tr, tc, { size: 1.5, radius: '50%', prio: 2, dur: 520, css: 'border:2px solid #ff5b6b;background:linear-gradient(#ff5b6b,#ff5b6b) center/2px 100% no-repeat,linear-gradient(#ff5b6b,#ff5b6b) center/100% 2px no-repeat;',
      frames: [{ opacity: 0, t: 'scale(2.4) rotate(90deg)' }, { opacity: 1, t: 'scale(1) rotate(0deg)', offset: .42 }, { opacity: 1, t: 'scale(.92) rotate(0deg)', offset: .62 }, { opacity: 0, t: 'scale(1.3) rotate(0deg)' }] });
    at(250, () => { K.line(from, p, { color: '#ffd9d9', w: 3, dur: 150, grow: .5 }); SFX.fx('zap'); });
    at(300, () => { land(tr, tc, 'hit', ce => { ce.count--; if (ce.count <= 0) ce.owner = -1; }); K.num(tr, tc, -1); K.shake(2.5, 160);
      if (t) K.sparks(p.x, p.y, t === 2 ? 8 : 4, '#ff8a8a', cs * 1.3, { white: true, dur: 320 }); }); },
  // Poke: แทงเข้าช่องศัตรูจากทางผู้ใช้ ช่องสะดุ้ง +1
  c7(x) { const { r, c, V, at, P, cs, t, from } = x, p = P(r, c), dx = from.x - p.x, dy = from.y - p.y, len = Math.hypot(dx, dy) || 1, a = { x: p.x + dx / len * cs * 2.2, y: p.y + dy / len * cs * 2.2 };
    K.comet(a, p, { color: '#ffb347', size: Math.round(cs * .26), tail: cs * 1.1, dur: 150 });
    at(140, () => { const dd = V.get(r, c), n = dd ? dd.toCount : STATE.cells[r][c].count; V.reveal(r, c, 'wob'); K.num(r, c, 1, { color: '#ffb347' }); SFX.fx('pop');
      if (t) K.ring(p.x, p.y, cs, n >= 3 ? '#ff4d5e' : '#ffb347', n >= 3 ? 2.4 : 1.7, 340, 0, 1, 2); }); },
  // Drain: ลูกของศัตรูไหลเป็นสายโค้งมาเข้าช่องเรา
  c9(x) { const { V, at, land, P, cs, d, col } = x, tg = d.target; if (!tg) return; const [tr, tc] = tg, p = P(tr, tc), bo = d.bonusCell;
    K.ringIn(p.x, p.y, cs * 2, '#c77dff', .4, 180);
    at(170, () => { const en = K.PC(V.has(tr, tc) ? V.get(tr, tc).fromOwner : STATE.cells[tr][tc].owner);
      land(tr, tc, 'hit', ce => { ce.count--; if (ce.count <= 0) ce.owner = -1; }); K.num(tr, tc, -1); SFX.fx('slash');
      if (bo) { const q = P(bo[0], bo[1]); [0, 55, 110].forEach((dl, i) => K.fly(p, q, { color: i === 2 ? K.mix(col, '#ffffff', .3) : K.mix(en, '#c77dff', .5), size: Math.round(x.orb * (1 - .15 * i)), dur: 330, delay: dl, arc: cs * .35 })); } });
    if (bo) at(560, () => { land(bo[0], bo[1], 'placed', ce => { ce.count++; }); K.num(bo[0], bo[1], 1); SFX.fx('pop'); }); },
  // Raid: ฟันกากบาทสองครั้ง
  u6(x) { const { r, c, V, at, land, P, cs, t, d, tk } = x, tg = d.target || (V.has(r, c) ? [r, c] : null); if (!tg) return; const [tr, tc] = tg, p = P(tr, tc), L = cs * 1.25;
    [[-1, -1, 1, 1, 0], [1, -1, -1, 1, 120]].forEach(([ax, ay, bx, by, dl]) => at(dl, () => { K.line({ x: p.x + ax * L, y: p.y + ay * L }, { x: p.x + bx * L, y: p.y + by * L }, { color: '#ffd0d0', w: Math.max(4, Math.round(cs * .1)), dur: 190, grow: .45, prio: 2 }); SFX.fx('slash'); if (!dl) tk(tr, tc, 'hit'); }));
    at(190, () => { const en = K.PC(V.has(tr, tc) ? V.get(tr, tc).fromOwner : STATE.cells[tr][tc].owner);
      land(tr, tc, 'hit', ce => { ce.count = Math.max(0, ce.count - 2); if (ce.count <= 0) ce.owner = -1; }); K.num(tr, tc, -2); K.shake(3.5, 180);
      if (t) K.sparks(p.x, p.y, t === 2 ? 10 : 5, en, cs * 1.5, { white: true, dur: 340 }); }); },
  // Barrage: ห่าธนูตกเฉียงลงทุกช่องของเหยื่อ
  r4(x) { const { V, at, land, P, cs, t, d } = x, hits = (d.hit && d.hit.length ? d.hit : V.diff.map(q => [q.r, q.c])), n = hits.length; if (!n) return;
    K.vignette('rgba(110,0,10,.5)', 1000, t ? 1 : .5); SFX.fx('whoosh');
    const G = Math.min(n, 8), cap = t === 2 ? 48 : t === 1 ? 18 : 0, step = Math.max(1, Math.ceil(n / Math.max(1, cap))), ord = hits.map((h, i) => ({ h, p: P(h[0], h[1]), i })).sort((a, b) => (a.p.x + a.p.y) - (b.p.x + b.p.y));
    for (let k = 0; k < G; k++) { const i0 = Math.floor(k * n / G), part = ord.slice(i0, Math.floor((k + 1) * n / G)), tm = 200 + k * 62;
      part.forEach(o => { if (cap && o.i % step === 0) K.comet({ x: o.p.x - cs * 1.6, y: o.p.y - cs * 3.2 }, o.p, { color: '#ffd34d', size: Math.max(4, Math.round(cs * .12)), tail: cs * 1.3, dur: 190, delay: tm - 190 }); });
      at(tm, () => { part.forEach((o, j) => { land(o.h[0], o.h[1], some(i0 + j, n) ? 'hit' : '', ce => { ce.count--; if (ce.count <= 0) ce.owner = -1; }); if (j === 0 && t) K.sparks(o.p.x, o.p.y, 3, '#ffb0b0', cs, { dur: 240 });
          if (cap && o.i % step === 0) K.P.burst(o.p.x, o.p.y + cs * .2, 5, { k: 'dust', a0: -2.6, a1: -.54, v0: 40 * x.u, v1: 150 * x.u, l0: 300, l1: 520, s0: cs * .16, s1: cs * .42, al: .5, drag: 2 }); }); if (k % 3 === 0) SFX.fx('slash'); }); }
    at(200 + G * 62, () => { K.shake(5, 240); SFX.fx('thud'); }); },
  // Steal: ไฟดับ เหลือแสงส่องช่องเป้าหมาย → แสงม่วงตวัดผ่าน ช่องพลิกเป็นสีของเรา → ของที่ขโมยไหลกลับไปหาป้ายคะแนนของคนขโมย
  e3(x) { const { r, c, V, at, P, cs, g, t, tk, col, from, u } = x, p = P(r, c); SFX.fx('dark');
    const spot = K.clip(0, `left:0;top:0;width:100%;height:100%;background:radial-gradient(circle ${Math.round(cs * 1.5)}px at ${(p.x - g.wx).toFixed(1)}px ${(p.y - g.wy).toFixed(1)}px,rgba(0,0,0,0) 0,rgba(0,0,0,0) 52%,rgba(6,2,16,.84) 100%);`);
    if (spot) { spot.animate([{ opacity: 0 }, { opacity: 1, offset: .16 }, { opacity: 1, offset: .62 }, { opacity: 0 }], { duration: 780, easing: 'ease-out' }); K.hold(800); }
    K.ringIn(p.x, p.y, cs * 2.4, '#c98bff', .45, 240, 60, 2);
    at(240, () => { SFX.fx('slash'); K.comet({ x: p.x - cs * 1.8, y: p.y + cs * .5 }, { x: p.x + cs * 1.8, y: p.y - cs * .5 }, { color: '#c98bff', size: Math.max(5, Math.round(cs * .16)), tail: cs * 1.6, dur: 170, prio: 2 }); });
    at(300, () => tk(r, c, 'flip'));
    at(435, () => { V.reveal(r, c); SFX.fx('pop'); if (t) K.ring(p.x, p.y, cs, col, 2.1, 340, 0, 1, 3);
      K.P.burst(p.x, p.y, 18, { k: 'violet', v0: 60 * u, v1: 240 * u, l0: 260, l1: 480, s0: cs * .12, s1: cs * .03, drag: 2.4 }); });
    at(470, () => { const dx = from.x - p.x, dy = from.y - p.y;
      K.P.stream({ at: k => ({ x: p.x + dx * k, y: p.y + dy * k - Math.sin(k * 3.1416) * cs * .9 }), dur: 290, rate: 110, k: 'violet', jx: cs * .08, jy: cs * .08, v0: 5 * u, v1: 40 * u, l0: 200, l1: 380, s0: cs * .11, s1: cs * .03, drag: 1 });
      K.fly(p, from, { color: K.mix(col, '#ffffff', .35), size: x.orb, dur: 290, lift: cs * .9, prio: 2 }); });
    at(760, () => { SFX.fx('chime'); K.ring(from.x, from.y, 40, col, 2, 320, 0, 1, 3); }); },
  // Invasion: ลำแสงจากด้านบนลงทีละช่อง ช่องพลิกเป็นสีของเรา
  l4(x) { const { V, at, P, cs, g, t, tk, d, col } = x, inv = d.invaded || [], lite = K.mix(col, '#ffffff', .25); K.vignette('rgba(90,20,160,.45)', 950, t ? 1 : .5); SFX.fx('dark');
    inv.forEach(([ro, co], i) => { const p = P(ro, co), dl = i * 150;
      at(dl, () => { K.line({ x: p.x, y: g.wy - 40 }, { x: p.x, y: p.y + cs * .45 }, { w: Math.round(cs * .72), bg: `linear-gradient(180deg,transparent,${lite} 30%,#fff 50%,${lite} 70%,transparent)`, dur: 430, grow: .3, hold: .6, glow: false, prio: 2 }); SFX.fx('rise'); });
      at(dl + 150, () => tk(ro, co, 'flip'));
      at(dl + 285, () => { V.reveal(ro, co); SFX.fx('pop'); K.P.burst(p.x, p.y, 16, { k: 'violet', v0: 60 * x.u, v1: 260 * x.u, l0: 260, l1: 480, s0: cs * .12, s1: cs * .03, drag: 2.4 }); if (t) { K.ring(p.x, p.y, cs, col, 2.2, 360, 0, 1, 3); K.sparks(p.x, p.y, t === 2 ? 6 : 3, col, cs * 1.2, { white: true, dur: 300 }); } }); }); },
  // Annihilate: จอมืดแดง ฟันกากบาทข้ามทั้งกระดาน ช่องของเหยื่อสลายเป็นเถ้าจากกลางออกไป
  l1(x) { const { V, at, P, cs, g, t, tk, d } = x, cells = (d.wiped && d.wiped.length ? d.wiped : V.diff.map(q => [q.r, q.c])).map(q => ({ q, p: P(q[0], q[1]) })), n = cells.length;
    K.vignette('rgba(70,0,0,.8)', 1400, t ? 1 : .5); SFX.fx('dark');
    const sh = K.clip(0, 'left:0;top:0;width:100%;height:100%;background:#1a0000;'); if (sh) { sh.animate([{ opacity: 0 }, { opacity: .55, offset: .15 }, { opacity: .55, offset: .7 }, { opacity: 0 }], { duration: 1350, easing: 'ease-out' }); K.hold(1380); }
    const A = { x: g.wx - 10, y: g.wy - 10 }, B = { x: g.wx + g.ww + 10, y: g.wy + g.wh + 10 }, C = { x: g.wx + g.ww + 10, y: g.wy - 10 }, D = { x: g.wx - 10, y: g.wy + g.wh + 10 }, w = Math.max(8, Math.round(cs * .2));
    at(150, () => { K.line(A, B, { color: '#ff3b3b', w, dur: 300, grow: .3, hold: .55, prio: 2 }); SFX.fx('slash'); K.shake(6, 240); });
    at(310, () => { K.line(C, D, { color: '#ff3b3b', w, dur: 300, grow: .3, hold: .55, prio: 2 }); SFX.fx('slash'); K.shake(6, 240); });
    if (n) { const m = K.mid(), G = Math.min(n, 8), cap = t === 2 ? 30 : t === 1 ? 12 : 0, step = Math.max(1, Math.ceil(n / Math.max(1, cap)));
      cells.forEach(o => { o.dist = Math.hypot(o.p.x - m.x, o.p.y - m.y); }); cells.sort((a, b) => a.dist - b.dist);
      for (let k = 0; k < G; k++) { const i0 = Math.floor(k * n / G), part = cells.slice(i0, Math.floor((k + 1) * n / G)), tm = 470 + k * 58;
        at(tm, () => part.forEach((o, j) => { if (some(i0 + j, n)) tk(o.q[0], o.q[1], 'ash', 300); if (cap && (i0 + j) % step === 0) { K.sparks(o.p.x, o.p.y, 4, '#8a2a2a', cs * 1.2, { dur: 520, grav: -16 });
          K.P.burst(o.p.x, o.p.y, 6, { k: 'ash', jx: cs * .3, jy: cs * .3, v0: 10 * x.u, v1: 60 * x.u, vy: -70 * x.u, l0: 600, l1: 1100, s0: cs * .16, s1: cs * .42, al: .7, drag: .8, wob: 30 * x.u });
          K.P.burst(o.p.x, o.p.y, 3, { k: 'ember', v0: 40 * x.u, v1: 160 * x.u, g: -90 * x.u, l0: 500, l1: 900, s0: cs * .06, s1: cs * .02, drag: .6 }); } }));
        at(tm + 255, () => part.forEach(o => V.reveal(o.q[0], o.q[1]))); } }
    at(1010, () => { const m = K.mid(); K.flash('#ff2a2a', 320, .26); K.shake(8, 320); SFX.fx('impact');
      K.P.burst(m.x, m.y, 90, { k: 'ember', jx: g.ww * .45, jy: g.wh * .45, v0: 60 * x.u, v1: 320 * x.u, g: -120 * x.u, l0: 600, l1: 1200, s0: cs * .08, s1: cs * .02, drag: .5, wob: 40 * x.u }); }); },

  // ───────────── ป้องกัน / ล็อก ─────────────
  // Shield: แผ่นหกเหลี่ยมกดลงล็อกช่อง
  c8(x) { const { r, c, at, P, cs, t, tk } = x, p = P(r, c);
    K.tile(r, c, { size: 1.12, radius: '0', prio: 2, dur: 500, ease: 'cubic-bezier(.3,.9,.4,1)', css: `clip-path:${HEX};-webkit-clip-path:${HEX};background:linear-gradient(135deg,#f0fff8,#6fe3b4 48%,#e6fff5 56%,#48c99a);`,
      frames: [{ opacity: 0, t: 'scale(2.3)' }, { opacity: 1, t: 'scale(.9)', offset: .38 }, { opacity: 1, t: 'scale(1.03)', offset: .55 }, { opacity: .85, t: 'scale(1)', offset: .75 }, { opacity: 0, t: 'scale(1)' }] });
    at(185, () => { tk(r, c, 'squash'); SFX.fx('lock'); if (t) { K.ring(p.x, p.y, cs, '#7dfcc8', 2, 340, 0, 1, 3); K.sparks(p.x, p.y, t === 2 ? 6 : 3, '#c8ffe9', cs * 1.1, { white: true, dur: 280 }); } }); },
  // Wall: แผ่นอิฐหล่นลงมาทีละช่อง
  u4(x) { const { at, P, cs, t, tk, d } = x, cells = d.shielded || [];
    cells.forEach(([ro, co], i) => { const p = P(ro, co), dl = i * 95;
      K.tile(ro, co, { prio: 2, dur: 520, delay: dl, ease: 'cubic-bezier(.5,0,.6,1)', css: 'background:repeating-linear-gradient(0deg,#d98a5f 0 30%,#7a3a22 30% 34%),#d98a5f;box-shadow:inset 0 0 0 2px #6a2f1a;',
        frames: [{ opacity: 0, y: -cs * 1.5, t: 'scale(1.05)' }, { opacity: 1, y: -cs * .9, t: 'scale(1.05)', offset: .2 }, { opacity: 1, y: 0, t: 'scale(1.05,.9)', offset: .5 }, { opacity: 1, y: 0, t: 'scale(1)', offset: .62 }, { opacity: .9, y: 0, t: 'scale(1)', offset: .8 }, { opacity: 0, y: 0, t: 'scale(1)' }] });
      at(dl + 255, () => { tk(ro, co, 'squash'); SFX.fx('thud'); if (t) K.sparks(p.x, p.y + cs * .4, t === 2 ? 6 : 3, '#e8c9a8', cs, { dur: 300, grav: -6 }); if (i === cells.length - 1) K.shake(3, 180); }); }); },
  // Pin: หมุดโลหะพุ่งลงปักช่อง
  u9(x) { const { r, c, at, P, cs, t, tk, d } = x, tg = d.target || [r, c], tr = tg[0], tc = tg[1], p = P(tr, tc), w = Math.max(8, Math.round(cs * .22)), h = Math.round(cs * 1.3);
    K.box(p.x, p.y - h / 2, w, h, `clip-path:${TRI};-webkit-clip-path:${TRI};background:linear-gradient(90deg,#8d96a8,#f4f7ff 45%,#6b7385);`,
      [{ opacity: 0, y: -cs * 2.2 }, { opacity: 1, y: -cs * 1.6, offset: .12 }, { opacity: 1, y: 0, offset: .36 }, { opacity: 1, y: 0, offset: .8 }, { opacity: 0, y: 0 }], { duration: 500, easing: 'cubic-bezier(.6,0,.8,1)' }, 2);
    at(180, () => { tk(tr, tc, 'squash'); SFX.fx('lock'); const el = K.cellEl(tr, tc); if (el) el.classList.add('pinned');
      if (t) { K.ring(p.x, p.y, cs, '#ff7ad9', 2, 320, 0, 1, 3); K.sparks(p.x, p.y, t === 2 ? 6 : 3, '#ffd0f0', cs, { dur: 260 }); } }); },
  // Sever: ฟันตัดช่อง แล้วกรอบแดงรัดเข้า
  sr1(x) { const { r, c, r2, c2, at, P, cs, tk } = x;
    [[r, c], [r2, c2]].filter(q => q[0] !== undefined).forEach(([ro, co], i) => { const p = P(ro, co), dl = i * 130;
      at(dl, () => { K.line({ x: p.x - cs * .9, y: p.y - cs * .35 }, { x: p.x + cs * .9, y: p.y + cs * .35 }, { color: '#ffb199', w: Math.max(4, Math.round(cs * .09)), dur: 190, grow: .45, prio: 2 }); SFX.fx('slash'); });
      at(dl + 80, () => { tk(ro, co, 'squash'); SFX.fx('lock'); K.P.burst(p.x, p.y, 12, { k: 'spark', v0: 80 * x.u, v1: 300 * x.u, g: 500 * x.u, l0: 180, l1: 360, s0: cs * .07, s1: cs * .02, drag: 1 });
        K.tile(ro, co, { css: 'box-shadow:inset 0 0 0 3px #ff6a3d,0 0 10px #ff6a3d;', frames: [{ opacity: 0, t: 'scale(1.35)' }, { opacity: 1, t: 'scale(1)', offset: .3 }, { opacity: 1, t: 'scale(1)', offset: .7 }, { opacity: 0, t: 'scale(1)' }], dur: 420 }); }); }); },
  // Freeze: น้ำแข็งพุ่งไปหาผู้เล่นที่โดน (FX.HL.freeze) + แผ่นน้ำแข็งเคลือบป้ายคะแนนและช่องของเขา
  r3(x) { const { at, t, d } = x, who = d.frozenPlayer === undefined ? -1 : d.frozenPlayer; FX.HL.freeze(who); if (who < 0) return;
    const b = K.badge(who), ICE = 'linear-gradient(135deg,rgba(242,253,255,.92),rgba(143,220,255,.75) 50%,rgba(232,251,255,.92))';
    K.box(b.x, b.y, b.w + 8, b.h + 8, `border-radius:14px;background:${ICE};box-shadow:0 0 18px #bff1ff;`, [{ opacity: 0, t: 'scale(1.25)' }, { opacity: 0, t: 'scale(1.25)', offset: .62 }, { opacity: .9, t: 'scale(1)', offset: .72 }, { opacity: .75, t: 'scale(1)', offset: .92 }, { opacity: 0, t: 'scale(1)' }], { duration: 1150, easing: 'ease-out' }, 2);
    at(800, () => SFX.fx('ice'));
    if (!t) return;
    const cells = []; for (let ro = 0; ro < STATE.cells.length; ro++) for (let co = 0; co < STATE.cells[ro].length; co++) if (STATE.cells[ro][co].owner === who && STATE.cells[ro][co].count > 0) cells.push([ro, co]);
    const step = Math.max(1, Math.ceil(cells.length / (t === 2 ? 26 : 10)));
    cells.forEach(([ro, co], i) => { if (i % step) return; K.tile(ro, co, { css: `background:${ICE};box-shadow:inset 0 0 0 2px #e8fbff;`, frames: [{ opacity: 0, t: 'scale(1.3)' }, { opacity: .9, t: 'scale(1)', offset: .3 }, { opacity: .8, t: 'scale(1)', offset: .7 }, { opacity: 0, t: 'scale(1)' }], dur: 620, delay: 260 + (i / step % 4) * 55 }); }); },

  // ───────────── ย้าย / สลับ ─────────────
  // Spin: กองลูกหมุนตัวไปช่องข้างๆ
  c5(x) { const { V, at, P, cs, t, d, col } = x, mv = (d.moves || [])[0]; if (!mv) return; const fr = mv.from, to = mv.to, a = P(fr[0], fr[1]), b = P(to[0], to[1]), sp = K.sprite(fr[0], fr[1]), dx = b.x - a.x, dy = b.y - a.y;
    SFX.fx('whoosh'); V.reveal(fr[0], fr[1]);
    if (sp) sp.go([{ x: 0, y: 0, t: 'scale(1) rotate(0deg)' }, { x: dx * .5, y: dy * .5, t: 'scale(1.18) rotate(200deg)', offset: .5 }, { x: dx, y: dy, t: 'scale(.9) rotate(360deg)', offset: .92 }, { x: dx, y: dy, t: 'scale(.9) rotate(360deg)', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.4,0,.5,1)' });
    at(sp ? 270 : 0, () => { V.reveal(to[0], to[1], 'placed'); SFX.fx('pop'); if (t) K.ring(b.x, b.y, cs, col, 1.8, 300, 0, 1, 2); }); },
  // Attract: วงแหวนหุบเข้า ลูกจากช่องข้างๆ ถูกดูดเข้ามา
  c6(x) { const { r, c, V, at, P, cs, d, col } = x, to = d.to || [r, c], p = P(to[0], to[1]), pulled = d.pulled || [];
    K.ringIn(p.x, p.y, cs * 3, col, .3, 260); K.ringIn(p.x, p.y, cs * 3, '#ffffff', .3, 260, 120, 2); SFX.fx('whoosh');
    at(90, () => pulled.forEach(([pr, pc]) => { V.reveal(pr, pc); K.fly(P(pr, pc), p, { color: K.mix(col, '#ffffff', .3), size: x.orb, dur: 230, ease: 'cubic-bezier(.6,0,.9,.5)' }); }));
    at(330, () => { V.reveal(to[0], to[1], 'placed'); SFX.fx('pop'); }); },
  // Swap: สองช่องยกตัวขึ้น โค้งสวนกันไปลงที่ของอีกฝ่าย
  u2(x) { const { r, c, r2, c2, V, at, P, cs } = x; if (r2 === undefined) return; const a = P(r, c), b = P(r2, c2), s1 = K.sprite(r, c), s2 = K.sprite(r2, c2), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len * cs * .7, ny = dx / len * cs * .7;
    SFX.fx('whoosh');
    if (s1 && s2) { V.blank(r, c); V.blank(r2, c2); const o = { duration: 340, easing: 'cubic-bezier(.4,0,.4,1)' };
      s1.go([{ x: 0, y: 0, t: 'scale(1)' }, { x: dx / 2 + nx, y: dy / 2 + ny, t: 'scale(1.2)', offset: .5 }, { x: dx, y: dy, t: 'scale(1)' }], o);
      s2.go([{ x: 0, y: 0, t: 'scale(1)' }, { x: -dx / 2 - nx, y: -dy / 2 - ny, t: 'scale(1.2)', offset: .5 }, { x: -dx, y: -dy, t: 'scale(1)' }], o); }
    else { if (s1) s1.el.remove(); if (s2) s2.el.remove(); }
    at(s1 && s2 ? 330 : 0, () => { V.reveal(r, c, 'placed'); V.reveal(r2, c2, 'placed'); SFX.fx('pop'); }); },
  // Shuffle Zone: กองลูกใน 3×3 หมุนวนเข้ากลาง แล้วกระจายลงที่ใหม่
  u7(x) { const { r, c, V, at, P, cs, t, d } = x, zone = d.zone || [], p = P(r, c); SFX.fx('whoosh');
    const sps = zone.map(([ro, co]) => { const s = K.sprite(ro, co); if (s && !s.has) { s.el.remove(); return null; } return s; }).filter(Boolean);
    sps.forEach(s => { const dx = p.x - s.p.x, dy = p.y - s.p.y; s.go([{ x: 0, y: 0, t: 'scale(1) rotate(0deg)' }, { x: dx * .4 - dy * .5, y: dy * .4 + dx * .5, t: 'scale(.85) rotate(160deg)', offset: .45 }, { x: dx, y: dy, t: 'scale(.3) rotate(340deg)', offset: .92 }, { x: dx, y: dy, t: 'scale(.3) rotate(340deg)', opacity: 0 }], { duration: 290, easing: 'cubic-bezier(.4,0,.8,.6)' }); });
    if (sps.length) zone.forEach(([ro, co]) => V.blank(ro, co));
    at(sps.length ? 285 : 0, () => { SFX.fx('pop'); if (t) { K.ring(p.x, p.y, cs, '#c98bff', 3, 360, 0, 1, 3); K.sparks(p.x, p.y, t === 2 ? 12 : 6, '#c98bff', cs * 1.8, { white: true, dur: 340 }); } });
    zone.forEach(([ro, co], i) => at((sps.length ? 330 : 40) + i * 22, () => V.reveal(ro, co, 'placed'))); },
  // Mirror: ภาพสะท้อนของช่องศัตรูเลื่อนมาทับช่องเรา ช่องเราพลิกเป็นจำนวนเดียวกัน
  u8(x) { const { V, at, P, cs, t, d, tk } = x, mv = (d.moves || [])[0]; if (!mv) return; const fr = mv.from, to = mv.to, a = P(fr[0], fr[1]), b = P(to[0], to[1]), sp = K.sprite(fr[0], fr[1]);
    K.tile(fr[0], fr[1], { css: 'background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,.9) 50%,transparent 70%);', frames: [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 0 }], dur: 260 }); SFX.fx('chime');
    if (sp) sp.go([{ x: 0, y: 0, t: 'scale(1)', opacity: .85 }, { x: b.x - a.x, y: b.y - a.y, t: 'scale(.95)', opacity: .85, offset: .9 }, { x: b.x - a.x, y: b.y - a.y, t: 'scale(.95)', opacity: 0 }], { duration: 300, delay: 60, easing: 'cubic-bezier(.4,0,.3,1)' });
    at(sp ? 330 : 60, () => { tk(to[0], to[1], 'flip'); if (t) K.ring(b.x, b.y, cs, '#9fe4ff', 1.9, 320, 0, 1, 2); });
    at(sp ? 465 : 195, () => { V.reveal(to[0], to[1]); SFX.fx('pop'); }); },
  // Tornado: พายุหมุนกวาดข้ามกระดาน ลูกที่โดนปลิวไปช่องข้างๆ
  r5(x) { const { V, at, P, cs, g, t, d, pi } = x, moves = d.moves || []; SFX.fx('whoosh'); at(350, () => SFX.fx('whoosh'));
    const size = Math.round(Math.min(g.ww, g.wh) * .9), cy = g.wh / 2;
    const el = t ? K.clip(0, `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:50%;background:conic-gradient(from 0deg,transparent,rgba(235,245,255,.75) 12%,transparent 26%,rgba(200,220,240,.6) 46%,transparent 60%,rgba(235,245,255,.7) 80%,transparent);-webkit-mask-image:radial-gradient(circle,transparent 8%,#000 26%,transparent 68%);mask-image:radial-gradient(circle,transparent 8%,#000 26%,transparent 68%);`) : null;
    if (el) { el.animate([{ transform: `translate(${-size * .3}px,${cy + g.wh * .12}px) rotate(0deg) scale(.7)`, opacity: 0 }, { transform: `translate(${g.ww * .25}px,${cy - g.wh * .1}px) rotate(300deg) scale(1)`, opacity: .9, offset: .25 }, { transform: `translate(${g.ww * .7}px,${cy + g.wh * .08}px) rotate(720deg) scale(1)`, opacity: .9, offset: .72 }, { transform: `translate(${g.ww + size * .3}px,${cy - g.wh * .05}px) rotate(1000deg) scale(.8)`, opacity: 0 }], { duration: 1000, easing: 'linear' }); K.hold(1040); }
    K.P.stream({ at: k => ({ x: g.wx + g.ww * (-.05 + 1.1 * k), y: g.wy + cy + Math.sin(k * 6.2832) * g.wh * .1 }), dur: 1000, rate: 80, k: 'dust', jx: size * .3, jy: size * .3, v0: 60 * x.u, v1: 260 * x.u, l0: 300, l1: 700, s0: cs * .1, s1: cs * .24, al: .5, drag: 1 });
    const cap = t === 2 ? 28 : t === 1 ? 12 : 0;
    moves.forEach((mv, i) => { const a = P(mv.from[0], mv.from[1]), b = P(mv.to[0], mv.to[1]), tm = Math.round(150 + Math.max(0, Math.min(1, (a.x - g.wx) / g.ww)) * 560);
      at(tm, () => { V.reveal(mv.from[0], mv.from[1]); if (i < cap) K.fly(a, b, { color: K.mix(K.PC(mv.owner === undefined ? pi : mv.owner), '#ffffff', .3), size: x.orb, dur: 260, arc: cs * .5 }); });
      at(tm + 250, () => V.reveal(mv.to[0], mv.to[1], i < cap ? 'placed' : '')); });
    at(520, () => K.shake(3, 300)); },
  // Gift: ช่องเราได้ +2 แล้วโยนห่อไปตกช่องศัตรู (ศัตรูได้ +1 เข้าใกล้ระเบิด)
  u10(x) { const { r, c, V, at, P, cs, t, d } = x, p = P(r, c), en = (d.boosted || []).slice(1);
    V.reveal(r, c, 'first'); K.num(r, c, 2, { color: '#88ffaa' }); SFX.fx('rise');
    en.forEach(([er, ec], i) => { const q = P(er, ec), dl = 140 + i * 120;
      K.fly(p, q, { color: '#ffd34d', size: Math.round(x.orb * 1.1), dur: 380, delay: dl, lift: cs * 1.2, ease: 'cubic-bezier(.3,0,.7,1)' });
      at(dl + 365, () => { V.reveal(er, ec, 'wob'); K.num(er, ec, 1, { color: '#ffb347' }); SFX.fx('pop'); if (t) K.ring(q.x, q.y, cs, '#ff7a45', 1.9, 320, 0, 1, 2); }); }); },
  // Exchange: ช่องเราได้ +2 พลังไหลตามเส้นไปกดช่องศัตรู −2
  c4(x) { const { r, c, V, at, land, P, cs, t, d } = x, p = P(r, c); let en = d.enemyCell;
    if (!en) { const o = V.diff.find(q => !(q.r === r && q.c === c)); if (o) en = [o.r, o.c]; }
    V.reveal(r, c, 'first'); K.num(r, c, 2, { color: '#88ffaa' }); SFX.fx('rise');
    if (t) K.ring(p.x, p.y, cs, '#ffd34d', 2, 360, 0, 1, 2);
    if (!en) return; const er = en[0], ec = en[1], q = P(er, ec);
    at(200, () => K.line(p, q, { color: '#ffd34d', w: 2, dur: 420, grow: .35, hold: .7 }));
    at(300, () => K.comet(p, q, { color: '#7a4ad6', size: Math.round(cs * .3), tail: cs * .9, dur: 230 }));
    at(520, () => { land(er, ec, 'hit', ce => { ce.count = Math.max(0, ce.count - 2); if (ce.count === 0) ce.owner = -1; }); K.num(er, ec, -2); SFX.fx('thud'); K.shake(2.5, 160);
      if (t) K.sparks(q.x, q.y, t === 2 ? 8 : 4, '#b58cff', cs * 1.3, { white: true, dur: 320 }); }); },
  // Gamble: ตัวเลขหมุนเหนือช่อง แล้วหยุดที่ผล
  c13(x) { const { r, c, V, at, P, cs, t, d } = x, p = P(r, c), v = d.value || 0, fs = Math.round(Math.max(18, cs * .6));
    const el = K.text(p.x, p.y - cs * .95, '?', `font-size:${fs}px;font-weight:900;color:#fff;background:rgba(12,10,30,.88);border:2px solid #fff;border-radius:8px;padding:2px 9px;`,
      [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .1 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .62 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.3)', offset: .7 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .9 }, { opacity: 0, transform: 'translate(-50%,-70%) scale(1)' }], { duration: 800, easing: 'linear' }, 2);
    ['+2', '-1', '0', '+1', '-2', '+1', '-2'].forEach((s, i) => at(60 + i * 62, () => { if (el) el.textContent = s; SFX.fx('tick'); }));
    at(500, () => { const colr = v > 0 ? '#7dffa8' : v < 0 ? '#ff7d8a' : '#ffffff'; if (el) { el.textContent = (v > 0 ? '+' : '') + v; el.style.color = colr; el.style.borderColor = colr; }
      V.reveal(r, c, v > 0 ? 'placed' : v < 0 ? 'hit' : ''); SFX.fx(v > 0 ? 'pop' : v < 0 ? 'thud' : 'tick'); if (t && v) K.ring(p.x, p.y, cs, colr, 1.9, 320, 0, 1, 2); }); },

  // ───────────── กระดาน / พิเศษ ─────────────
  // Void: ช่องยุบหมุนหายเข้าไปในหลุมดำสี่เหลี่ยม
  r7(x) { const { r, c, V, at, P, cs, t } = x, p = P(r, c), sp = K.sprite(r, c); SFX.fx('dark');
    K.ringIn(p.x, p.y, cs * 2.6, '#9d5cff', .3, 240, 0, 3);
    K.P.stream({ at: p, to: p, dur: 240, rate: 110, k: 'violet', jx: cs * 1.5, jy: cs * 1.5, v0: 240 * x.u, v1: 420 * x.u, l0: 200, l1: 330, s0: cs * .1, s1: cs * .02, drag: 0 });
    if (sp) { V.blank(r, c); sp.go([{ x: 0, y: 0, t: 'scale(1) rotate(0deg)' }, { x: 0, y: 0, t: 'scale(.05) rotate(220deg)', offset: .9 }, { x: 0, y: 0, t: 'scale(.05) rotate(220deg)', opacity: 0 }], { duration: 270, easing: 'cubic-bezier(.6,0,.9,.5)' }); }
    K.tile(r, c, { prio: 2, dur: 640, delay: 60, css: 'background:radial-gradient(circle,#000 50%,#2a0d55 78%,#7b3fe0 100%);', frames: [{ opacity: 0, t: 'scale(.2)' }, { opacity: 1, t: 'scale(1.08)', offset: .35 }, { opacity: 1, t: 'scale(1)', offset: .75 }, { opacity: 0, t: 'scale(1)' }] });
    at(290, () => { V.reveal(r, c); if (t) K.sparks(p.x, p.y, t === 2 ? 8 : 4, '#b58cff', cs * 1.2, { dur: 320 }); }); },
  // Time Bomb: ลูกระเบิดหล่นลงช่อง แล้วเต้นแดงสองจังหวะ
  u5(x) { const { r, c, at, P, cs, tk } = x, p = P(r, c), sz = Math.round(cs * .6);
    K.box(p.x, p.y, sz, sz, 'border-radius:50%;background:radial-gradient(circle at 34% 30%,#8a8a96,#16161c 62%);box-shadow:0 0 0 2px #ff4d4d,0 0 12px #ff4d4d;',
      [{ opacity: 0, y: -cs * 1.8, t: 'scale(1.3)' }, { opacity: 1, y: -cs * 1.2, t: 'scale(1.3)', offset: .15 }, { opacity: 1, y: 0, t: 'scale(1.15,.85)', offset: .42 }, { opacity: 1, y: 0, t: 'scale(1)', offset: .55 }, { opacity: 1, y: 0, t: 'scale(1)', offset: .85 }, { opacity: 0, y: 0, t: 'scale(.7)' }], { duration: 560, easing: 'cubic-bezier(.5,0,.7,1)' }, 2);
    at(235, () => { tk(r, c, 'squash'); SFX.fx('thud'); });
    K.P.stream({ at: { x: p.x + cs * .14, y: p.y - cs * .28 }, delay: 240, dur: 300, rate: 70, k: 'spark', a0: -2.4, a1: -.7, v0: 60 * x.u, v1: 220 * x.u, g: 500 * x.u, l0: 150, l1: 320, s0: cs * .07, s1: cs * .02 });
    [270, 430].forEach(dl => at(dl, () => { SFX.fx('tick'); K.ring(p.x, p.y, cs, '#ff4d4d', 2.1, 300, 0, 1, 2); })); },
  // Eclipse: กระดานมืดลง เงาดวงจันทร์เคลื่อนผ่าน มีวงแสงตอนบังเต็มดวง
  sr2(x) { const { at, g, t } = x, dm = Math.round(Math.min(g.ww, g.wh) * 1.1); SFX.fx('dark');
    const sh = K.clip(0, 'left:0;top:0;width:100%;height:100%;background:#04020e;');
    if (sh) { sh.animate([{ opacity: 0 }, { opacity: .78, offset: .35 }, { opacity: .78, offset: .65 }, { opacity: 0 }], { duration: 920, easing: 'ease-in-out' }); K.hold(960); }
    const moon = t ? K.clip(1, `width:${dm}px;height:${dm}px;margin:${-dm / 2}px 0 0 ${-dm / 2}px;border-radius:50%;background:radial-gradient(circle,#000 0 60%,rgba(255,214,150,.95) 62%,rgba(255,214,150,0) 72%);`) : null;
    if (moon) moon.animate([{ transform: `translate(${g.ww + dm * .6}px,${g.wh * .42}px)`, opacity: 1 }, { transform: `translate(${g.ww / 2}px,${g.wh / 2}px)`, opacity: 1, offset: .5 }, { transform: `translate(${-dm * .6}px,${g.wh * .58}px)`, opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.3,.1,.7,.9)' });
    at(430, () => { const m = K.mid(); if (t) K.rings(m.x, m.y, ['#ffe2b0', '#ffffff'], Math.round(dm * .6), 1.5, 520, 90); K.flash('#ffe2b0', 260, .14); }); },
  // Balance: เส้นระดับกวาดจากบนลงล่าง แถวไหนโดนเส้น ลูกในแถวนั้นถูกเกลี่ย
  ep3(x) { const { V, at, P, cs, g, t } = x; SFX.fx('rise');
    const bar = K.clip(0, 'left:0;top:0;width:100%;height:6px;margin-top:-3px;background:linear-gradient(90deg,transparent,#cfe0ff 15%,#fff 50%,#cfe0ff 85%,transparent);box-shadow:0 0 14px #9cc4ff;');
    if (bar) { bar.animate([{ transform: 'translateY(0px)', opacity: 0 }, { transform: 'translateY(0px)', opacity: 1, offset: .12 }, { transform: `translateY(${g.wh}px)`, opacity: 1, offset: .78 }, { transform: `translateY(${g.wh}px)`, opacity: 0 }], { duration: 900, easing: 'linear' }); K.hold(940); }
    K.P.stream({ at: k => ({ x: g.wx + Math.random() * g.ww, y: g.wy + k * g.wh }), delay: 108, dur: 594, rate: 120, k: 'ice', v0: 5 * x.u, v1: 50 * x.u, l0: 250, l1: 500, s0: cs * .1, s1: cs * .02, drag: 1 });
    const rows = {}, n = V.diff.length; V.diff.forEach((q, i) => { const p = P(q.r, q.c), k = Math.round((p.y - g.wy) / g.step); (rows[k] = rows[k] || []).push({ q, y: p.y - g.wy, i }); });
    Object.keys(rows).forEach(k => at(Math.round(108 + Math.max(0, Math.min(1, rows[k][0].y / g.wh)) * 594), () => rows[k].forEach(o => V.reveal(o.q.r, o.q.c, some(o.i, n) ? 'lvl' : ''))));
    at(760, () => { SFX.fx('chime'); const m = K.mid(); K.P.burst(m.x, m.y, 40, { k: 'ice', v0: 80 * x.u, v1: 420 * x.u, l0: 300, l1: 600, s0: cs * .1, s1: cs * .02, drag: 2 }); if (t) K.ring(m.x, m.y, cs * 2, '#cfe0ff', Math.max(g.ww, g.wh) / (cs * 2), 520, 0, 1, 3); }); },
  // Dominion: รัศมีทองแผ่จากกลางกระดาน ช่องว่างถูกยึดเป็นวงออกไป
  l3(x) { const { at, land, P, cs, g, t, d, pi } = x, own = d.owner === undefined ? pi : d.owner, m = K.mid(),
      cells = (d.empties || []).map(q => { const p = P(q[0], q[1]); return { q, dist: Math.hypot(p.x - m.x, p.y - m.y) }; }).sort((a, b) => a.dist - b.dist), n = cells.length;
    K.flash('#ffd34d', 420, .2); SFX.fx('rise');
    K.P.burst(m.x, m.y, 70, { k: 'gold', v0: 120 * x.u, v1: 700 * x.u, l0: 500, l1: 1000, s0: cs * .12, s1: cs * .02, drag: 1.6 });
    if (t) { K.rays(m.x, m.y, '#ffd34d', Math.round(Math.max(g.ww, g.wh) * 1.2), 1250, 0, .75); K.ring(m.x, m.y, cs * 2, '#ffe07a', Math.max(g.ww, g.wh) / (cs * 2) * 1.3, 950, 120, 2, 4); }
    const G = Math.min(Math.max(1, n), 8), cap = t === 2 ? 44 : t === 1 ? 18 : 0, step = Math.max(1, Math.ceil(n / Math.max(1, cap)));
    for (let k = 0; k < G && n; k++) { const i0 = Math.floor(k * n / G), part = cells.slice(i0, Math.floor((k + 1) * n / G));
      at(150 + k * 95, () => { part.forEach((o, j) => { land(o.q[0], o.q[1], some(i0 + j, n) ? 'placed' : '', ce => { ce.owner = own; ce.count = 1; });
        if (cap && (i0 + j) % step === 0) K.tile(o.q[0], o.q[1], { css: 'background:linear-gradient(135deg,#fff6c9,#ffd34d 50%,#fff0a8);', frames: [{ opacity: .95, t: 'scale(1.15)' }, { opacity: 0, t: 'scale(1)' }], dur: 380 });
        if (cap && (i0 + j) % (step * 2) === 0) { const q = P(o.q[0], o.q[1]); K.P.burst(q.x, q.y, 4, { k: 'gold', jx: cs * .3, v0: 10 * x.u, v1: 60 * x.u, vy: -110 * x.u, l0: 500, l1: 900, s0: cs * .08, s1: cs * .02, drag: .7 }); } });
        if (k % 2 === 0) SFX.fx('chime'); }); }
    at(150 + G * 95 + 60, () => { K.shake(4, 260); SFX.fx('thud'); }); },
  // Singularity: จานหมุนที่ช่องเป้าหมาย ลูกจากทั้งกระดานพุ่งเข้าไปเป็นระลอกจากใกล้ไปไกล แล้วช่องเป้าหมายพองขึ้น
  m1(x) { const { r, c, V, at, P, cs, g, t } = x, p = P(r, c), sz = Math.round(cs * 4.6); K.vignette('rgba(60,20,130,.65)', 1600, t ? 1 : .5); SFX.fx('dark');
    K.box(p.x, p.y, sz, sz, 'border-radius:50%;background:radial-gradient(circle,#000 0 22%,rgba(40,8,70,.95) 30%,transparent 56%),conic-gradient(from 0deg,transparent,#b47cff,transparent 30%,#ff7ad9 50%,transparent 62%,#6fb8ff 82%,transparent);-webkit-mask-image:radial-gradient(circle,#000 52%,transparent 70%);mask-image:radial-gradient(circle,#000 52%,transparent 70%);',
      t ? [{ opacity: 0, t: 'scale(.1) rotate(0deg)' }, { opacity: 1, t: 'scale(1) rotate(300deg)', offset: .2 }, { opacity: 1, t: 'scale(1.05) rotate(1100deg)', offset: .8 }, { opacity: 0, t: 'scale(.05) rotate(1400deg)' }] : [{ opacity: 0, t: 'scale(.9)' }, { opacity: .9, t: 'scale(.9)', offset: .3 }, { opacity: 0, t: 'scale(.9)' }], { duration: 1280, easing: 'linear' }, 2);
    const src = V.diff.filter(q => !(q.r === r && q.c === c)).map(q => { const a = P(q.r, q.c); return { q, a, dist: Math.hypot(a.x - p.x, a.y - p.y) }; }).sort((a, b) => a.dist - b.dist), n = src.length;
    const G = Math.min(Math.max(1, n), 8), cap = t === 2 ? 40 : t === 1 ? 16 : 0, step = Math.max(1, Math.ceil(n / Math.max(1, cap)));
    for (let k = 0; k < G && n; k++) { const i0 = Math.floor(k * n / G), part = src.slice(i0, Math.floor((k + 1) * n / G));
      at(180 + k * 85, () => part.forEach((o, j) => { V.reveal(o.q.r, o.q.c);
        if (cap && (i0 + j) % step === 0) K.comet(o.a, p, { color: K.mix(K.PC(o.q.fromOwner), '#ffffff', .25), size: Math.max(5, Math.round(cs * .2)), tail: cs * .9, dur: 280 }); })); }
    K.P.stream({ at: () => { const a = Math.random() * 6.2832, rr = cs * (3.5 + Math.random() * 2.5); return { x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr }; }, to: p, delay: 120, dur: 980, rate: 130, k: 'violet', v0: 320 * x.u, v1: 640 * x.u, l0: 300, l1: 520, s0: cs * .1, s1: cs * .02, drag: 0 });
    at(700, () => SFX.fx('whoosh'));
    at(1150, () => { V.reveal(r, c, 'first'); K.flash('#ffffff', 260, .4); K.shake(8, 320); SFX.fx('impact');
      K.P.burst(p.x, p.y, 110, { k: 'violet', v0: 160 * x.u, v1: 900 * x.u, l0: 400, l1: 900, s0: cs * .16, s1: cs * .03, drag: 2 }); K.P.burst(p.x, p.y, 40, { k: 'spark', v0: 200 * x.u, v1: 700 * x.u, l0: 300, l1: 600, s0: cs * .08, s1: cs * .02, drag: 1.6 }); if (t) K.rings(p.x, p.y, ['#ffffff', '#b47cff', '#ff7ad9'], cs * 1.5, Math.max(g.ww, g.wh) / (cs * 1.5), 700, 90); }); },
  // Rebirth: เสาแสงพุ่งขึ้นจากช่องเกิดใหม่ (FX.HL.rebirth) ลูกสามลูกปรากฏตอนเสาแสงมาถึง
  l5(x) { const { r, c, V, at, d } = x, tg = d.target || [r, c]; FX.HL.rebirth(tg[0], tg[1]);
    at(520, () => { V.reveal(tg[0], tg[1], 'first'); SFX.fx('chime'); });
    const q = K.pt(tg[0], tg[1]); K.P.stream({ at: q, delay: 480, dur: 520, rate: 90, k: 'ice', jx: x.cs * .45, a0: -1.75, a1: -1.39, v0: 120 * x.u, v1: 420 * x.u, l0: 400, l1: 800, s0: x.cs * .1, s1: x.cs * .02, drag: .6 }); },

  // ───────────── มือการ์ด / ผู้เล่น (ไม่ได้เกิดบนช่อง: เล่นกลางกระดาน + วงเล็กที่ป้ายคะแนนของผู้ใช้ให้รู้ว่าใครใช้) ─────────────
  // Cycle: ลูกศรโค้งสองชั้นหมุนสวนกันกลางกระดาน
  c10(x) { const { at, cs, t, from, col } = x, m = K.mid(), sz = Math.round(cs * 2.6), bw = Math.max(5, Math.round(cs * .16)); SFX.fx('whoosh');
    K.box(m.x, m.y, sz, sz, `border-radius:50%;border:${bw}px solid #fff;border-left-color:transparent;border-right-color:transparent;`, [{ opacity: 0, t: 'scale(.4) rotate(0deg)' }, { opacity: .95, t: 'scale(1) rotate(-220deg)', offset: .35 }, { opacity: .95, t: 'scale(1) rotate(-460deg)', offset: .78 }, { opacity: 0, t: 'scale(1.25) rotate(-540deg)' }], { duration: 450, easing: 'ease-in-out' }, 2);
    K.box(m.x, m.y, Math.round(sz * .56), Math.round(sz * .56), `border-radius:50%;border:${Math.round(bw * .7)}px solid ${col};border-top-color:transparent;border-bottom-color:transparent;`, [{ opacity: 0, t: 'scale(.4) rotate(0deg)' }, { opacity: .9, t: 'scale(1) rotate(260deg)', offset: .35 }, { opacity: .9, t: 'scale(1) rotate(520deg)', offset: .78 }, { opacity: 0, t: 'scale(1.2) rotate(600deg)' }], { duration: 450, easing: 'ease-in-out' }, 2);
    K.ring(from.x, from.y, 40, '#ffffff', 1.8, 360, 0, 1, 2);
    at(300, () => { SFX.fx('chime'); if (t) K.sparks(m.x, m.y, t === 2 ? 10 : 5, '#ffffff', cs * 1.8, { dur: 320 }); }); },
  // Scout: แถบแสงสแกนกวาดผ่านทั้งกระดานและแถวป้ายคะแนน
  c12(x) { const { at, g, from } = x, sb = document.getElementById('scoreboard'), b = sb && sb.getBoundingClientRect(); SFX.fx('whoosh');
    const bar = K.clip(0, 'left:0;top:0;width:14px;height:100%;margin-left:-7px;background:linear-gradient(90deg,transparent,#aef1ff 35%,#fff 50%,#aef1ff 65%,transparent);box-shadow:0 0 22px #7fe6ff;');
    const tint = K.clip(1, 'left:0;top:0;width:100%;height:100%;background:repeating-linear-gradient(90deg,rgba(174,241,255,.16) 0 1px,transparent 1px 12px),rgba(40,120,150,.14);');
    if (bar) { bar.animate([{ transform: 'translateX(0px)', opacity: 0 }, { transform: `translateX(${g.ww * .06}px)`, opacity: 1, offset: .1 }, { transform: `translateX(${g.ww * .94}px)`, opacity: 1, offset: .88 }, { transform: `translateX(${g.ww}px)`, opacity: 0 }], { duration: 460, easing: 'ease-in-out' }); K.hold(500); }
    if (tint) tint.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { duration: 500, easing: 'linear' });
    if (b && b.width) K.box(b.left, b.top + b.height / 2, 10, b.height + 10, 'border-radius:6px;background:linear-gradient(90deg,transparent,#aef1ff 40%,#fff 50%,#aef1ff 60%,transparent);box-shadow:0 0 16px #7fe6ff;', [{ opacity: 0, x: 0 }, { opacity: 1, x: b.width * .08, offset: .1 }, { opacity: 1, x: b.width * .92, offset: .9 }, { opacity: 0, x: b.width }], { duration: 460, easing: 'ease-in-out' }, 2);
    K.ring(from.x, from.y, 40, '#aef1ff', 1.8, 360, 0, 1, 2);
    at(400, () => SFX.fx('tick')); },
  // Key: รัศมีทองกลางกระดาน + ประกาย
  sr3(x) { const { at, cs, t, from } = x, m = K.mid(); SFX.fx('lock');
    if (t) K.rays(m.x, m.y, '#ffd34d', Math.round(cs * 5), 600, 0, .8);
    K.rings(m.x, m.y, ['#ffd34d', '#fff3c4'], Math.round(cs * 1.2), 2.4, 420, 110);
    K.P.burst(m.x, m.y, 36, { k: 'gold', v0: 60 * x.u, v1: 340 * x.u, l0: 350, l1: 650, s0: cs * .1, s1: cs * .02, drag: 2 });
    K.ring(from.x, from.y, 40, '#ffd34d', 1.8, 360, 0, 1, 2);
    at(150, () => { SFX.fx('chime'); K.glyph(m.x, m.y, '✦', { size: Math.round(cs * 1.5), color: '#fff8d6', glow: '#ffd34d', dur: 380, frames: [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(-90deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.2) rotate(0deg)', offset: .4 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(20deg)', offset: .7 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(.6) rotate(60deg)' }] }); }); },
  // Delay: หน้าปัดนาฬิกากลางกระดาน เข็มหมุนสองรอบ แล้วขึ้น ×2
  ep4(x) { const { at, cs, from } = x, m = K.mid(), sz = Math.round(cs * 2.4); SFX.fx('tick');
    K.box(m.x, m.y, sz, sz, `border-radius:50%;border:${Math.max(3, Math.round(cs * .09))}px solid #cfd8ff;background:rgba(14,12,36,.82);box-shadow:0 0 18px rgba(160,180,255,.6);`, [{ opacity: 0, t: 'scale(.5)' }, { opacity: 1, t: 'scale(1)', offset: .15 }, { opacity: 1, t: 'scale(1)', offset: .8 }, { opacity: 0, t: 'scale(1.15)' }], { duration: 570, easing: 'ease-out' }, 2);
    K.box(m.x, m.y, Math.max(4, Math.round(cs * .1)), Math.round(sz * .8), 'border-radius:3px;background:linear-gradient(180deg,#fff 0 50%,transparent 50%);', [{ opacity: 0, t: 'rotate(0deg)' }, { opacity: 1, t: 'rotate(40deg)', offset: .15 }, { opacity: 1, t: 'rotate(700deg)', offset: .8 }, { opacity: 0, t: 'rotate(720deg)' }], { duration: 570, easing: 'cubic-bezier(.4,0,.2,1)' }, 2);
    K.ring(from.x, from.y, 40, '#cfd8ff', 1.8, 360, 0, 1, 2);
    at(250, () => SFX.fx('tick'));
    at(390, () => { SFX.fx('chime'); K.glyph(m.x, m.y + sz * .78, '×2', { size: Math.round(cs * .7), color: '#cfd8ff', dur: 200 }); }); },

  _default(x) { const { r, c, V, P, cs, col } = x; if (r === undefined) return; const p = P(r, c); K.ring(p.x, p.y, cs, col, 2, 360, 0, 1, 3); V.reveal(r, c, 'placed'); },
};

window.spawnCardVfx = async function spawnCardVfx(cardId, targets, playerIdx, vfxData) {
  vfxData = vfxData || {}; targets = targets || {};
  const online = !!(window._getOnlineMode && window._getOnlineMode());
  // สามใบนี้มีเอฟเฟกต์ของตัวเองอยู่แล้ว (คงไว้ตามเดิม)
  if (cardId === 'r8') { await null; await FX.HL.rewind(vfxData.diff || [], CRLogic.cardVfxMs('r8', vfxData)); return; }
  if (cardId === 'r6') { FX.HL.reflect(vfxData.shielded || [], playerIdx); await wait(650); return; }
  if (cardId === 'r2') {
    const to = vfxData.to || [targets.r, targets.c]; FX.HL.blackhole(to[0], to[1]);
    (vfxData.pulled || []).forEach(([pr, pc], i) => { spawnArrow(pr, pc, to[0], to[1], '🧲', { delay: i * 0.07, size: '1.3rem' }); FX.flashCell(pr, pc, '#ffaa4488', i * 70);
      if (online) setTimeout(() => { const el = document.querySelector(`.cell[data-r="${pr}"][data-c="${pc}"]`); if (el) { el.style.transition = 'opacity .3s'; el.style.opacity = '0.15'; } }, i * 70 + 350); });
    spawnCellEmoji(to[0], to[1], '⭕', { size: '2rem', delay: 0.4 }); await wait(800); return;
  }
  // ออฟไลน์: โค้ดที่เรียกเราจะวาดกระดานที่เปลี่ยนแล้วทันทีหลังบรรทัดนี้ → ปล่อยให้มันวาดก่อน (microtask ถัดไป ยังไม่ทันขึ้นจอ) แล้วค่อยค้างภาพ "ก่อนใช้การ์ด"
  await null;
  const total = CRLogic.cardVfxMs(cardId, vfxData), g = K.geo();
  if (!g || !STATE.cells) { await wait(total); return; }
  const V = K.stage(cardId === 'e1b' ? [] : cardDiff(vfxData, online)); // e1b = Meteor ลูกที่สอง: กระดานตอนนั้นคือของจริงแล้ว ไม่มีอะไรต้องค้าง
  const at = (ms, fn) => setTimeout(() => { if (!V.live()) return; try { fn(); } catch (e) { console.error('[vfx]', cardId, e); } }, ms);
  const x = {
    r: targets.r, c: targets.c, r2: targets.r2, c2: targets.c2, pi: playerIdx, d: vfxData, online, V, at, g, cs: g.cs,
    t: K.tier(), col: K.PC(playerIdx), orb: Math.max(7, Math.round(g.cs * .28)), from: K.badge(playerIdx), u: g.cs / 52, // u = สเกลความเร็วของอนุภาคตามขนาดช่อง
    P: (r, c) => K.pt(r, c), tk: (r, c, name, ms) => K.tk(r, c, name, ms),
    // จังหวะที่ผลของการ์ดลงที่ช่อง (r,c): ออฟไลน์ การ์ดบางใบเปลี่ยน state ตรงนี้ (fn) · แล้วเผยค่าใหม่ของช่อง + ท่าของช่อง
    land: (r, c, token, fn) => { if (!online && fn) { const ce = STATE.cells[r] && STATE.cells[r][c]; if (ce) { fn(ce); updateCellDisplay(r, c); } } V.reveal(r, c, token); },
  };
  try { (CARD[cardId] || CARD._default)(x); } catch (e) { console.error('[vfx]', cardId, e); }
  await wait(total);
  V.done();
};
})();
