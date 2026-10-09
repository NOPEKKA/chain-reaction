'use strict';
// ลูกโซ่ที่ server บันทึกให้ client เล่นตาม (state._fx): เล่นซ้ำจาก base ทีละ wave ต้องได้กระดานเดียวกับที่กติกาคำนวณ — รัน: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../shared/gameLogic');

// ตัวสุ่มที่กำหนด seed ได้ (ผลเทสต์ซ้ำได้)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function board(rows, cols, players, fill) {
  const st = logic.createInitialState({ players, mapSize: rows, mapCols: cols, cardInterval: 0 });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const [n, o] = fill(r, c); st.cells[r][c].count = n; st.cells[r][c].owner = n > 0 ? o : -1; }
  return st;
}
const flat = st => { const out = []; for (const row of st.cells) for (const ce of row) out.push(ce.count, ce.count > 0 ? ce.owner : -1); return out; };
// สิ่งที่ client ทำ: ตั้งกระดานเป็น base แล้ววาด b (ถ้ามี) กับ d ของแต่ละ wave ตามลำดับ
function replay(fx, rows, cols) {
  const b = fx.base.slice();
  const set = list => { for (let i = 0; i < list.length; i += 4) { const k = (list[i] * cols + list[i + 1]) * 2; b[k] = list[i + 2]; b[k + 1] = list[i + 3]; } };
  for (const w of fx.waves) { if (w.b) set(w.b); set(w.d); }
  return b;
}

test('W1 เล่นซ้ำจาก base + ผลของแต่ละ wave = กระดานที่กติกาคำนวณ (กระดานสุ่ม 300 แบบ)', () => {
  const rnd = rng(20261009);
  let chains = 0, longest = 0;
  for (let i = 0; i < 300; i++) {
    const rows = 4 + Math.floor(rnd() * 13), cols = 4 + Math.floor(rnd() * 15), players = 2 + Math.floor(rnd() * 5);
    const st = board(rows, cols, players, () => { const n = Math.floor(rnd() * 5.4); return [n, Math.floor(rnd() * players)]; });
    const before = flat(st);
    const waves = logic.processExplosionsWithWaves(st);
    const fx = st._fx;
    assert.deepEqual(fx.base, before, 'base = กระดานก่อน wave แรก');
    assert.equal(fx.waves.length, waves.length, 'บันทึกครบทุก wave');
    assert.equal(fx.truncated, false);
    waves.forEach((w, k) => assert.deepEqual(fx.waves[k].e, w.explosions.flatMap(x => [x.r, x.c, x.owner]), 'ช่องที่ระเบิดของ wave ' + k));
    assert.deepEqual(replay(fx, rows, cols), flat(st), `กระดาน ${rows}×${cols} #${i}: เล่นซ้ำแล้วต้องเท่ากับผลลัพธ์`);
    if (waves.length) chains++;
    longest = Math.max(longest, waves.length);
  }
  assert.ok(chains > 200 && longest >= 10, `ต้องมีลูกโซ่จริงให้ทดสอบ (มี ${chains} กระดาน, ยาวสุด ${longest} wave)`);
});

test('W2 ระเบิดสองช่วงในตาเดียว (Time Bomb ระเบิดตามหลัง): สิ่งที่เปลี่ยนระหว่างช่วงถูกส่งเป็น b ของ wave ถัดไป', () => {
  const st = board(5, 5, 2, (r, c) => (r === 0 && c < 3 ? [3, 0] : r === 4 && c === 4 ? [1, 1] : [0, -1]));
  st.cells[0][0].count = 4;                       // ช่วงแรก: ลูกโซ่ 3 wave บนแถว 0
  const first = logic.processExplosionsWithWaves(st).length;
  st.cells[4][4].count = 4;                       // "Time Bomb" เติมช่องของผู้เล่น 1 จนเต็ม แล้วระเบิดช่วงที่สอง
  const second = logic.processExplosionsWithWaves(st).length;
  const fx = st._fx;
  assert.ok(first >= 3 && second >= 1);
  assert.equal(fx.waves.length, first + second);
  assert.deepEqual(fx.waves[first].b, [4, 4, 4, 1], 'wave แรกของช่วงที่สองบอกว่าช่อง (4,4) ถูกเติมเป็น 4 ก่อนระเบิด');
  assert.equal(fx.waves.slice(0, first).some(w => w.b), false);
  assert.deepEqual(replay(fx, 5, 5), flat(st));
});

test('W3 ลูกโซ่ไม่ถูกตัดที่ 20 wave: กระดาน 4×18 = 21 wave, 16×18 = 33 wave — บันทึกครบ', () => {
  for (const [rows, cols, want] of [[4, 18, 21], [16, 18, 33]]) {
    const st = board(rows, cols, 2, () => [3, 0]);
    st.cells[0][0].count = 4;
    const waves = logic.processExplosionsWithWaves(st);
    assert.equal(waves.length, want);
    assert.equal(st._fx.waves.length, want);
    assert.deepEqual(replay(st._fx, rows, cols), flat(st));
  }
});

test('W4 เกินเพดาน: เลิกบันทึกและตั้ง truncated (ไม่ตัดเงียบๆ) — กติกายังคำนวณต่อจนจบ', () => {
  const full = board(4, 18, 2, () => [3, 0]); full.cells[0][0].count = 4;
  const cut = board(4, 18, 2, () => [3, 0]); cut.cells[0][0].count = 4;
  logic.processExplosionsWithWaves(full);
  const waves = logic.processExplosionsWithWaves(cut, { maxWaves: 5 });
  assert.equal(waves.length, 21, 'กติกาเดินครบ');
  assert.equal(cut._fx.waves.length, 5);
  assert.equal(cut._fx.truncated, true);
  assert.deepEqual(flat(cut), flat(full), 'ผลลัพธ์บนกระดานเท่ากันไม่ว่าจะบันทึกครบหรือไม่');
  assert.ok(logic.FX_MAX_WAVES >= 400);
});

test('W5 ขนาดข้อมูลของลูกโซ่เต็มกระดานใหญ่สุด (16×18, 33 wave) ยังเล็ก', () => {
  const st = board(16, 18, 2, () => [3, 0]); st.cells[0][0].count = 4;
  logic.processExplosionsWithWaves(st);
  const bytes = Buffer.byteLength(JSON.stringify({ explosionWaves: st._fx.waves, fxBase: st._fx.base }));
  assert.ok(bytes < 40000, `ลูกโซ่ + base = ${bytes} ไบต์`);
});
