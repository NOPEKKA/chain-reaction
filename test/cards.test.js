'use strict';
// ชุดทดสอบการ์ด (ส่วน A) — รัน: npm test
// ครึ่งแรก: กติกาใน shared/gameLogic.js ตรงๆ บนกระดาน 6×6 · ครึ่งหลัง: ผ่าน server จริง (socket.io) สำหรับเรื่องที่ขึ้นกับ server
// หลักที่ทุกข้อยึด: การ์ดที่ถูกปฏิเสธต้องไม่เปลี่ยน state เลย (การ์ดยังอยู่ในมือ, ยังไม่เสีย action)

const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../shared/gameLogic');

// ── helpers (กติกาตรงๆ) ──
const def = id => ({ ...logic.CARD_DEFS.find(d => d.id === id) });
function mk({ players = 2, rows = 6, cols = 6 } = {}) {
  const st = logic.createInitialState({ players, mapSize: rows, mapCols: cols, cardInterval: 0 });
  st.moved = st.moved.map((_, i) => i !== 0); // ตาของผู้เล่น 0 · คนอื่น "เดินไปแล้ว"
  return st;
}
const set = (st, r, c, n, o) => { st.cells[r][c].count = n; st.cells[r][c].owner = n > 0 ? o : -1; };
const cell = (st, r, c) => [st.cells[r][c].count, st.cells[r][c].owner];
const give = (st, p, ...ids) => { ids.forEach(id => st.hands[p].push(def(id))); };
const use = (st, p, id, targets = {}) => logic.applyCard(st, p, st.hands[p].find(d => d.id === id) || def(id), targets);
const clean = st => { const c = JSON.parse(JSON.stringify(st)); delete c._fx; return c; };
const total = (st, o) => st.cells.reduce((n, row) => n + row.reduce((m, ce) => m + (o === undefined || ce.owner === o ? ce.count : 0), 0), 0);
// ใช้การ์ดแล้วต้องถูกปฏิเสธ โดย state ไม่เปลี่ยนแม้แต่อย่างเดียว
function rejects(st, p, id, targets, why) {
  if (!st.hands[p].some(d => d.id === id)) give(st, p, id);
  const before = clean(st);
  let res;
  assert.doesNotThrow(() => { res = use(st, p, id, targets); }, `${id}: ต้องไม่โยน exception`);
  assert.equal(res.ok, false, `${id} ${JSON.stringify(targets)} ต้องถูกปฏิเสธ${why ? ' (' + why + ')' : ''}`);
  assert.ok(typeof res.msg === 'string' && res.msg.length > 0, `${id}: ต้องมีข้อความบอกเหตุผล`);
  assert.deepEqual(clean(st), before, `${id}: ถูกปฏิเสธแล้ว state ต้องไม่เปลี่ยน`);
  assert.ok(st.hands[p].some(d => d.id === id), `${id}: การ์ดต้องยังอยู่ในมือ`);
  assert.equal(st.moved[p], false, `${id}: ต้องยังไม่เสีย action`);
  return res;
}
function accepts(st, p, id, targets, why) {
  if (!st.hands[p].some(d => d.id === id)) give(st, p, id);
  const res = use(st, p, id, targets);
  assert.equal(res.ok, true, `${id} ${JSON.stringify(targets)} ต้องใช้ได้${why ? ' (' + why + ')' : ''}: ${res.msg || ''}`);
  return res;
}
// กระดานมาตรฐาน: เรา (0) มีช่อง (1,1)=2 (1,2)=1 · ศัตรู (1) มี (4,4)=3 (4,3)=1 · (2,2) ว่าง
function base(opts) {
  const st = mk(opts);
  set(st, 1, 1, 2, 0); set(st, 1, 2, 1, 0); set(st, 4, 4, 3, 1); set(st, 4, 3, 1, 1);
  return st;
}
const OWN = { r: 1, c: 1 }, ENEMY = { r: 4, c: 4 }, EMPTY = { r: 2, c: 2 };

// ════════ A1: ประเภทช่องเป้าหมาย ════════
test('A1 การ์ดที่ต้องใช้กับช่องตัวเอง/ช่องว่าง ใช้กับช่องศัตรูไม่ได้ (ของเดิม: ขโมย/พลิกช่องศัตรูได้)', () => {
  for (const id of ['c1', 'c2', 'c4', 'c6', 'c8', 'u1', 'u7', 'u10', 'r1', 'r2', 'r7', 'e1', 'e2', 'm1'])
    rejects(base(), 0, id, ENEMY, 'ช่องศัตรู');
});

test('A1 การ์ดโจมตีใช้ได้กับช่องศัตรูที่มีลูกเท่านั้น (ของเดิม: Poke ช่องว่างได้ลูกไร้เจ้าของ, Sniper ช่องตัวเองแล้วการ์ดหาย)', () => {
  for (const id of ['c3', 'c7', 'c9', 'u5', 'u6', 'u8', 'u9', 'e3']) {
    rejects(base(), 0, id, OWN, 'ช่องตัวเอง');
    rejects(base(), 0, id, EMPTY, 'ช่องว่าง');
    accepts(base(), 0, id, ENEMY, 'ช่องศัตรูที่มีลูก');
  }
});

test('A1 โล่: Sniper / Drain / Raid ใช้กับช่องศัตรูที่มีโล่ไม่ได้ · Steal ข้ามโล่ได้ (ตั้งใจ)', () => {
  const shielded = () => { const st = base(); st.shielded[4][4] = 1; st.shieldOwner[4][4] = 1; return st; };
  for (const id of ['c3', 'c9', 'u6']) rejects(shielded(), 0, id, ENEMY, 'มีโล่');
  const st = shielded();
  accepts(st, 0, 'e3', ENEMY);
  assert.deepEqual(cell(st, 4, 4), [3, 0], 'Steal: ช่องกลายเป็นของเรา');
});

