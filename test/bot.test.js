'use strict';
// ชุดทดสอบบอท (ส่วน B)
//   npm test          → ชุดเร็ว (เกมน้อย เกณฑ์หลวม) รวมอยู่ในชุดหลัก
//   npm run test:bot  → ชุดเต็ม: 200 เกมตรวจกติกา + ladder 100 เกมต่อคู่ ตามเกณฑ์ของบรีฟ (หลายนาที) แล้วพิมพ์ตาราง
// ทุกข้อใช้ตัวสุ่มกำหนด seed และงบเป็น "จำนวนการจำลอง" (ไม่ใช่เวลา) → ผลซ้ำได้ทุกเครื่อง · ยกเว้นข้อ 4 ที่ตั้งใจวัดเวลาจริง

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shared/gameLogic');
const Bot = require('../client/botAI');
const { playGame, duel } = require('./support/botMatch');

const FULL = process.env.BOT_FULL === '1' || process.env.npm_lifecycle_event === 'test:bot';
const LEVELS = ['easy', 'normal', 'hard', 'impossible'];
const RANDOM = { random: true };
const lv = level => ({ level });
const pct = x => (x * 100).toFixed(0) + '%';
const report = [];
test.after(() => { if (report.length) console.log('\n' + report.join('\n') + '\n'); });

// ── helpers ──
const def = id => ({ ...L.CARD_DEFS.find(d => d.id === id) });
const snap = s => { const { _rng, _fx, ...rest } = s; return JSON.parse(JSON.stringify(rest)); };
// กระดานกลางเกม: ตาของ me · คนอื่น "เดินไปแล้ว"
function mk({ players = 2, rows = 6, cols = 6, cardInterval = 2, me = 0 } = {}) {
  const st = L.createInitialState({ players, mapSize: rows, mapCols: cols, cardInterval });
  st.current = me; st.moved = st.moved.map((_, i) => i !== me);
  st.turnCount = players * 6; st.playerTurns = st.playerTurns.map(() => 6);
  return st;
}
const set = (st, r, c, n, o) => { st.cells[r][c].count = n; st.cells[r][c].owner = n > 0 ? o : -1; };
// การเดินนี้ กติกาจริงรับหรือไม่ (ลองบนสำเนา)
function legal(st, p, act) {
  const s = snap(st);
  if (act.type === 'place') return L.applyPlace(s, p, act.r, act.c).ok;
  if (act.type === 'card') { const d = s.hands[p].find(x => x.id === act.cardId); return !!d && L.applyCard(s, p, d, act.targets || {}).ok; }
  return act.type === 'skip';
}
// เก็บตำแหน่งกลางเกมจากเกมจริง (ก่อนผู้เล่น p เดิน)
function positions({ seed, players = 3, rows = 7, cols = 7, cardInterval = 1, every = 5, max = 12, from = 4, level = 'normal', maxNodes = 300, maxTurns = 400 }) {
  const out = [];
  playGame({ rows, cols, cardInterval, seed, maxTurns, seats: Array.from({ length: players }, () => ({ level, maxNodes })),
    onDecision(s, p) { if (out.length < max && s.turnCount >= players * from && s.turnCount % every === 0 && s.alive.includes(p) && !(s.frozen[p] > 0)) out.push({ st: snap(s), me: p }); } });
  return out;
}
const act = (st, me, level, seed, extra) => Bot.chooseAction(st, me, Object.assign({ level, rng: Bot.makeRng(seed), timeBudgetMs: Infinity }, extra));

