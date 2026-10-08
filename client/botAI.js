// ══ บอท ══
// ตัดสินใจด้วยการ "ลองเดินจริง" บนสำเนาของกระดาน โดยใช้กติกาชุดเดียวกับเกม (shared/gameLogic.js) — ไม่มีสำเนากฎในไฟล์นี้
//   chooseAction(state, playerIdx, opts)          → { type:'place', r, c } | { type:'card', cardId, targets } | { type:'skip' }
//   chooseActionAsync(state, playerIdx, opts)     → Promise ของค่าเดียวกัน แบ่งงานเป็นช่วงสั้นๆ ไม่ให้หน้าจอค้าง
//   chooseCardPick(state, playerIdx, cards, opts) → cardId | null (ไม่รับ)
//   opts = { level: 'easy'|'normal'|'hard'|'impossible', rng, timeBudgetMs, maxNodes }
// ไม่มี DOM · ไม่เรียก Math.random (ตัวสุ่มถูกฉีดเข้ามา กำหนด seed ได้) · ไม่แก้ state ที่รับเข้ามา
// บอทไม่โกง: ไม่อ่านมือของผู้เล่นอื่น, ไม่เห็นจำนวนลูกของศัตรูช่วง Eclipse, ไม่รู้ผลสุ่มล่วงหน้า (ลองสุ่มเองหลายครั้งแล้วเฉลี่ย)
(function (root, factory) {
  const logic = (typeof module !== 'undefined' && module.exports) ? require('../shared/gameLogic') : root.CRLogic;
  const api = factory(logic);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CRBot = api;
})(typeof window !== 'undefined' ? window : null, function (L) {

const WIN = 1e6;
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

// ตัวสุ่มกำหนด seed ได้ (mulberry32)
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ระดับความยาก: ความลึกของการมองล่วงหน้า (จำนวนตา), ความกว้างที่เก็บไว้ต่อชั้น, งบเวลา/จำนวนการจำลอง, ความสุ่ม
//   depth 0 = ให้คะแนนช่องแบบง่ายๆ ไม่จำลอง · 1 = จำลองการเดินของเรา (รวมลูกโซ่) · 2 = + คำตอบของศัตรูที่อันตรายที่สุด · 3–4 = ต่ออีก 1–2 ตา
//   การ์ด: cardDepth = มองต่อหลังใช้การ์ดอีกกี่ตา (0 = ดูแค่ผลทันที) · targets = จำนวนเป้าหมายที่ลองต่อใบ · samples = จำนวนครั้งที่ลองสุ่มแล้วเฉลี่ย
//          pickSim = ตอนเลือกการ์ด ลองจำลองว่าใบนั้นใช้กับกระดานตอนนี้ได้ดีแค่ไหน (ไม่ได้ดูแค่ความหายาก)
const LEVELS = {
  easy:       { depth: 0, blunder: 0.30, noise: 5,   budgetMs: 15,  nodes: 120,   beam: [],            cardDepth: 0, targets: 1, samples: 1, cardMargin: 6,   cardChance: 0.35, pickSim: false, thinkMs: 450 },
  normal:     { depth: 1, blunder: 0,    noise: 1.2, budgetMs: 40,  nodes: 500,   beam: [],            cardDepth: 0, targets: 2, samples: 1, cardMargin: 2.5, cardChance: 1,    pickSim: false, thinkMs: 600 },
  hard:       { depth: 2, blunder: 0,    noise: 0.2, budgetMs: 90,  nodes: 2500,  beam: [12, 7],       cardDepth: 1, targets: 3, samples: 2, cardMargin: 1.5, cardChance: 1,    pickSim: false, thinkMs: 750 },
  impossible: { depth: 4, blunder: 0,    noise: 0,   budgetMs: 150, nodes: 12000, beam: [12, 6, 6, 4], cardDepth: 2, targets: 6, samples: 4, cardMargin: 0.8, cardChance: 1,    pickSim: true,  thinkMs: 900 },
};
const levelOf = name => LEVELS[name] || LEVELS.normal;
const HOLD = { common: 1, uncommon: 1.2, rare: 1.6, super_rare: 2, epic: 2.4, legendary: 3.4, mythical: 4.2 }; // ยิ่งหายาก ยิ่งเก็บไว้ใช้ตอนคุ้ม

// ── สิ่งที่บอท "เห็น" ──
// สำเนาของกระดานที่ตัดข้อมูลที่ผู้เล่นคนนี้ไม่ควรรู้ออก: มือของคนอื่น, Key ของคนอื่น, จำนวนลูกของศัตรูช่วง Eclipse
function perceive(state, me, rng) {
  if (!state.rows) state = Object.assign({}, state, { rows: state.size }); // state ของโหมดออฟไลน์รุ่นเก่า
  const s = L.cloneSim(state);
  s._rng = rng;
  for (let p = 0; p < s.players; p++) if (p !== me) { s.hands[p] = []; s.keyActive[p] = 0; }
  if (s.eclipse > 0) {
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) { const ce = s.cells[r][c]; if (ce.count > 0 && ce.owner !== me) ce.count = 2; }
  }
  s.current = me;
  return s;
}

// ── จำลองหนึ่งตา (กติกาจริงทั้งหมด): การเดิน → ระเบิดจนนิ่ง → Time Bomb → ตกรอบ → ชนะ/เปลี่ยนตา ──
// คืนสถานะใหม่ หรือ null ถ้าการเดินนั้นผิดกติกา
function play(state, p, action) {
  const s = L.cloneSim(state);
  s.current = p; s.moved[p] = false;
  let res;
  if (action.type === 'place') res = L.applyPlace(s, p, action.r, action.c);
  else {
    const def = s.hands[p].find(d => d.id === action.cardId);
    if (!def) return null;
    res = L.applyCard(s, p, def, action.targets || {});
  }
  if (!res || !res.ok) return null;
  L.processExplosionsSync(s);
  if (L.tickTimeBombs(s)) L.processExplosionsSync(s);
  L.checkEliminations(s);
  if (!L.checkWin(s)) L.nextTurn(s);
  return s;
}

// เกมยืดเยื้อแค่ไหน (0 → 1): เริ่มนับหลังเล่นไปคนละ ~40 ตา เต็มที่ที่คนละ ~120 ตา
function lateness(s) { const per = (s.turnCount || 0) / s.players; return per <= 40 ? 0 : Math.min(1, (per - 40) / 80); }

// ── ประเมินกระดานจากมุมของ me ──
// ผลต่างกับ "ผู้นำ" ในหมู่ศัตรู (เล่นหลายคน: ไม่ไล่รังแกคนอ่อนจนผู้นำหนี) + ภัยที่จะโดนยึดในตาถัดไป − โอกาสที่เราจะยึดได้
function evaluate(s, me) {
  if (s.phase === 'finished') return s.winner === me ? WIN : -WIN;
  if (!s.alive.includes(me)) return -WIN + 1000;
  const P = s.players, rows = s.rows, cols = s.cols, cells = s.cells;
  const orbs = new Array(P).fill(0), cnt = new Array(P).fill(0);
  let threat = 0, chance = 0;
  for (let r = 0; r < rows; r++) {
    const row = cells[r];
    for (let c = 0; c < cols; c++) {
      const ce = row[c];
      if (ce.count <= 0) continue;
      const o = ce.owner;
      orbs[o] += ce.count; cnt[o]++;
      if (ce.count < (ce.cap || 4) - 1 || s.shielded[r][c] > 0) continue;
      // ช่องนี้อีกลูกเดียวระเบิด: เพื่อนบ้านของอีกฝ่ายกำลังจะถูกยึด
      for (let k = 0; k < 4; k++) {
        const nr = r + (k === 0 ? -1 : k === 1 ? 1 : 0), nc = c + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nb = cells[nr][nc];
        if (nb.count <= 0 || nb.owner === o) continue;
        if (s.shielded[nr][nc] > 0 && s.shieldOwner[nr][nc] !== o) continue; // โล่กันไว้
        if (o === me) chance += nb.count + 1;
        else if (nb.owner === me) threat += nb.count + 1;
      }
    }
  }
  const score = p => cnt[p] * 3 + orbs[p];
  let lead = -Infinity, rest = 0, foes = 0;
  for (let p = 0; p < P; p++) { if (p === me || !s.alive.includes(p)) continue; const v = score(p); if (v > lead) lead = v; rest += v; foes++; }
  if (!foes) lead = 0;
  const mine = score(me);
  const myMove = s.current === me; // ตาถัดไปเป็นของใคร: ภัย/โอกาสที่ "ใกล้ถึงมือ" หนักกว่า
  // เกมยิ่งยืดเยื้อ ยิ่งกล้าบุก (late: 0 → 1): ไม่งั้นบอทที่ป้องกันเก่งทั้งคู่จะยันกันไปเรื่อยๆ
  const late = lateness(s);
  let v = (mine - lead) - (foes > 1 ? 0.12 * (rest - lead) : 0);
  v += chance * (myMove ? 0.55 : 0.2) * (1 + late) - threat * (myMove ? 0.3 : 0.7) * (1 - 0.7 * late);
  v += (P - 1 - foes) * 14; // ศัตรูที่ตกรอบไปแล้ว: ปิดเกมกับคนที่อ่อนแรงดีกว่าปล่อยให้ฟื้น
  if (cnt[me] <= 1) v -= 12; else if (cnt[me] === 2) v -= 5; // ใกล้ตกรอบ
  if (s.frozen[me] > 0) v -= 5;
  return v;
}

// ── ตัวเลือกการวาง ──
function hasCells(s, p) { for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (s.cells[r][c].owner === p && s.cells[r][c].count > 0) return true; return false; }
const isVoid = (s, r, c) => ((s.voidCells && s.voidCells[r + ',' + c]) || 0) > 0;
// คะแนนคร่าวๆ ของการเติมช่องนี้ (ไว้เรียงลำดับ/ตัดตัวเลือก — ไม่ใช่การตัดสินขั้นสุดท้าย)
function quick(s, p, r, c) {
  const ce = s.cells[r][c];
  let v = ce.count * 2, foe = 0, foeCrit = 0;
  for (let k = 0; k < 4; k++) {
    const nr = r + (k === 0 ? -1 : k === 1 ? 1 : 0), nc = c + (k === 2 ? -1 : k === 3 ? 1 : 0);
    if (nr < 0 || nc < 0 || nr >= s.rows || nc >= s.cols) { v -= 0.4; continue; }
    const nb = s.cells[nr][nc];
    if (nb.count > 0 && nb.owner !== p) { foe += nb.count; if (nb.count >= 3) foeCrit++; }
  }
  if (ce.count === 3) v += 4 + foe * 2;        // ระเบิดแล้วยึดเพื่อนบ้าน
  else v += foe * 0.3 - (ce.count === 2 ? foeCrit * 1.5 : 0);
  return v;
}
// ช่องเปิดเกม / คืนชีพ: ไม่ติดศัตรู (โดนยึดง่าย) แต่ไม่ไกลจนไม่มีอะไรทำ และมีเพื่อนบ้านครบเพื่อขยาย
function openingScore(s, p, r, c, rng) {
  let nb = 0;
  if (r > 0) nb++; if (r < s.rows - 1) nb++; if (c > 0) nb++; if (c < s.cols - 1) nb++;
  let d = 99, big = 0;
  for (let rr = 0; rr < s.rows; rr++) for (let cc = 0; cc < s.cols; cc++) {
    const ce = s.cells[rr][cc];
    if (ce.count <= 0 || ce.owner === p) continue;
    const x = Math.abs(rr - r) + Math.abs(cc - c);
    if (x < d) { d = x; big = ce.count; }
  }
  let v = nb * 2 + (d === 99 ? 4 : Math.min(d, 4) * 1.6);
  if (d <= 1) v -= 6 + big; else if (d === 2) v -= 1.5;
  v -= (Math.abs(r - (s.rows - 1) / 2) + Math.abs(c - (s.cols - 1) / 2)) * 0.15;
  return v + rng() * 0.8;
}
function openingMoves(s, p, rng, limit) {
  const out = [];
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (s.cells[r][c].count > 0 || isVoid(s, r, c)) continue;
    out.push({ type: 'place', r, c, q: openingScore(s, p, r, c, rng) });
  }
  out.sort((a, b) => b.q - a.q);
  return limit ? out.slice(0, limit) : out;
}
function placeMoves(s, p, rng, limit) {
  if (s.frozen[p] > 0 || !s.alive.includes(p)) return [];
  if (!hasCells(s, p)) return openingMoves(s, p, rng, limit || 6);
  const out = [];
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    const ce = s.cells[r][c];
    if (ce.owner !== p || ce.count <= 0 || isVoid(s, r, c)) continue;
    out.push({ type: 'place', r, c, q: quick(s, p, r, c) });
  }
  out.sort((a, b) => b.q - a.q);
  return limit && out.length > limit ? out.slice(0, limit) : out;
}