test('A1 ช่องว่าง: ใบที่ขยายพื้นที่ได้ใช้กับช่องว่างได้ · ใบที่ต้องมีลูกของตัวเองใช้กับช่องว่างไม่ได้', () => {
  for (const id of ['c2', 'c4', 'c6', 'c8', 'u7', 'r1', 'r2', 'e1', 'e2']) accepts(base(), 0, id, EMPTY);
  for (const id of ['c1', 'u1', 'u10', 'r7', 'm1']) rejects(base(), 0, id, EMPTY, 'ช่องว่าง');
  for (const id of ['c1', 'u1', 'u10', 'r7', 'm1']) accepts(base(), 0, id, OWN);
});

test('A1 การ์ดสองเป้า: กฎของช่องที่สอง', () => {
  // Double Shot: ทั้งสองช่องต้องเป็นของเรา
  rejects(base(), 0, 'u3', { r: 1, c: 1, r2: 4, c2: 4 }, 'ช่องสองเป็นของศัตรู');
  rejects(base(), 0, 'u3', { r: 1, c: 1, r2: 2, c2: 2 }, 'ช่องสองว่าง');
  rejects(base(), 0, 'u3', { r: 1, c: 1, r2: 1, c2: 1 }, 'ช่องเดียวกัน');
  accepts(base(), 0, 'u3', { r: 1, c: 1, r2: 1, c2: 2 });
  // Sever: ทั้งสองช่องต้องเป็นของเรา
  rejects(base(), 0, 'sr1', { r: 1, c: 1, r2: 4, c2: 4 }, 'ช่องสองเป็นของศัตรู');
  rejects(base(), 0, 'sr1', { r: 2, c: 2, r2: 1, c2: 1 }, 'ช่องแรกว่าง');
  accepts(base(), 0, 'sr1', { r: 1, c: 1, r2: 1, c2: 2 });
  // Spin: ช่องแรกต้องเป็นของเราและมีลูก · ช่องสองต้องติดกัน
  rejects(base(), 0, 'c5', { r: 2, c: 2, r2: 2, c2: 3 }, 'ช่องแรกไม่มีลูก');
  rejects(base(), 0, 'c5', { r: 4, c: 4, r2: 4, c2: 5 }, 'ช่องแรกเป็นของศัตรู');
  rejects(base(), 0, 'c5', { r: 1, c: 1, r2: 3, c2: 3 }, 'ไม่ติดกัน');
  accepts(base(), 0, 'c5', { r: 1, c: 1, r2: 0, c2: 1 });
  // Swap: ช่องแรกตามกฎช่องตัวเอง/ว่าง · ช่องสองเป็นช่องไหนก็ได้
  rejects(base(), 0, 'u2', { r: 4, c: 4, r2: 1, c2: 1 }, 'ช่องแรกเป็นของศัตรู');
  const st = base();
  accepts(st, 0, 'u2', { r: 1, c: 1, r2: 4, c2: 4 });
  assert.deepEqual([cell(st, 1, 1), cell(st, 4, 4)], [[3, 1], [2, 0]], 'สลับตำแหน่งกันจริง');
});

test('A1 validateTargets: ฟังก์ชันเดียวที่ server / client ออนไลน์ / ออฟไลน์ใช้ — ตอบตรงกับ applyCard ทุกใบทุกช่อง', () => {
  assert.equal(typeof logic.validateTargets, 'function');
  let checked = 0;
  for (const d of logic.CARD_DEFS) {
    if (d.rebirthOnly) continue;
    for (const t of [OWN, ENEMY, EMPTY, { r: 0, c: 0 }, { r: 9, c: 9 }, { r: 1.5, c: 1 }, {}]) {
      const targets = d.twoTarget ? { ...t, r2: 1, c2: 2 } : t;
      const a = base(); give(a, 0, d.id);
      const v = logic.validateTargets(a, a.hands[0][0], 0, targets);
      const b = base(); give(b, 0, d.id);
      const res = logic.applyCard(b, 0, b.hands[0][0], targets);
      if (d.id === 'r8') continue; // Rewind ขึ้นกับ snapshot ไม่ใช่เป้าหมาย
      assert.equal(res.ok, v.ok, `${d.id} ${JSON.stringify(targets)}: validateTargets=${v.ok} (${v.msg || ''}) แต่ applyCard=${res.ok} (${res.msg || ''})`);
      if (!v.ok) assert.ok(typeof v.msg === 'string' && v.msg.length > 0);
      checked++;
    }
  }
  assert.ok(checked > 250);
});

// ════════ A2: การ์ดที่เคยไม่มีผล ════════
test('A2 Scout: ได้ชื่อการ์ดในมือของผู้เล่นอื่น ผ่านช่องส่วนตัวเท่านั้น (ไม่อยู่ใน vfxData ที่ broadcast)', () => {
  const st = base(); give(st, 1, 'c3', 'l2');
  const res = accepts(st, 0, 'c12');
  assert.ok(res.private && res.private.scout, 'ผลของ Scout อยู่ใน res.private');
  assert.equal(res.private.scout.player, 1);
  assert.deepEqual(res.private.scout.cards.map(c => c.name).sort(), ['Nuclear', 'Sniper']);
  const pub = JSON.stringify({ v: res.vfxData, t: res.resultText });
  assert.ok(!/Nuclear|Sniper|l2|c3/.test(pub), 'ส่วนที่ broadcast ต้องไม่มีชื่อการ์ด: ' + pub);
  assert.equal(st.moved[0], true); assert.equal(st.hands[0].length, 0);
});