// ══ 1. ไม่ผิดกติกา ══
// บอทสู้บอทหลายขนาดกระดาน / จำนวนผู้เล่น / ระดับ / ความถี่การ์ด: ไม่มีการเดินที่กติกาปฏิเสธ และทุกเกมจบ
// เพดานจำนวนเทิร์น: บรีฟขอ 500 — ใช้กับเกม 2 คนบนกระดานไม่เกิน 8×8
// เกมหลายคน/กระดานใหญ่ 500 เทิร์นรวมน้อยเกินไป (6 คน = คนละ 83 ตา) → เพดาน = 6 เท่าของจุดที่บอทเริ่มนับว่า "ยืดเยื้อ" ต่อคน
// (จุดเริ่ม = คนละ 40 ตา หรือ 35% ของจำนวนช่อง · เลย 3 เท่าไปแล้วฝ่ายที่ตามหลังจะหมดแรง — ดู fatigue ใน client/botAI.js)
const BOARDS = [[5, 5, 2], [6, 6, 2], [8, 8, 2], [6, 6, 3], [7, 7, 3], [8, 8, 4], [7, 13, 2], [7, 13, 4], [9, 9, 5], [10, 10, 6], [12, 18, 3], [8, 14, 6]];
function matrixGame(g) {
  const [rows, cols, players] = BOARDS[g % BOARDS.length];
  const big = rows * cols > 64;
  const seats = Array.from({ length: players }, (_, i) => { const level = LEVELS[(g + i * 3 + Math.floor(g / BOARDS.length)) % 4]; return { level, maxNodes: big && level === 'impossible' ? 1500 : undefined }; });
  const small2p = players === 2 && rows * cols <= 64;
  const cap = small2p ? 500 : Math.round(players * Math.max(40, rows * cols * 0.35) * 6);
  return { rows, cols, players, seats, cardInterval: [2, 1, 2, 0, 3][g % 5], seed: 5000 + g, maxTurns: cap, small2p };
}
test('1. บอทสู้บอท: ไม่มีการเดินผิดกติกา ไม่มีเกมค้าง', { timeout: 1800000 }, () => {
  const N = FULL ? 200 : 24;
  let turns = 0, cards = 0, longest = { turns: 0 }, small = { n: 0, max: 0 };
  const over500 = [];
  for (let g = 0; g < N; g++) {
    const m = matrixGame(g);
    const r = playGame(m);
    const tag = `เกม ${g}: ${m.players} คน ${m.rows}×${m.cols} [${m.seats.map(s => s.level).join(', ')}] ${m.cardInterval ? `การ์ดทุก ${m.cardInterval} ตา` : 'ไม่มีการ์ด'} seed ${m.seed}`;
    assert.deepEqual(r.illegal, [], `${tag} — มีการเดินที่กติกาปฏิเสธ`);
    assert.equal(r.stuck, false, `${tag} — ไม่จบใน ${m.maxTurns} เทิร์น`);
    assert.ok(r.winner >= 0 && r.winner < m.players, `${tag} — ไม่มีผู้ชนะ`);
    turns += r.turns; cards += r.cards;
    if (r.turns > longest.turns) longest = { turns: r.turns, tag };
    if (m.small2p) { small.n++; small.max = Math.max(small.max, r.turns); } else if (r.turns > 500) over500.push(`${m.players} คน ${m.rows}×${m.cols}: ${r.turns}`);
  }
  report.push(`[1] ${N} เกม: การเดินผิดกติกา 0 · เกมค้าง 0 · เฉลี่ย ${(turns / N).toFixed(0)} เทิร์น/เกม · ใช้การ์ด ${cards} ครั้ง`,
    `    2 คน ≤8×8 (${small.n} เกม): ยาวสุด ${small.max} เทิร์น (เพดาน 500) · กระดานใหญ่/หลายคนที่เกิน 500: ${over500.length} เกม${over500.length ? ' — ' + over500.slice(0, 6).join(', ') + (over500.length > 6 ? ' …' : '') : ''}`,
    `    ยาวสุด: ${longest.turns} เทิร์น (${longest.tag})`);
});