// ── ตัวเลือกเป้าหมายของการ์ด: สร้างตามกฎของแต่ละใบ (ไม่ลองทุกช่อง) แล้วให้ validateTargets ของเกมคัดอีกชั้น ──
function ownCells(s, me) { const o = []; for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) { const ce = s.cells[r][c]; if (ce.owner === me && ce.count > 0 && !isVoid(s, r, c)) o.push([r, c, ce.count, quick(s, me, r, c)]); } return o; }
function foeCells(s, me) {
  const o = [];
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    const ce = s.cells[r][c];
    if (ce.count <= 0 || ce.owner === me || isVoid(s, r, c)) continue;
    let near = 0; // ติดกับช่องของเรากี่ลูก = อันตรายต่อเราแค่ไหน
    for (let k = 0; k < 4; k++) { const nr = r + (k === 0 ? -1 : k === 1 ? 1 : 0), nc = c + (k === 2 ? -1 : k === 3 ? 1 : 0); if (nr < 0 || nc < 0 || nr >= s.rows || nc >= s.cols) continue; const nb = s.cells[nr][nc]; if (nb.owner === me) near += nb.count; }
    o.push([r, c, ce.count, ce.count * 2 + near * (ce.count >= 3 ? 2 : 0.5)]);
  }
  return o;
}
function cardTargets(s, me, def, max) {
  const T = [];
  const N = max || 4;
  const add = t => { if (L.validateTargets(s, def, me, t).ok) T.push(t); };
  if (def.rebirthOnly) { openingMoves(s, me, s._rng, 3).forEach(m => add({ r: m.r, c: m.c })); return T; }
  if (def.id === 'e4') { // Pillar: เลือก column ที่มีช่องของเรา/ช่องว่างมากสุด
    const cols = [];
    for (let c = 0; c < s.cols; c++) { let n = 0; for (let r = 0; r < s.rows; r++) { const ce = s.cells[r][c]; if (ce.owner === me) n += 2 + ce.count; else if (ce.count <= 0) n += 1; } cols.push([c, n]); }
    cols.sort((a, b) => b[1] - a[1]).slice(0, Math.min(3, N)).forEach(([c]) => add({ r: 0, c }));
    return T;
  }
  if (!def.needTarget) { add({}); return T; }
  const own = ownCells(s, me).sort((a, b) => b[3] - a[3]);
  const foes = foeCells(s, me).sort((a, b) => b[3] - a[3]);
  if (def.twoTarget) {
    if (def.id === 'c5') { // Spin: ย้ายกองของเราไปช่องติดกัน — ลองทับช่องศัตรูที่ใหญ่สุด และรวมกับช่องเราเอง
      own.slice(0, Math.min(3, N)).forEach(([r, c]) => {
        const nb = L.neighbors(r, c, s.rows, s.cols).map(([a, b]) => [a, b, s.cells[a][b]]).sort((x, y) => (y[2].owner !== me ? y[2].count + 2 : y[2].count) - (x[2].owner !== me ? x[2].count + 2 : x[2].count));
        nb.slice(0, 2).forEach(([a, b]) => add({ r, c, r2: a, c2: b }));
      });
    } else if (def.id === 'u2') { // Swap: กองเล็กสุดของเรา ↔ กองใหญ่สุดของศัตรู
      const small = own.slice().sort((a, b) => a[2] - b[2]).slice(0, 2);
      foes.slice().sort((a, b) => b[2] - a[2]).slice(0, 2).forEach(f => small.forEach(o => add({ r: o[0], c: o[1], r2: f[0], c2: f[1] })));
    } else { // Double Shot / Sever: สองช่องของเรา
      if (own.length >= 2) add({ r: own[0][0], c: own[0][1], r2: own[1][0], c2: own[1][1] });
      if (own.length >= 3) add({ r: own[0][0], c: own[0][1], r2: own[2][0], c2: own[2][1] });
    }
    return T;
  }
  if (def.targetSelf) {
    own.slice(0, N).forEach(([r, c]) => add({ r, c }));
    // ใบที่ใช้กับช่องว่างได้: ลองช่องว่างข้างช่องที่ดีที่สุดของเรา (ขยายพื้นที่)
    if (own.length && N > 2) L.neighbors(own[0][0], own[0][1], s.rows, s.cols).forEach(([a, b]) => { if (s.cells[a][b].count <= 0 && T.length < N + 2) add({ r: a, c: b }); });
    else openingMoves(s, me, s._rng, 2).forEach(m => add({ r: m.r, c: m.c }));
    return T;
  }
  foes.slice(0, N).forEach(([r, c]) => add({ r, c }));
  return T;
}