test('A2 Shuffle Zone: สุ่มตำแหน่งใน 3×3 โดยจำนวนลูกของแต่ละฝ่ายเท่าเดิม ช่องนอกโซนไม่ถูกแตะ', () => {
  for (let i = 0; i < 30; i++) {
    const st = base(); set(st, 2, 1, 3, 1); set(st, 0, 0, 2, 0); set(st, 5, 5, 2, 1);
    const before = clean(st), t0 = total(st, 0), t1 = total(st, 1);
    accepts(st, 0, 'u7', OWN);
    assert.equal(total(st, 0), t0); assert.equal(total(st, 1), t1);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (r > 2 || c > 2) assert.deepEqual(cell(st, r, c), [before.cells[r][c].count, before.cells[r][c].owner], `นอกโซน (${r},${c})`);
  }
  // ต้องขยับจริงบ้าง (ไม่ใช่ no-op)
  let moved = 0;
  for (let i = 0; i < 20; i++) { const st = base(); const b = JSON.stringify(st.cells); accepts(st, 0, 'u7', OWN); if (JSON.stringify(st.cells) !== b) moved++; }
  assert.ok(moved >= 10, `สุ่มแล้วต้องเปลี่ยนตำแหน่งจริง (${moved}/20)`);
});

test('A2 Shuffle Zone: กระดานผืนผ้า (4×9) ที่มุมกระดาน และไม่แตะช่อง Void', () => {
  const st = mk({ rows: 4, cols: 9 });
  set(st, 3, 8, 2, 0); set(st, 2, 8, 3, 1); set(st, 3, 7, 1, 1); set(st, 2, 7, 2, 0);
  st.voidCells['2,7'] = 2; st.voidSnapshot['2,7'] = { count: 2, owner: 0 }; set(st, 2, 7, 0, -1); // ช่องนี้หายอยู่
  const t0 = total(st, 0), t1 = total(st, 1);
  accepts(st, 0, 'u7', { r: 3, c: 8 });
  assert.equal(total(st, 0), t0); assert.equal(total(st, 1), t1);
  assert.deepEqual(cell(st, 2, 7), [0, -1], 'ช่อง Void ต้องว่างเหมือนเดิม');
  assert.deepEqual(st.voidSnapshot['2,7'], { count: 2, owner: 0 });
});

test('A2 Mirror: คัดลอกจำนวนลูกของช่องศัตรูมาใส่ช่องตัวเองที่ใกล้ที่สุด', () => {
  const st = base(); set(st, 3, 4, 1, 0); // ช่องเราที่ติดกับ (4,4)
  accepts(st, 0, 'u8', ENEMY);
  assert.deepEqual(cell(st, 3, 4), [3, 0]);
  assert.deepEqual(cell(st, 4, 4), [3, 1], 'ช่องศัตรูไม่เปลี่ยน');
  const none = mk(); set(none, 4, 4, 3, 1);
  rejects(none, 0, 'u8', ENEMY, 'ไม่มีช่องของตัวเอง');
});

test('A2 Rewind: ไม่มีอะไรให้ย้อน → ปฏิเสธ การ์ดไม่ถูกกิน', () => {
  const st = base(); st._snapshot = null;
  const res = rejects(st, 0, 'r8', {});
  assert.match(res.msg, /ย้อน/);
});

test('A2 Rewind: คืนกระดาน + ผู้เล่นที่ถูกคัดออก + เอฟเฟกต์ของกระดาน แต่ไม่คืนการ์ดที่ใช้ไปแล้ว', () => {
  // ตาของ B (1): B ระเบิดกินช่องสุดท้ายของ A → A ตกรอบ · แล้ว C (2) ใช้ Rewind
  const st = mk({ players: 3 });
  set(st, 0, 0, 1, 0); set(st, 0, 1, 3, 1); set(st, 5, 5, 2, 2); set(st, 3, 3, 2, 1);
  st.shielded[5][5] = 1; st.shieldOwner[5][5] = 2;
  st.current = 1; st.moved = [true, false, true];
  give(st, 1, 'c3'); give(st, 2, 'r8');
  assert.equal(logic.applyPlace(st, 1, 0, 1).ok, true);         // snapshot ถูกเก็บตรงนี้ (ก่อนวาง)
  st.timeBombs.push({ r: 3, c: 3, turnsLeft: 2, owner: 2 });     // เกิดหลัง snapshot → ต้องหายเมื่อย้อน
  logic.processExplosionsSync(st); logic.checkEliminations(st);
  assert.deepEqual(st.alive, [1, 2], 'A ตกรอบ');
  logic.nextTurn(st);
  assert.equal(st.current, 2);
  st.shielded[5][5] = 0; st.shieldOwner[5][5] = -1;              // โล่หมดไปแล้วในตานี้
  accepts(st, 2, 'r8', {});
  assert.deepEqual(st.alive, [0, 1, 2], 'A กลับมา');
  assert.deepEqual([cell(st, 0, 0), cell(st, 0, 1)], [[1, 0], [3, 1]], 'กระดานก่อนการเดินของ B');
  assert.equal(st.shielded[5][5], 1, 'โล่กลับมา'); assert.equal(st.shieldOwner[5][5], 2);
  assert.equal(st.timeBombs.length, 0, 'Time Bomb ที่วางหลังจากนั้นหายไป');
  assert.deepEqual(st.hands[1].map(d => d.id), ['c3'], 'มือของคนอื่นไม่ถูกแตะ');
  assert.equal(st.hands[2].length, 0, 'Rewind ถูกใช้ไป');
});

// ════════ A3: ทำงานต่างจากคำอธิบาย ════════
test('A3 Eclipse: ซ่อนจำนวนลูกเท่านั้น — ไม่เปลี่ยนความจุของช่อง (ของเดิม: ช่อง 4 ลูกไม่ระเบิด)', () => {
  const run = eclipse => { const st = mk(); set(st, 2, 2, 4, 0); set(st, 2, 3, 3, 1); st.eclipse = eclipse; const w = logic.processExplosionsWithWaves(st).length; return [w, JSON.stringify(st.cells)]; };
  assert.deepEqual(run(2), run(0));
  assert.ok(run(2)[0] >= 1, 'ช่อง 4 ลูกต้องระเบิดแม้อยู่ใน Eclipse');
  const st = base(); accepts(st, 0, 'sr2'); assert.equal(st.eclipse, 2);
});