// ══ 2. ลำดับความเก่ง ══ (2 คน 8×8 สลับที่นั่ง การ์ดทุก 2 ตา)
test('2. ลำดับความเก่ง: impossible > hard > normal > easy > บอทสุ่ม', { timeout: 3600000 }, () => {
  const games = FULL ? 100 : 16;
  const rows = [];
  const run = (a, b, need, label) => {
    const t0 = Date.now();
    const r = duel(a.random ? RANDOM : lv(a), b === 'random' ? RANDOM : lv(b), { games, seed: 1000 });
    rows.push(`    ${String(a).padEnd(10)} ชนะ ${String(b).padEnd(10)} ${pct(r.winRate).padStart(4)}  (${r.wa}-${r.wb}${r.stuck ? `, ไม่จบ ${r.stuck}` : ''})  เฉลี่ย ${r.avgTurns.toFixed(0)} เทิร์น  ·  ${a}: ${r.avgMs[0].toFixed(1)} ms/ตา สูงสุด ${r.maxMs[0].toFixed(0)} ms  [${((Date.now() - t0) / 1000).toFixed(0)} วิ]`);
    assert.equal(r.illegal, 0, `${label}: มีการเดินผิดกติกา`);
    assert.equal(r.stuck, 0, `${label}: มีเกมที่ไม่จบใน 500 เทิร์น`);
    assert.ok(r.winRate >= need, `${label}: ชนะ ${pct(r.winRate)} ต้องได้อย่างน้อย ${pct(need)} (${games} เกม)`);
  };
  // เทียบกับบอทสุ่ม (เกณฑ์ของบรีฟ: 55 / 75 / 90 / 95%)
  [['easy', 0.55], ['normal', 0.75], ['hard', 0.90], ['impossible', 0.95]].forEach(([l, need]) => run(l, 'random', need, `${l} พบบอทสุ่ม`));
  // คู่ติดกัน (บรีฟ: ≥60% จาก ≥100 เกม) — ชุดเร็วเล่น 16 เกม จึงขอแค่ "ชนะเกินครึ่ง"
  const need = FULL ? 0.60 : 0.5001;
  [['normal', 'easy'], ['hard', 'normal'], ['impossible', 'hard']].forEach(([a, b]) => run(a, b, need, `${a} พบ ${b}`));
  report.push(`[2] ladder 2 คน 8×8 การ์ดทุก 2 ตา สลับที่นั่ง ${games} เกมต่อคู่ (งบเป็นจำนวนการจำลอง ผลซ้ำได้)`, ...rows);
});

// ══ 3. หลายผู้เล่น ══
test('3. 4 ผู้เล่น: hard 1 ตัว + easy 3 ตัว → hard ชนะเกิน 40%', { timeout: 1800000 }, () => {
  const games = FULL ? 100 : 12;
  let win = 0, done = 0, illegal = 0, turns = 0;
  for (let g = 0; g < games; g++) {
    const seat = g % 4;
    const r = playGame({ rows: 8, cols: 8, cardInterval: 2, seed: 3000 + g, maxTurns: 2500, seats: [0, 1, 2, 3].map(i => lv(i === seat ? 'hard' : 'easy')) });
    illegal += r.illegal.length; turns += r.turns;
    if (r.stuck) continue;
    done++; if (r.winner === seat) win++;
  }
  report.push(`[3] 4 คน 8×8: hard 1 + easy 3 → hard ชนะ ${win}/${done} = ${pct(win / done)} (สุ่มล้วนจะได้ 25%) · เฉลี่ย ${(turns / games).toFixed(0)} เทิร์น`);
  assert.equal(illegal, 0);
  assert.equal(done, games, 'ทุกเกมต้องจบ');
  assert.ok(win / done > 0.40, `hard ชนะ ${pct(win / done)} ต้องเกิน 40%`);
});