// ── ศัตรูที่อันตรายที่สุด + คำตอบที่แย่ที่สุดสำหรับเรา (ใช้ทั้งในการค้นหาและนโยบายการ์ดป้องกัน) ──
function rivals(s, me, max) {
  const out = [];
  for (const p of s.alive) {
    if (p === me) continue;
    let near = 0, size = 0;
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      const ce = s.cells[r][c];
      if (ce.owner !== p || ce.count <= 0) continue;
      size += ce.count + 2;
      if (ce.count < 3) continue;
      for (let k = 0; k < 4; k++) { const nr = r + (k === 0 ? -1 : k === 1 ? 1 : 0), nc = c + (k === 2 ? -1 : k === 3 ? 1 : 0); if (nr < 0 || nc < 0 || nr >= s.rows || nc >= s.cols) continue; if (s.cells[nr][nc].owner === me) near += 4; }
    }
    out.push([p, near * 3 + size]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, max).map(x => x[0]);
}

class Stop extends Error {}
function makeCtx(lvl, opts, rng) {
  const budget = opts.timeBudgetMs === undefined ? lvl.budgetMs : opts.timeBudgetMs;
  return { lvl, rng, nodes: 0, maxNodes: opts.maxNodes || lvl.nodes, deadline: budget === Infinity ? Infinity : now() + budget, started: now(), sliceAt: now() };
}
function sim(ctx, s, p, a) {
  if (ctx.nodes >= ctx.maxNodes || ((ctx.nodes & 15) === 15 && now() > ctx.deadline)) throw new Stop();
  ctx.nodes++;
  return play(s, p, a);
}