test('A3 Key: เป็นของผู้เล่นคนนั้น ลดเฉพาะตอนเขาจั่วจริง (ของเดิม: ค่ากลางทั้งห้อง ลดทุกครั้งที่ใครใช้การ์ดอะไรก็ได้)', () => {
  const RARE = ['rare', 'super_rare', 'epic', 'legendary', 'mythical'];
  const st = base(); give(st, 0, 'sr3', 'c8', 'c10');
  accepts(st, 0, 'sr3');
  assert.ok(Array.isArray(st.keyActive), 'keyActive แยกรายผู้เล่น');
  assert.deepEqual(st.keyActive, [1, 0]);
  st.moved[0] = false; accepts(st, 0, 'c8', OWN);
  assert.deepEqual(st.keyActive, [1, 0], 'ใช้การ์ดอื่นไม่ทำให้ Key หาย');
  // อีกคนจั่ว: ไม่ได้สิทธิ์ และไม่กิน Key ของเรา
  assert.equal(typeof logic.drawPickChoices, 'function');
  logic.drawPickChoices(st, 1);
  assert.deepEqual(st.keyActive, [1, 0]);
  // เราจั่ว (Cycle): ได้ rare ขึ้นไปแน่นอน แล้ว Key หมด
  st.moved[0] = false; accepts(st, 0, 'c10');
  assert.ok(RARE.includes(st.hands[0][0].rarity), 'Cycle หลัง Key ได้ ' + st.hands[0][0].rarity);
  assert.deepEqual(st.keyActive, [0, 0]);
  // รอบเลือกการ์ดของเรา: 3 ใบ rare ขึ้นไป แล้ว Key หมด
  const s2 = base(); s2.keyActive[0] = 1;
  const picks = logic.drawPickChoices(s2, 0);
  assert.equal(picks.length, 3); assert.ok(picks.every(c => RARE.includes(c.rarity)), picks.map(c => c.rarity).join());
  assert.deepEqual(s2.keyActive, [0, 0]);
});

test('A3 Pin: กันช่องนั้นระเบิดตลอดเทิร์นถัดไปของเจ้าของช่อง แล้วจึงหมด (ของเดิม: หมดก่อนถึงตาศัตรู)', () => {
  const st = base();
  accepts(st, 0, 'u9', ENEMY);
  logic.nextTurn(st);                                   // → ตาของศัตรู (1)
  assert.equal(st.current, 1);
  assert.ok((st.pinned['4,4'] || 0) > 0, 'ถึงตาเจ้าของช่อง Pin ต้องยังอยู่');
  assert.equal(logic.applyPlace(st, 1, 4, 4).ok, true); // เติมเป็น 4 ลูก
  logic.processExplosionsSync(st);
  assert.deepEqual(cell(st, 4, 4), [4, 1], 'ช่องที่ถูก Pin ไม่ระเบิดในลูกโซ่ของตานั้น');
  logic.nextTurn(st);                                   // ตาของเจ้าของช่องจบ → Pin หมด
  assert.equal(st.pinned['4,4'] || 0, 0);
  logic.processExplosionsSync(st);
  assert.deepEqual(cell(st, 4, 4), [0, -1], 'Pin หมดแล้วช่องระเบิดได้ตามปกติ');
});

test('A3 Void: ลูกจากการระเบิดไม่เข้าช่อง Void, วางบน Void ไม่ได้, Void ซ้ำไม่ได้, และกลับมาเหมือนเดิม', () => {
  const st = base(); set(st, 1, 0, 3, 0);
  accepts(st, 0, 'r7', OWN);                             // (1,1) หายไปพร้อม 2 ลูกของเรา
  assert.deepEqual(cell(st, 1, 1), [0, -1]);
  st.moved[0] = false;
  rejects(st, 0, 'r7', OWN, 'Void ซ้ำช่องเดิม');
  rejects(st, 0, 'c8', OWN, 'ช่องที่หายอยู่ใช้เป็นเป้าหมายไม่ได้');
  assert.equal(logic.applyPlace(clean(st), 0, 1, 1).ok, false, 'วางบอลบนช่อง Void ไม่ได้');
  // ระเบิดช่องข้างๆ: ลูกต้องไม่เข้าช่อง Void (ทั้งสองฟังก์ชัน)
  for (const fn of ['processExplosionsSync', 'processExplosionsWithWaves']) {
    const s = clean(st); s.cells[1][0].count = 4;
    logic[fn](s);
    assert.deepEqual(cell(s, 1, 1), [0, -1], fn + ': ไม่ส่งลูกเข้าช่อง Void');
    assert.deepEqual(cell(s, 0, 0), [1, 0]); assert.deepEqual(cell(s, 2, 0), [1, 0]);
  }
  // ครบกำหนด: กลับมาเท่าเดิม
  for (let i = 0; i < 4; i++) logic.nextTurn(st);
  assert.equal(st.voidCells['1,1'] || 0, 0);
  assert.deepEqual(cell(st, 1, 1), [2, 0], 'ช่องกลับมาพร้อมลูกเดิม');
});