// ══ 4. ประสิทธิภาพ ══ (วัดเวลาจริง — งบเวลาของแต่ละระดับ บนกระดาน 16×16 ผู้เล่น 6 คน)
const gc = (() => { try { require('v8').setFlagsFromString('--expose-gc'); return require('vm').runInNewContext('gc'); } catch (e) { return null; } })();
let bigPositions = null;
const big = () => bigPositions || (bigPositions = positions({ seed: 77, players: 6, rows: 16, cols: 16, cardInterval: 2, every: 9, max: 16, from: 20, maxNodes: 150, maxTurns: 420 }));
test('4a. 16×16 ผู้เล่น 6 คน: ตัดสินใจภายในงบเวลาของระดับ', { timeout: 600000 }, () => {
  const pos = big();
  assert.ok(pos.length >= 8, `ต้องมีตำแหน่งกลางเกมพอ (ได้ ${pos.length})`);
  const rows = [];
  for (const level of LEVELS) {
    const budget = Bot.LEVELS[level].budgetMs;
    let sum = 0, max = 0, n = 0, pickMax = 0;
    for (let rep = 0; rep < (FULL ? 4 : 2); rep++) for (const { st, me } of pos) {
      const t0 = performance.now();
      const a = Bot.chooseAction(st, me, { level, rng: Bot.makeRng(900 + n) }); // งบเวลาจริงของระดับ (ค่าเริ่มต้น)
      const ms = performance.now() - t0;
      sum += ms; n++; if (ms > max) max = ms;
      assert.ok(legal(st, me, a), `${level}: การเดินที่ได้ต้องถูกกติกา`);
      const choices = L.draw3UniqueCards(0, [], { rng: Bot.makeRng(n) });
      const t1 = performance.now();
      Bot.chooseCardPick(st, me, choices, { level, rng: Bot.makeRng(n) });
      pickMax = Math.max(pickMax, performance.now() - t1);
    }
    rows.push(`    ${level.padEnd(10)} งบ ${String(budget).padStart(3)} ms · เฉลี่ย ${(sum / n).toFixed(1)} ms · สูงสุด ${max.toFixed(0)} ms · เลือกการ์ดสูงสุด ${pickMax.toFixed(0)} ms  (${n} ครั้ง)`);
    // เผื่อ 50% + 30 ms: นาฬิกาถูกเช็กทุก 16 การจำลอง และเครื่องที่รันเทสต์อาจมีงานอื่นแทรก
    assert.ok(max <= budget * 1.5 + 30, `${level}: ช้าสุด ${max.toFixed(0)} ms เกินงบ ${budget} ms`);
    assert.ok(pickMax <= 150, `${level}: เลือกการ์ดช้าสุด ${pickMax.toFixed(0)} ms`);
  }
  report.push('[4] เวลาตัดสินใจบนกระดาน 16×16 ผู้เล่น 6 คน (เวลาจริงบนเครื่องที่รันเทสต์)', ...rows);
});
test('4b. หน่วยความจำไม่โตเรื่อยๆ ใน 1,000 การตัดสินใจ', { timeout: 900000 }, () => {
  const pos = big();
  const heap = () => { if (gc) { gc(); gc(); } return process.memoryUsage().heapUsed / 1048576; };
  let at200 = 0;
  const start = heap();
  for (let i = 0; i < 1000; i++) {
    const { st, me } = pos[i % pos.length], level = LEVELS[i % 4];
    Bot.chooseAction(st, me, { level, rng: Bot.makeRng(i + 1), timeBudgetMs: FULL ? undefined : Infinity, maxNodes: FULL ? undefined : 250 });
    if (i % 10 === 0) Bot.chooseCardPick(st, me, L.draw3UniqueCards(0, [], { rng: Bot.makeRng(i + 1) }), { level, rng: Bot.makeRng(i + 1) });
    if (i === 199) at200 = heap();
  }
  const end = heap();
  report.push(`[4] หน่วยความจำ (heap หลังเก็บขยะ): เริ่ม ${start.toFixed(1)} MB · หลัง 200 ครั้ง ${at200.toFixed(1)} MB · หลัง 1,000 ครั้ง ${end.toFixed(1)} MB${gc ? '' : ' (บังคับเก็บขยะไม่ได้ — ตัวเลขหยาบ)'}`);
  assert.ok(end - at200 < (gc ? 8 : 80), `heap โตจาก ${at200.toFixed(1)} เป็น ${end.toFixed(1)} MB ระหว่างการตัดสินใจครั้งที่ 200–1,000`);
});