// ค่าของสถานะ s (หลังการเดินของใครสักคน) เมื่อมองต่ออีก d ตา · oppTurn = ตาถัดไปเป็นของฝ่ายตรงข้าม
// ฝ่ายตรงข้าม: เลือกคำตอบที่แย่ที่สุดสำหรับเรา จากศัตรูที่อันตรายที่สุดไม่เกิน 2 คน (วางบอลเท่านั้น — เราไม่เห็นมือเขา)
function lookahead(ctx, s, me, d, oppTurn, alpha, beta, ply) {
  if (s.phase === 'finished') return s.winner === me ? WIN - ply : -WIN + ply;
  if (d <= 0 || !s.alive.includes(me)) return evaluate(s, me);
  const width = ctx.lvl.beam[ply] || 4;
  if (oppTurn) {
    let v = Infinity, any = false;
    for (const opp of rivals(s, me, 2)) {
      for (const m of placeMoves(s, opp, ctx.rng, width)) {
        const t = sim(ctx, s, opp, m);
        if (!t) continue;
        any = true;
        const x = lookahead(ctx, t, me, d - 1, false, alpha, beta, ply + 1);
        if (x < v) v = x;
        if (v < beta) beta = v;
        if (beta <= alpha) return v;
      }
    }
    return any ? v : evaluate(s, me);
  }
  let v = -Infinity, any = false;
  for (const m of placeMoves(s, me, ctx.rng, width)) {
    const t = sim(ctx, s, me, m);
    if (!t) continue;
    any = true;
    const x = lookahead(ctx, t, me, d - 1, true, alpha, beta, ply + 1);
    if (x > v) v = x;
    if (v > alpha) alpha = v;
    if (beta <= alpha) return v;
  }
  return any ? v : evaluate(s, me);
}