test('A3 เอฟเฟกต์ที่มีเจ้าของ (Void / Sever) นับเฉพาะตาของผู้ใช้ — 6 คนเล่นก็อยู่ครบรอบ', () => {
  const st = mk({ players: 6 });
  for (let p = 0; p < 6; p++) set(st, p, p, 1, p);
  set(st, 0, 1, 1, 0); give(st, 0, 'r7', 'sr1');
  accepts(st, 0, 'sr1', { r: 0, c: 0, r2: 0, c2: 1 });
  st.moved[0] = false; accepts(st, 0, 'r7', { r: 0, c: 1 });
  for (let i = 0; i < 5; i++) logic.nextTurn(st);        // ผ่านตาของอีก 5 คน (ยังไม่กลับมาถึงผู้ใช้)
  assert.equal(st.current, 5);
  assert.equal(st.severed['0,0'], 4, 'Sever ยังเต็ม 4');
  assert.equal(st.voidCells['0,1'], 2, 'Void ยังเต็ม 2');
  logic.nextTurn(st);                                    // กลับมาถึงผู้ใช้ → นับ 1
  assert.equal(st.current, 0);
  assert.equal(st.severed['0,0'], 3); assert.equal(st.voidCells['0,1'], 1);
  for (let i = 0; i < 18; i++) logic.nextTurn(st);       // อีก 3 รอบ
  assert.equal(st.severed['0,0'] || 0, 0, 'Sever หมดหลัง 4 ตาของผู้ใช้');
  assert.equal(st.voidCells['0,1'] || 0, 0);
});

test('A3 Big Bang: ระเบิดทุกช่องของเรา แล้ว +2 คืนช่องที่ระเบิดไป แล้วระเบิดต่อ — ลูกโซ่ทั้งสองรอบถูกบันทึกให้ client', () => {
  const st = mk(); set(st, 2, 1, 1, 0); set(st, 2, 2, 1, 0); set(st, 2, 3, 3, 0); set(st, 5, 5, 1, 1);
  accepts(st, 0, 'm2');
  const fx = st._fx;
  assert.ok(fx && fx.waves.length >= 2, 'มีลูกโซ่ที่บันทึกไว้');
  assert.deepEqual(fx.base.slice((2 * 6 + 2) * 2, (2 * 6 + 2) * 2 + 2), [4, 0], 'base = หลังเติมเต็ม ก่อนระเบิด');
  assert.ok(fx.waves.some(w => w.b && w.b.length), 'การ +2 คืนถูกส่งเป็นการเปลี่ยนก่อน wave ของรอบสอง');
  // เทียบกับการคำนวณแบบออฟไลน์: เติมเต็ม → ระเบิด → +2 → ระเบิด
  const ref = mk(); set(ref, 2, 1, 1, 0); set(ref, 2, 2, 1, 0); set(ref, 2, 3, 3, 0); set(ref, 5, 5, 1, 1);
  const mine = [[2, 1], [2, 2], [2, 3]];
  mine.forEach(([r, c]) => { ref.cells[r][c].count = 4; });
  logic.processExplosionsSync(ref);
  mine.forEach(([r, c]) => { const ce = ref.cells[r][c]; if (ce.owner === 0 || ce.owner === -1) { ce.count += 2; ce.owner = 0; } });
  logic.processExplosionsSync(ref);
  assert.equal(JSON.stringify(st.cells), JSON.stringify(ref.cells));
  assert.equal(st.mythicalUsedBy[0], true);
});

test('A3 Meteor: ช่องนั้นระเบิด 2 รอบ', () => {
  const st = mk(); set(st, 2, 2, 1, 0); set(st, 5, 5, 1, 1);
  accepts(st, 0, 'e1', { r: 2, c: 2 });
  // รอบแรกส่ง +1 ให้ 4 ช่องรอบๆ · รอบสองส่งอีก +1 → รอบๆ มีช่องละ 2 ลูก และช่องกลางว่าง
  assert.deepEqual([[1, 2], [3, 2], [2, 1], [2, 3]].map(([r, c]) => cell(st, r, c)), [[2, 0], [2, 0], [2, 0], [2, 0]]);
  assert.deepEqual(cell(st, 2, 2), [0, -1]);
  assert.equal(st._fx.waves.length, 2, 'สอง wave ถูกบันทึก');
});

// ════════ A4: นิยามการ์ดและขีดจำกัด ════════
test('A4 การ์ดเฉพาะออฟไลน์ (Gamble / Boost / Delay) อยู่ในนิยามเดียวกัน แต่ server ไม่สุ่มแจก', () => {
  for (const id of ['c13', 'c14', 'ep4']) assert.equal(logic.CARD_DEFS.find(d => d.id === id)?.offlineOnly, true, id + ' ต้องมี offlineOnly');
  assert.equal(new Set(logic.CARD_DEFS.map(d => d.id)).size, logic.CARD_DEFS.length, 'ไม่มี id ซ้ำ');
  const seen = new Set(), seenOff = new Set();
  for (let i = 0; i < 6000; i++) { seen.add(logic.drawRandomCard(0, []).id); seenOff.add(logic.drawRandomCard(0, [], { offline: true }).id); }
  for (let i = 0; i < 400; i++) logic.draw3UniqueCards(0, []).forEach(c => seen.add(c.id));
  for (const id of ['c13', 'c14', 'ep4']) { assert.equal(seen.has(id), false, id + ' ต้องไม่ถูกแจกออนไลน์'); }
  assert.ok(seenOff.has('c13') && seenOff.has('c14'), 'โหมดออฟไลน์ยังจั่วได้');
});