// ══ 5. ไม่โกง ══
test('5a. สิ่งที่บอทเห็น: ไม่มีมือ/Key ของคนอื่น และช่วง Eclipse จำนวนลูกของศัตรูถูกปิด', () => {
  const st = mk({ players: 3 });
  set(st, 1, 1, 3, 0); set(st, 2, 2, 1, 1); set(st, 3, 3, 3, 1); set(st, 4, 4, 2, 2);
  st.hands[0] = [def('c1')]; st.hands[1] = [def('u1'), def('r3')]; st.hands[2] = [def('l1')];
  st.keyActive = [1, 1, 1]; st.eclipse = 2;
  const before = JSON.stringify(st);
  const s = Bot.perceive(st, 0, Bot.makeRng(1));
  assert.deepEqual(s.hands.map(h => h.length), [1, 0, 0]);
  assert.deepEqual(s.keyActive, [1, 0, 0]);
  assert.equal(s.cells[1][1].count, 3, 'ลูกของตัวเองเห็นตามจริง');
  assert.deepEqual([s.cells[2][2].count, s.cells[3][3].count, s.cells[4][4].count], [2, 2, 2], 'ลูกของศัตรูช่วง Eclipse ต้องดูเหมือนกันหมด');
  assert.equal(JSON.stringify(st), before, 'perceive ต้องไม่แก้ state ที่รับเข้ามา');
});
test('5b. แก้มือของศัตรู / Key ของศัตรู / ตัวสุ่มของเกม → ได้การเดินเดิมเป๊ะ', () => {
  const pool = L.CARD_DEFS.filter(d => !d.offlineOnly);
  let checked = 0, withCards = 0;
  for (const seed of [11, 12, 13]) for (const { st, me } of positions({ seed, max: 8 })) {
    const others = [...Array(st.players).keys()].filter(p => p !== me);
    const alt = snap(st);
    others.forEach((p, k) => { alt.hands[p] = [0, 1, 2, 3].map(j => ({ ...pool[(seed * 7 + k * 11 + j * 5 + checked) % pool.length] })); alt.keyActive[p] = alt.keyActive[p] ? 0 : 2; });
    alt._rng = Bot.makeRng(999); // ตัวสุ่มของ "เกม" — บอทต้องใช้ตัวสุ่มของตัวเอง ไม่ใช่ตัวนี้
    const choices = L.draw3UniqueCards(0, [], { rng: Bot.makeRng(seed + checked) });
    for (const level of LEVELS) {
      const before = JSON.stringify(st);
      const a = act(st, me, level, 77), b = act(alt, me, level, 77);
      assert.deepEqual(b, a, `${level} seed ${seed} เทิร์น ${st.turnCount}: การเดินเปลี่ยนเมื่อมือของศัตรูเปลี่ยน`);
      assert.equal(JSON.stringify(st), before, 'chooseAction ต้องไม่แก้ state ที่รับเข้ามา');
      assert.ok(legal(st, me, a), `${level}: การเดินต้องถูกกติกา`);
      assert.equal(Bot.chooseCardPick(alt, me, choices, { level, rng: Bot.makeRng(5) }), Bot.chooseCardPick(st, me, choices, { level, rng: Bot.makeRng(5) }), `${level}: การเลือกการ์ดเปลี่ยนเมื่อมือของศัตรูเปลี่ยน`);
      if (a.type === 'card') withCards++;
      checked++;
    }
  }
  assert.ok(checked >= 60, `ตรวจ ${checked} ตำแหน่ง`);
  assert.ok(withCards > 0, 'ต้องมีตำแหน่งที่บอทเลือกใช้การ์ดอยู่ในชุดตรวจด้วย');
});
test('5c. ช่วง Eclipse: แก้จำนวนลูกจริงของศัตรู → ได้การเดินเดิมเป๊ะ', () => {
  let checked = 0, changed = 0;
  for (const seed of [21, 22]) for (const { st, me } of positions({ seed, max: 8 })) {
    const a0 = snap(st); a0.eclipse = 2;
    const a1 = snap(a0);
    for (let r = 0; r < a1.rows; r++) for (let c = 0; c < a1.cols; c++) { const ce = a1.cells[r][c]; if (ce.count > 0 && ce.owner !== me) { ce.count = 1 + (ce.count + r + c) % 3; changed++; } }
    for (const level of LEVELS) { assert.deepEqual(act(a1, me, level, 31), act(a0, me, level, 31), `${level} seed ${seed} เทิร์น ${st.turnCount}: การเดินเปลี่ยนตามจำนวนลูกที่มองไม่เห็น`); checked++; }
  }
  assert.ok(checked >= 40 && changed > 50, `ตรวจ ${checked} ตำแหน่ง แก้ ${changed} ช่อง`);
});