// ── นโยบายการ์ด ──
// ค่าของการ์ด = ผลของการจำลอง (เฉลี่ยหลายครั้งถ้าการ์ดมีการสุ่ม) มองถึงคำตอบของศัตรู 1 ตา + โบนัสของใบที่ผลไม่ปรากฏบนกระดานทันที
const RANDOM_CARDS = new Set(['c4', 'c9', 'c10', 'c11', 'c13', 'u4', 'u7', 'u10', 'r3', 'r4', 'r5', 'l1', 'l4']);
const SOFT = { // ใบที่คุณค่าไม่ได้อยู่บนกระดานหลังใช้ทันที: (สถานะก่อนใช้, ผู้เล่น, ข้อมูลภัย) → โบนัส
  sr3: (s, me) => (s.cardInterval > 0 && ((s.playerTurns[me] + 1) % s.cardInterval === 0 || (s.turnCount + 1) % (s.players * s.cardInterval) === 0) ? 3 : 0.5), // Key: ใกล้รอบเลือกการ์ด
  c12: () => -1,                                   // Scout: ไว้ใช้ตอนไม่มีอะไรดีกว่า
  sr2: () => -0.5,                                 // Eclipse
  ep4: () => -0.5,                                 // Delay
  r3: (s, me, th) => 1.5 + Math.min(6, th * 0.5),  // Freeze: ยิ่งถูกกดดันยิ่งคุ้ม
  u5: () => 2.5,                                   // Time Bomb: ผลมาอีก 2 ตา
  sr1: () => -1,                                   // Sever
};
function cardValue(ctx, s, me, def, targets, base) {
  const n = RANDOM_CARDS.has(def.id) ? ctx.lvl.samples : 1;
  let sum = 0, ok = 0;
  for (let i = 0; i < n; i++) {
    const t = sim(ctx, s, me, { type: 'card', cardId: def.id, targets });
    if (!t) break;
    ok++;
    // ระดับสูง: ดูด้วยว่าศัตรูตอบแล้วเหลืออะไร (การ์ดป้องกันได้ค่าจากตรงนี้) · ระดับต่ำ: ดูแค่ผลทันที
    sum += t.phase === 'finished' ? (t.winner === me ? WIN : -WIN) : ctx.lvl.cardDepth > 0 ? lookahead(ctx, t, me, ctx.lvl.cardDepth, true, -Infinity, Infinity, 1) : evaluate(t, me);
  }
  if (!ok) return -Infinity;
  let v = sum / ok;
  if (SOFT[def.id]) v += SOFT[def.id](s, me, base.threat);
  if (def.cat === 'defense') v -= lateness(s) * 8; // เกมยืดเยื้อ: เลิกตั้งรับ ไม่งั้นสองฝ่ายยันกันไม่จบ
  return v;
}