test('A4 คำอธิบายการ์ดตรงกับขีดจำกัดจริง: Legendary 2 ครั้ง/เกม · Mythical 1 ครั้ง/เกม · Invasion ไม่จำกัด', () => {
  const d = id => logic.CARD_DEFS.find(x => x.id === id);
  for (const x of logic.CARD_DEFS) {
    if (x.rarity === 'legendary') assert.ok(!/1\s*ครั้ง/.test(x.desc), `${x.id} ${x.name}: โค้ดให้ใช้ Legendary ได้ 2 ครั้ง แต่คำอธิบายเขียน 1 ครั้ง`);
    if (x.rarity !== 'legendary' && x.rarity !== 'mythical') assert.ok(!/ครั้ง\/เกม/.test(x.desc), `${x.id} ${x.name}: ไม่มีขีดจำกัดในโค้ด แต่คำอธิบายบอกว่ามี`);
  }
  assert.match(d('l2').desc, /2\s*ครั้ง/); assert.match(d('l3').desc, /2\s*ครั้ง/); assert.match(d('m2').desc, /1\s*ครั้ง/);
  assert.match(d('e3').desc, /โล่/); assert.match(d('l4').desc, /โล่/);
  // ขีดจำกัดจริง
  const st = base(); st.legendaryUsedBy[0] = 2; rejects(st, 0, 'l2', {}, 'Legendary ครบ 2 ครั้ง');
  const s2 = base(); s2.mythicalUsedBy[0] = true; rejects(s2, 0, 'm2', {}, 'Mythical ใช้ไปแล้ว');
  const s3 = base(); s3.legendaryUsedBy[0] = 2; accepts(s3, 0, 'l4', {}, 'Invasion ไม่นับโควตา');
});

test('A4 โล่: ลูกจากการระเบิดของศัตรูไม่เข้าช่องที่มีโล่ และไม่พลิกเจ้าของ — สองฟังก์ชันระเบิดให้ผลเท่ากัน', () => {
  const mkb = () => { const st = mk(); set(st, 2, 2, 4, 0); set(st, 2, 3, 1, 1); set(st, 1, 2, 1, 0); st.shielded[2][3] = 1; st.shieldOwner[2][3] = 1; st.shielded[1][2] = 1; st.shieldOwner[1][2] = 0; return st; };
  const a = mkb(), b = mkb();
  logic.processExplosionsSync(a); logic.processExplosionsWithWaves(b);
  assert.deepEqual(cell(a, 2, 3), [1, 1], 'ช่องศัตรูที่มีโล่: ไม่รับลูก ไม่เปลี่ยนเจ้าของ');
  assert.deepEqual(cell(a, 1, 2), [2, 0], 'โล่ของเราเอง: ลูกของเราเข้าได้');
  assert.equal(JSON.stringify(a.cells), JSON.stringify(b.cells));
});

test('A4 processExplosionsSync และ processExplosionsWithWaves ให้ผลเท่ากันเสมอ (กระดานสุ่ม 300 แบบ มีโล่ / Void / Pin / Sever / Eclipse)', () => {
  let s = 987654321; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 300; i++) {
    const rows = 4 + Math.floor(rnd() * 6), cols = 4 + Math.floor(rnd() * 8), players = 2 + Math.floor(rnd() * 3);
    const st = mk({ players, rows, cols });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const n = Math.floor(rnd() * 5.3); set(st, r, c, n, Math.floor(rnd() * players));
      if (rnd() < .08) { st.shielded[r][c] = 1; st.shieldOwner[r][c] = Math.floor(rnd() * players); }
      if (rnd() < .04) { st.voidCells[`${r},${c}`] = 2; set(st, r, c, 0, -1); }
      if (rnd() < .04) st.pinned[`${r},${c}`] = 1;
      if (rnd() < .04) st.severed[`${r},${c}`] = 4;
    }
    st.eclipse = rnd() < .3 ? 2 : 0;
    const a = clean(st), b = clean(st);
    logic.processExplosionsSync(a); logic.processExplosionsWithWaves(b);
    assert.equal(JSON.stringify(a.cells), JSON.stringify(b.cells), `กระดานสุ่ม #${i} (${rows}×${cols})`);
  }
});

// ════════ A5: สำเนาเบาสำหรับจำลอง (บอท / นับความยาวลูกโซ่) ════════
test('A5 cloneSim: เดินบนสำเนาได้ผลเท่ากับเดินบนของจริง และของจริงไม่ถูกแตะ', () => {
  let s = 13579; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const view = st => JSON.stringify({ cells: st.cells, alive: st.alive, current: st.current, moved: st.moved, shielded: st.shielded, shieldOwner: st.shieldOwner,
    voidCells: st.voidCells, severed: st.severed, pinned: st.pinned, timeBombs: st.timeBombs, frozen: st.frozen, turnCount: st.turnCount, hands: st.hands.map(h => h.map(d => d.id)), eclipse: st.eclipse, keyActive: st.keyActive });
  for (let i = 0; i < 60; i++) {
    const rows = 4 + Math.floor(rnd() * 5), cols = 4 + Math.floor(rnd() * 7), players = 2 + Math.floor(rnd() * 3);
    const st = mk({ players, rows, cols });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const n = Math.floor(rnd() * 4.4); set(st, r, c, Math.min(3, n), Math.floor(rnd() * players)); if (rnd() < .06) { st.shielded[r][c] = 1; st.shieldOwner[r][c] = Math.floor(rnd() * players); } }
    set(st, 0, 0, 3, 0); give(st, 0, 'c8'); give(st, 1, 'l2'); st.timeBombs.push({ r: 1, c: 1, turnsLeft: 2, owner: 0 }); st.severed['2,2'] = 4; st.severedOwner['2,2'] = 1;
    const before = clean(st);
    const sim = logic.cloneSim(st), ref = JSON.parse(JSON.stringify(st));
    for (const x of [sim, ref]) {
      assert.equal(logic.applyPlace(x, 0, 0, 0).ok, true);
      logic.processExplosionsSync(x); if (logic.tickTimeBombs(x)) logic.processExplosionsSync(x);
      logic.checkEliminations(x); if (!logic.checkWin(x)) logic.nextTurn(x);
    }
    assert.equal(view(sim), view(ref), `กระดานสุ่ม #${i}`);
    assert.deepEqual(clean(st), before, 'ของจริงต้องไม่เปลี่ยน');
    assert.equal(sim._fx, undefined, 'สำเนาไม่บันทึกลูกโซ่');
    assert.equal(logic.countWaves(st) >= 0, true);
    assert.deepEqual(clean(st), before, 'countWaves ไม่แตะของจริง');
  }
});