// ══ 6. เคสเฉพาะจุด ══
const SMART = ['normal', 'hard', 'impossible'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
test('6a. ช่อง 3 ลูกติดช่องศัตรู: เติมให้ระเบิดแล้วยึด', () => {
  const st = mk();
  set(st, 2, 2, 3, 0); set(st, 2, 3, 2, 1); set(st, 1, 2, 2, 1); set(st, 5, 5, 1, 0); set(st, 4, 0, 1, 0); set(st, 0, 5, 1, 1);
  for (const level of SMART) for (const seed of SEEDS) assert.deepEqual(act(st, 0, level, seed), { type: 'place', r: 2, c: 2 }, `${level} seed ${seed}`);
});
test('6b. ระเบิดแล้วชนะทันที: เลือกเสมอ', () => {
  const st = mk();
  set(st, 3, 3, 3, 0); set(st, 3, 4, 2, 1); set(st, 0, 0, 2, 0); set(st, 5, 1, 1, 0);
  for (const level of SMART) for (const seed of SEEDS) {
    const a = act(st, 0, level, seed);
    assert.deepEqual(a, { type: 'place', r: 3, c: 3 }, `${level} seed ${seed}`);
  }
  const s = snap(st); L.applyPlace(s, 0, 3, 3); L.processExplosionsSync(s); L.checkEliminations(s);
  assert.equal(L.checkWin(s), true, 'ตำแหน่งนี้ต้องชนะได้ในตาเดียวจริง');
});
test('6c. ไม่เติมช่องที่ศัตรูจะระเบิดลามมา เมื่อมีทางเลือกที่ปลอดภัย', () => {
  // ศัตรูมีช่อง 3 ลูกที่ (2,3) ติดช่องเรา (2,2) ซึ่งมี 2 ลูก: ถ้าเราเติม (2,2) เป็น 3 → ศัตรูระเบิดแล้ว (2,2) กลายเป็น 4 ลูกของศัตรู ระเบิดต่อ ยึดช่องรอบข้างของเราอีก 3 ช่อง
  const st = mk();
  set(st, 2, 3, 3, 1); set(st, 0, 5, 1, 1); set(st, 5, 5, 2, 1);
  set(st, 2, 2, 2, 0); set(st, 2, 1, 1, 0); set(st, 3, 2, 1, 0); set(st, 1, 2, 1, 0); set(st, 5, 0, 2, 0); set(st, 4, 0, 1, 0);
  const loss = move => { const s = snap(st); L.applyPlace(s, 0, move[0], move[1]); L.processExplosionsSync(s); s.moved[1] = false; L.applyPlace(s, 1, 2, 3); L.processExplosionsSync(s); return s.cells.flat().filter(ce => ce.owner === 0 && ce.count > 0).length; };
  assert.ok(loss([2, 2]) < loss([5, 0]), 'ตำแหน่งนี้ การเติม (2,2) ต้องเสียช่องมากกว่าจริง');
  for (const level of ['hard', 'impossible']) for (const seed of SEEDS) {
    const a = act(st, 0, level, seed);
    assert.equal(a.type, 'place', `${level} seed ${seed}`);
    assert.notDeepEqual([a.r, a.c], [2, 2], `${level} seed ${seed}: เติมช่องที่ศัตรูกำลังจะยึด`);
  }
});
test('6d. ตายแล้วถือ Rebirth: ใช้ทันที · ใช้ไม่ได้แล้ว: ข้ามตา', () => {
  const st = mk({ players: 3 });
  set(st, 1, 1, 2, 1); set(st, 4, 4, 3, 2); set(st, 4, 3, 1, 2);
  st.alive = [1, 2]; st.moved = [true, true, true]; st.hands[0] = [def('c1'), def('l5')];
  for (const level of LEVELS) for (const seed of SEEDS) {
    const a = act(st, 0, level, seed);
    assert.equal(a.type, 'card', `${level} seed ${seed}`); assert.equal(a.cardId, 'l5');
    assert.equal(st.cells[a.targets.r][a.targets.c].count, 0, 'คืนชีพบนช่องว่าง');
    assert.ok(legal(st, 0, a), 'กติกาต้องรับ');
  }
  const used = snap(st); used.legendaryUsedBy[0] = 2;
  const none = snap(st); none.hands[0] = [def('c1')];
  for (const level of LEVELS) { assert.deepEqual(act(used, 0, level, 1), { type: 'skip' }); assert.deepEqual(act(none, 0, level, 1), { type: 'skip' }); }
});
test('6e. ไม่ใช้การ์ดเกินโควตา / การ์ดที่ไม่มีเป้าหมายถูกกติกา', () => {
  const legend = L.CARD_DEFS.filter(d => d.rarity === 'legendary' && !d.rebirthOnly && !d.offlineOnly).slice(0, 3);
  const myth = L.CARD_DEFS.filter(d => d.rarity === 'mythical' && !d.offlineOnly).slice(0, 1);
  assert.ok(legend.length >= 2 && myth.length >= 1);
  let n = 0;
  for (const seed of [41, 42, 43]) for (const { st, me } of positions({ seed, players: 2, rows: 8, cols: 8, every: 3, max: 4 })) {
    const s = snap(st);
    s.hands[me] = [...legend, ...myth].slice(0, 4).map(d => ({ ...d }));
    s.legendaryUsedBy[me] = 2; s.mythicalUsedBy[me] = true;
    for (const level of LEVELS) for (const seed of [1, 2, 3]) { const a = act(s, me, level, seed); assert.equal(a.type, 'place', `${level}: ใช้ ${a.cardId} ทั้งที่โควตาหมดแล้ว`); assert.ok(legal(s, me, a)); n++; }
  }
  assert.ok(n >= 60);
  // เปิดเกม: ศัตรูยังไม่มีช่อง → การ์ดที่ต้องเล็งช่องศัตรูใช้ไม่ได้ บอทต้องวางบอล (หรือใช้ใบอื่นที่ถูกกติกา)
  const open = L.createInitialState({ players: 2, mapSize: 6, mapCols: 6, cardInterval: 2 });
  open.hands[0] = ['c3', 'c9', 'u6', 'r3'].map(def);
  for (const level of LEVELS) for (const seed of SEEDS) { const a = act(open, 0, level, seed); assert.ok(legal(open, 0, a), `${level} seed ${seed}: ${JSON.stringify(a)}`); assert.notEqual(a.type, 'skip'); }
});
test('6f. โดน Freeze หรือเดินไปแล้ว: ข้ามตา', () => {
  const st = mk(); set(st, 1, 1, 2, 0); set(st, 4, 4, 2, 1); st.hands[0] = [def('c1')];
  const frozen = snap(st); frozen.frozen[0] = 1;
  const moved = snap(st); moved.moved[0] = true;
  for (const level of LEVELS) { assert.deepEqual(act(frozen, 0, level, 1), { type: 'skip' }); assert.deepEqual(act(moved, 0, level, 1), { type: 'skip' }); }
});
test('6g. เลือกการ์ด: คืน id ที่อยู่ในตัวเลือกหรือ null · มือเต็มไม่รับ · ไม่หยิบใบที่โควตาหมดถ้ามีใบอื่น', () => {
  const st = mk(); set(st, 1, 1, 2, 0); set(st, 2, 1, 3, 0); set(st, 4, 4, 2, 1); set(st, 3, 4, 3, 1);
  const legend = L.CARD_DEFS.find(d => d.rarity === 'legendary' && !d.rebirthOnly && !d.offlineOnly);
  for (const level of LEVELS) for (let seed = 1; seed <= 20; seed++) {
    const choices = L.draw3UniqueCards(0, [], { rng: Bot.makeRng(seed) });
    const id = Bot.chooseCardPick(st, 0, choices, { level, rng: Bot.makeRng(seed) });
    assert.ok(id === null || choices.some(c => c.id === id), `${level} seed ${seed}: ${id}`);
    const full = snap(st); full.hands[0] = ['c1', 'c2', 'c3', 'c8'].map(def);
    assert.equal(Bot.chooseCardPick(full, 0, choices, { level, rng: Bot.makeRng(seed) }), null, 'มือเต็มต้องไม่รับ');
  }
  const spent = snap(st); spent.legendaryUsedBy[0] = 2;
  for (const level of SMART) for (let seed = 1; seed <= 10; seed++) assert.notEqual(Bot.chooseCardPick(spent, 0, [{ ...legend }, def('c1'), def('u1')], { level, rng: Bot.makeRng(seed) }), legend.id, `${level}: หยิบ Legendary ทั้งที่ใช้ครบ 2 ครั้งแล้ว`);
});
test('6h. state แบบโหมดออฟไลน์ (มี size ไม่มี rows/phase/cardInterval) ใช้ได้ และแบบแบ่งงานได้ผลเท่ากับแบบรวดเดียว', async () => {
  const st = mk({ rows: 8, cols: 8 }); set(st, 2, 2, 3, 0); set(st, 2, 3, 2, 1); set(st, 6, 6, 2, 1); set(st, 5, 1, 2, 0); st.hands[0] = [def('u1'), def('c8')];
  const off = snap(st); off.size = off.rows; delete off.rows; delete off.phase; delete off.winner; delete off.cardInterval; delete off.disabledCards;
  for (const level of LEVELS) {
    const a = Bot.chooseAction(off, 0, { level, rng: Bot.makeRng(3), timeBudgetMs: Infinity });
    assert.ok(legal(st, 0, a), `${level}: ${JSON.stringify(a)}`);
    assert.equal(off.rows, undefined, 'ต้องไม่แก้ state ที่รับเข้ามา');
    let yields = 0;
    const b = await Bot.chooseActionAsync(off, 0, { level, rng: Bot.makeRng(3), timeBudgetMs: Infinity, defer: fn => { yields++; setImmediate(fn); } });
    assert.deepEqual(b, a, `${level}: แบบแบ่งงานต้องได้ผลเดียวกัน`);
  }
});