// ── ตัวตัดสินใจ: ทำงานเป็นช่วง (generator) — เรียกรวดเดียวหรือแบ่งเฟรมก็ได้ ──
function* decide(state, me, opts) {
  const lvl = levelOf(opts.level), rng = opts.rng || makeRng(Date.now() & 0x7fffffff);
  const s = perceive(state, me, rng);
  const ctx = makeCtx(lvl, opts, rng);
  const hand = s.hands[me] || [];

  // ตายแล้ว: คืนชีพทันทีถ้าทำได้ ไม่งั้นข้าม
  if (!s.alive.includes(me)) {
    const def = hand.find(d => d.rebirthOnly);
    if (def && L.rebirthUsable(s, me)) { const t = cardTargets(s, me, def)[0]; if (t) return { type: 'card', cardId: def.id, targets: t }; }
    return { type: 'skip' };
  }
  if (s.frozen[me] > 0 || s.moved[me]) return { type: 'skip' };

  const places = placeMoves(s, me, rng, hasCells(s, me) ? 0 : 8);
  // easy: บางตาเดินมั่วเลย
  if (lvl.blunder && places.length && rng() < lvl.blunder) { const m = places[Math.floor(rng() * places.length)]; return { type: 'place', r: m.r, c: m.c }; }

  // ── การวาง: มองลึกขึ้นทีละชั้น (iterative deepening) หมดงบเมื่อไรใช้ผลของชั้นที่เสร็จล่าสุด ──
  let scored = places.map(m => ({ m, v: m.q }));
  let done = 0;
  try {
    for (let d = 1; d <= Math.max(1, lvl.depth) && lvl.depth > 0; d++) {
      const cand = d === 1 ? scored : scored.slice(0, lvl.beam[0] || 10);
      const next = [];
      let alpha = -Infinity;
      for (const x of cand) {
        const t = sim(ctx, s, me, x.m);
        if (!t) continue;
        const v = d === 1 ? (t.phase === 'finished' ? (t.winner === me ? WIN : -WIN) : evaluate(t, me)) : lookahead(ctx, t, me, d - 1, true, alpha - 30, Infinity, 1);
        next.push({ m: x.m, v });
        if (v > alpha) alpha = v;
        if (now() - ctx.sliceAt > 20) { yield; ctx.sliceAt = now(); }
      }
      if (!next.length) break;
      next.sort((a, b) => b.v - a.v);
      // ตัวเลือกที่ไม่ได้มองลึกในชั้นนี้ ยังอยู่ท้ายแถวด้วยค่าเดิม (ลดลงเล็กน้อย เพราะไม่ได้ตรวจคำตอบของศัตรู)
      scored = d === 1 ? next : next.concat(scored.slice(cand.length).map(x => ({ m: x.m, v: Math.min(x.v, next[next.length - 1].v) - 1 })));
      done = d;
      if (next[0].v >= WIN - 10) break; // ชนะแน่แล้ว
    }
  } catch (e) { if (!(e instanceof Stop)) throw e; }
  if (lvl.noise) scored.forEach(x => { x.v += (rng() - 0.5) * lvl.noise; });
  scored.sort((a, b) => b.v - a.v);
  const bestPlace = scored[0] || null;

  // ── การ์ด: เทียบกับการวางที่ดีที่สุด ใช้เมื่อดีกว่าชัดเจน (ยิ่งหายากยิ่งต้องคุ้ม) ──
  let bestCard = null;
  if (hand.length && rng() < lvl.cardChance) {
    // ค่าฐานของการวาง ต้องวัดด้วยไม้บรรทัดเดียวกับการ์ด (มองคำตอบของศัตรู 1 ตา)
    let basePlace = bestPlace ? bestPlace.v : -Infinity;
    const base = { threat: 0 };
    try {
      const stay = evaluate(s, me), cd = lvl.cardDepth;
      if (cd > 0) {
        const worst = lookahead(ctx, Object.assign(L.cloneSim(s), { current: (me + 1) % s.players }), me, 1, true, -Infinity, Infinity, 1);
        base.threat = Math.max(0, stay - worst); // ถ้าเราไม่ทำอะไร ศัตรูทำให้เราเสียได้เท่าไร
      }
      // การวางที่ดีที่สุด วัดด้วยไม้บรรทัดเดียวกับการ์ด (มองต่ออีก cd ตาเท่ากัน — จำนวนตาคู่/คี่ให้ค่าคนละระดับ เทียบข้ามกันไม่ได้)
      if (bestPlace) { const t = sim(ctx, s, me, bestPlace.m); if (t) basePlace = t.phase === 'finished' ? (t.winner === me ? WIN : -WIN) : cd > 0 ? lookahead(ctx, t, me, cd, true, -Infinity, Infinity, 1) : evaluate(t, me); }
      const seen = new Set();
      for (const def of hand) {
        if (seen.has(def.id)) continue;
        seen.add(def.id);
        if (def.rebirthOnly) continue;
        if (def.rarity === 'legendary' && (s.legendaryUsedBy[me] || 0) >= 2) continue;
        if (def.rarity === 'mythical' && s.mythicalUsedBy[me]) continue;
        for (const t of cardTargets(s, me, def, lvl.targets)) {
          const v = cardValue(ctx, s, me, def, t, base);
          if (v > -Infinity && (!bestCard || v > bestCard.v)) bestCard = { def, targets: t, v };
          if (now() - ctx.sliceAt > 20) { yield; ctx.sliceAt = now(); }
        }
      }
    } catch (e) { if (!(e instanceof Stop)) throw e; }
    if (bestCard) {
      const full = hand.length >= L.HAND_LIMIT;
      const margin = bestCard.v >= WIN - 10 ? -Infinity : lvl.cardMargin * (HOLD[bestCard.def.rarity] || 1) * (full ? 0.35 : 1);
      if (!(bestCard.v > basePlace + margin)) bestCard = null;
    }
  }
  if (bestCard) return { type: 'card', cardId: bestCard.def.id, targets: bestCard.targets };
  if (bestPlace) return { type: 'place', r: bestPlace.m.r, c: bestPlace.m.c };
  // วางไม่ได้เลย (ไม่มีช่อง): ใช้การ์ดอะไรก็ได้ที่ใช้ได้ ไม่งั้นข้าม
  for (const def of hand) { if (def.rebirthOnly) continue; const t = cardTargets(s, me, def)[0]; if (t && play(s, me, { type: 'card', cardId: def.id, targets: t })) return { type: 'card', cardId: def.id, targets: t }; }
  return { type: 'skip' };
}