// ════════ A6: smoke test ทุกใบ ════════
test('A6 ทุกใบใน CARD_DEFS ใช้กับเป้าหมายที่ถูกต้องได้โดยไม่โยน exception และกระดานยังสมเหตุสมผล', () => {
  const pick = (st, d) => {
    if (d.rebirthOnly) return EMPTY;
    if (!d.needTarget && d.id !== 'e4') return {};
    if (d.twoTarget) return d.id === 'c5' ? { r: 1, c: 1, r2: 0, c2: 1 } : { r: 1, c: 1, r2: 1, c2: 2 };
    return d.targetSelf || d.id === 'e4' ? OWN : ENEMY;
  };
  for (const d of logic.CARD_DEFS) {
    for (let i = 0; i < 8; i++) {
      const st = base({ players: 3 }); set(st, 3, 0, 2, 2); give(st, 1, 'c3'); give(st, 2, 'c8');
      if (d.id === 'r8') { logic.takeSnapshot(st); st.cells[1][1].count = 3; } // มีอะไรให้ย้อน
      if (d.rebirthOnly) { st.alive = [1, 2]; st.cells[1][1].count = 0; st.cells[1][1].owner = -1; st.cells[1][2].count = 0; st.cells[1][2].owner = -1; }
      give(st, 0, d.id);
      let res;
      assert.doesNotThrow(() => { res = logic.applyCard(st, 0, st.hands[0][0], pick(st, d)); logic.processExplosionsWithWaves(st); logic.checkEliminations(st); }, `${d.id} ${d.name}`);
      assert.equal(res.ok, true, `${d.id} ${d.name}: ${res.msg || ''}`);
      assert.equal(st.hands[0].some(x => x.id === d.id) && d.id !== 'c10', false, `${d.id}: การ์ดต้องออกจากมือ`);
      for (const row of st.cells) for (const ce of row) {
        assert.ok(Number.isInteger(ce.count) && ce.count >= 0, `${d.id}: จำนวนลูกต้องเป็นจำนวนเต็มไม่ติดลบ`);
        assert.ok(ce.count === 0 ? ce.owner === -1 : (ce.owner >= 0 && ce.owner < 3), `${d.id}: ช่องที่มีลูกต้องมีเจ้าของ ช่องว่างต้องไม่มี (${ce.count}/${ce.owner})`);
      }
      assert.doesNotThrow(() => JSON.stringify(st));
    }
  }
});

// ════════════════════════════════════════════════════════════════════
// ผ่าน server จริง
// ════════════════════════════════════════════════════════════════════
Object.assign(process.env, { TURN_MS: '4000', DISCONNECT_GRACE_MS: '400', PICK_MS: '1500', LOBBY_GRACE_MS: '250', SKIP_DELAY_MS: '40' });
const quietLog = console.log; console.log = () => {};
const srv = require('../server/index.js'); console.log = quietLog;
const { io: ioc } = require('socket.io-client');
let port; const socks = [];
test.before(async () => { port = await srv.start(0); });
test.after(async () => { socks.forEach(s => s.close()); await srv.stop(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 2000, what = 'condition') { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`หมดเวลารอ: ${what}`); await sleep(15); } }
function client() {
  const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  socks.push(s);
  s.updates = []; s.on('room_update', r => s.updates.push(r));
  s.hands = []; s.on('your_hand', h => s.hands.push(h));
  s.seen = []; for (const ev of ['card_vfx', 'room_update', 'your_hand', 'group_pick_start']) s.on(ev, d => s.seen.push([ev, JSON.stringify(d)]));
  return new Promise((res, rej) => { s.once('connect', () => res(s)); s.once('connect_error', rej); });
}
function emit(s, ev, data, ms = 1500) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`server ไม่ตอบ "${ev}"`)), ms); const cb = r => { clearTimeout(t); res(r); }; if (data === undefined) s.emit(ev, cb); else s.emit(ev, data, cb); });
}
const last = s => s.updates[s.updates.length - 1];
async function started(cfg = {}) {
  const a = await client();
  const c = await emit(a, 'create_room', { name: 'A', cfg: { mapSize: 6, mapCols: 6, cardInterval: 0, ...cfg } });
  const b = await client();
  assert.equal((await emit(b, 'join_room', { code: c.code, name: 'B' })).ok, true);
  assert.equal((await emit(a, 'start_game')).ok, true);
  await until(() => last(a) && last(a).state && last(b) && last(b).state, 2000, 'เกมเริ่ม');
  const S = () => srv.rooms.get(c.code).state;
  // กระดานมาตรฐานเดียวกับครึ่งแรก และเป็นตาของ A
  const st = S(); set(st, 1, 1, 2, 0); set(st, 1, 2, 1, 0); set(st, 4, 4, 3, 1); set(st, 4, 3, 1, 1);
  st.moved = [false, true]; st.turnCount = 2;
  return { a, b, code: c.code, S, room: () => srv.rooms.get(c.code) };
}