function chooseAction(state, playerIdx, opts) {
  const it = decide(state, playerIdx, opts || {});
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
// แบ่งงานเป็นช่วง ~20ms แล้วคืนการควบคุมให้เบราว์เซอร์ระหว่างช่วง (opts.defer: ฟังก์ชันนัดงานถัดไป — ค่าเริ่มต้น setTimeout 0)
function chooseActionAsync(state, playerIdx, opts) {
  opts = opts || {};
  const defer = opts.defer || (fn => setTimeout(fn, 0));
  return new Promise((resolve, reject) => {
    let it;
    try { it = decide(state, playerIdx, opts); } catch (e) { reject(e); return; }
    const step = () => { try { const r = it.next(); if (r.done) resolve(r.value); else defer(step); } catch (e) { reject(e); } };
    step();
  });
}

// ── เลือกการ์ดจากตัวเลือก 3 ใบ ──
const RARITY_VALUE = { common: 1, uncommon: 2, rare: 3.2, super_rare: 4, epic: 5, legendary: 6.5, mythical: 7.5 };
function chooseCardPick(state, playerIdx, cards, opts) {
  opts = opts || {};
  const lvl = levelOf(opts.level), rng = opts.rng || makeRng(Date.now() & 0x7fffffff), me = playerIdx;
  if (!cards || !cards.length) return null;
  const hand = (state.hands && state.hands[me]) || [];
  if (hand.length >= L.HAND_LIMIT) return null;
  if (lvl.depth === 0 && rng() < 0.6) return cards[Math.floor(rng() * cards.length)].id; // easy: เกือบสุ่ม
  const s = perceive(state, me, rng);
  let myCells = 0, crit = 0, threat = 0;
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) { const ce = s.cells[r][c]; if (ce.owner === me && ce.count > 0) { myCells++; if (ce.count >= 3) crit++; } }
  try { const stay = evaluate(s, me), worst = lookahead(makeCtx(LEVELS.normal, { timeBudgetMs: Infinity, maxNodes: 200 }, rng), Object.assign(L.cloneSim(s), { current: (me + 1) % s.players }), me, 1, true, -Infinity, Infinity, 1); threat = Math.max(0, stay - worst); } catch (e) { if (!(e instanceof Stop)) throw e; }
  // ระดับสูง: ลองจำลองว่าถ้ามีใบนี้ในมือตอนนี้ ใช้แล้วดีกว่าการวางบอลที่ดีที่สุดแค่ไหน (ไม่ได้ดูแค่ความหายาก)
  const gain = {};
  if (lvl.pickSim) {
    const ctx = makeCtx(lvl, { timeBudgetMs: opts.timeBudgetMs === undefined ? 60 : opts.timeBudgetMs, maxNodes: Math.min(opts.maxNodes || lvl.nodes, 1500) }, rng);
    try {
      const cd = lvl.cardDepth, ruler = t => (t.phase === 'finished' ? (t.winner === me ? WIN : -WIN) : cd > 0 ? lookahead(ctx, t, me, cd, true, -Infinity, Infinity, 1) : evaluate(t, me));
      let basePlace = -Infinity;
      for (const m of placeMoves(s, me, rng, 3)) { const t = sim(ctx, s, me, m); if (t) basePlace = Math.max(basePlace, ruler(t)); }
      if (basePlace === -Infinity) basePlace = evaluate(s, me);
      for (const c of cards) {
        const s2 = L.cloneSim(s); s2.hands[me] = hand.concat([c]);
        let bestUse = -Infinity;
        for (const t of cardTargets(s2, me, c, 3)) bestUse = Math.max(bestUse, cardValue(ctx, s2, me, c, t, { threat }));
        if (bestUse > -Infinity) gain[c.id] = Math.max(-1.5, Math.min(5, (Math.min(bestUse, basePlace + 40) - basePlace) * 0.4));
      }
    } catch (e) { if (!(e instanceof Stop)) throw e; }
  }
  let best = null, bv = -Infinity;
  for (const c of cards) {
    let v = (RARITY_VALUE[c.rarity] || 1) + (gain[c.id] || 0);
    if (hand.some(d => d.id === c.id)) v -= 2;                                             // ซ้ำกับในมือ
    if (c.rarity === 'legendary' && (s.legendaryUsedBy[me] || 0) >= 2) v -= 100;           // ใช้ไม่ได้แล้ว
    if (c.rarity === 'mythical' && s.mythicalUsedBy[me]) v -= 100;
    if (c.cat === 'defense') v += Math.min(2.5, threat * 0.3);
    if (c.cat === 'burst') v += Math.min(1.5, crit * 0.5);
    if (c.cat === 'attack') v += 0.5;
    if (c.rebirthOnly) v = myCells <= 3 ? 5 : 2.2;
    if (SOFT[c.id]) v += Math.min(0, SOFT[c.id](s, me, threat));
    v += rng() * 0.3;
    if (v > bv) { bv = v; best = c; }
  }
  // ทุกใบแย่ และมือใกล้เต็ม: ไม่รับ (เก็บช่องไว้ให้ใบที่ดีกว่า)
  if (bv < 0.8 + hand.length * 0.35) return null;
  return best.id;
}

// บอทสุ่ม (ไม้บรรทัดของชุดทดสอบ): วางช่องที่ถูกกติกาแบบสุ่ม
function randomAction(state, playerIdx, rng) {
  const s = perceive(state, playerIdx, rng);
  if (!s.alive.includes(playerIdx)) { const def = (s.hands[playerIdx] || []).find(d => d.rebirthOnly); if (def && L.rebirthUsable(s, playerIdx)) { const t = cardTargets(s, playerIdx, def)[0]; if (t) return { type: 'card', cardId: def.id, targets: t }; } return { type: 'skip' }; }
  const m = hasCells(s, playerIdx) ? placeMoves(s, playerIdx, rng, 0) : openingMoves(s, playerIdx, rng, 0);
  if (!m.length || s.frozen[playerIdx] > 0) return { type: 'skip' };
  const x = m[Math.floor(rng() * m.length)];
  return { type: 'place', r: x.r, c: x.c };
}

return { chooseAction, chooseActionAsync, chooseCardPick, randomAction, makeRng, evaluate, perceive, play, LEVELS };
});