test('A1 (server) การ์ดผิดประเภทช่องถูกปฏิเสธพร้อมข้อความไทย state ไม่เปลี่ยน และยังเป็นตาเดิม', async () => {
  const g = await started();
  give(g.S(), 0, 'c4', 'c7', 'c3');
  const before = clean(g.S());
  for (const [cardId, targets] of [['c4', ENEMY], ['c7', EMPTY], ['c3', OWN], ['c4', { r: 99, c: 0 }], ['c4', 'x']]) {
    const res = await emit(g.a, 'use_card', { cardId, targets });
    assert.equal(res.ok, false, cardId + ' ' + JSON.stringify(targets));
    assert.match(res.msg, /[฀-๿]/, 'ข้อความเป็นภาษาไทย: ' + res.msg);
  }
  assert.deepEqual(clean(g.S()), before);
  assert.equal(g.S().current, 0);
  assert.equal((await emit(g.a, 'use_card', { cardId: 'c4', targets: OWN })).ok, true, 'เป้าหมายถูกต้องยังใช้ได้');
});

test('A2 (server) Scout: ชื่อการ์ดไปถึงเฉพาะคนใช้ — คนอื่นและ broadcast ไม่มีข้อมูลนี้', async () => {
  const g = await started();
  give(g.S(), 0, 'c12'); give(g.S(), 1, 'l2', 'c3');
  g.b.seen.length = 0; g.a.seen.length = 0;
  const res = await emit(g.a, 'use_card', { cardId: 'c12', targets: {} });
  assert.equal(res.ok, true, res.msg);
  assert.ok(res.scout && res.scout.player === 1, 'คนใช้ได้ผลของ Scout ใน callback');
  assert.deepEqual(res.scout.cards.map(c => c.name).sort(), ['Nuclear', 'Sniper']);
  await until(() => g.b.seen.some(e => e[0] === 'room_update'), 1500, 'B ได้ update');
  await sleep(100);
  const leak = [...g.b.seen, ...g.a.seen].filter(e => e[0] !== 'your_hand' && /Nuclear|Sniper/.test(e[1]));
  assert.deepEqual(leak.map(e => e[0]), [], 'ชื่อการ์ดหลุดไปใน event ที่ broadcast');
});

test('A4 (server) discard_card: ทิ้งการ์ดได้ในตาตัวเอง ไม่เสีย action · ตาคนอื่น/การ์ดที่ไม่มี ทิ้งไม่ได้', async () => {
  const g = await started();
  give(g.S(), 0, 'l2', 'c8'); give(g.S(), 1, 'c3');
  g.S().legendaryUsedBy[0] = 2; // Nuclear ใช้ไม่ได้แล้ว ค้างในมือ
  assert.equal((await emit(g.b, 'discard_card', { cardId: 'c3' })).ok, false, 'ไม่ใช่ตาของ B');
  assert.equal((await emit(g.a, 'discard_card', { cardId: 'zz' })).ok, false, 'ไม่มีการ์ดนี้');
  assert.equal((await emit(g.a, 'discard_card', {})).ok, false);
  const res = await emit(g.a, 'discard_card', { cardId: 'l2' });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(g.S().hands[0].map(d => d.id), ['c8']);
  assert.equal(g.S().moved[0], false, 'ทิ้งการ์ดไม่เสีย action');
  assert.equal(g.S().current, 0);
  await until(() => g.a.hands.length && g.a.hands[g.a.hands.length - 1].hand.length === 1, 1500, 'A ได้มือใหม่');
  await until(() => last(g.b).state.handsCount[0] === 1, 1500, 'B เห็นจำนวนการ์ดของ A ลดลง');
  assert.equal((await emit(g.a, 'place', { r: 1, c: 1 })).ok, true, 'ยังเดินต่อได้ในตาเดียวกัน');
});

test('A3 (server) Key ของ A ทำให้ตัวเลือกของ A เป็น rare ขึ้นไป แต่ไม่ใช่ของ B · A4: ไม่แจกการ์ดเฉพาะออฟไลน์', async () => {
  const RARE = ['rare', 'super_rare', 'epic', 'legendary', 'mythical'];
  const g = await started({ cardInterval: 1 });
  const st = g.S(); st.cardInterval = 1; st.turnCount = 1; st.keyActive[0] = 1; // หลังตานี้ถึงรอบเลือกการ์ด
  assert.equal((await emit(g.a, 'place', { r: 1, c: 1 })).ok, true);
  const pa = JSON.parse((await until(() => g.a.seen.find(e => e[0] === 'group_pick_start'), 3000, 'A ได้ตัวเลือก'))[1]);
  const pb = JSON.parse((await until(() => g.b.seen.find(e => e[0] === 'group_pick_start'), 3000, 'B ได้ตัวเลือก'))[1]);
  assert.ok(pa.cards.every(c => RARE.includes(c.rarity)), 'ตัวเลือกของ A: ' + pa.cards.map(c => c.rarity).join());
  assert.deepEqual(g.S().keyActive, [0, 0], 'Key ของ A ถูกใช้ไป');
  for (const c of [...pa.cards, ...pb.cards]) assert.ok(!c.offlineOnly && !['c13', 'c14', 'ep4'].includes(c.id), 'ไม่แจกการ์ดเฉพาะออฟไลน์: ' + c.id);
  // B ไม่ได้สิทธิ์จาก Key ของ A (สุ่ม 3 ใบจะ rare ทั้งหมดโดยบังเอิญแทบเป็นไปไม่ได้: ลองหลายห้อง)
  let allRare = pb.cards.every(c => RARE.includes(c.rarity)) ? 1 : 0;
  for (let i = 0; i < 4; i++) {
    const h = await started({ cardInterval: 1 }); const s = h.S(); s.cardInterval = 1; s.turnCount = 1; s.keyActive[0] = 1;
    await emit(h.a, 'place', { r: 1, c: 1 });
    const p = JSON.parse((await until(() => h.b.seen.find(e => e[0] === 'group_pick_start'), 3000, 'B ได้ตัวเลือก'))[1]);
    if (p.cards.every(c => RARE.includes(c.rarity))) allRare++;
  }
  assert.ok(allRare < 5, 'B ได้ rare ล้วนทุกครั้ง = Key ยังเป็นค่ากลางทั้งห้อง');
});
