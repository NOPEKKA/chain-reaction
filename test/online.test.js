'use strict';
// ชุดทดสอบระบบออนไลน์ — รัน: npm test
// เปิด server จริงในโปรเซสนี้บน port สุ่ม แล้วต่อด้วย socket.io-client (ปิดเองเมื่อจบ)
// หัวข้อ A/B/C/D ตรงกับกลุ่มบั๊กที่แก้ — แต่ละเทสต์ทำให้บั๊กเกิดซ้ำก่อน แล้วยืนยันพฤติกรรมที่ถูกต้อง

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// เวลาสั้นๆ ให้เทสต์เร็ว — ต้องตั้งก่อน require server
const TURN = 1500, GRACE = 400, PICK = 3000;
Object.assign(process.env, {
  TURN_MS: String(TURN), DISCONNECT_GRACE_MS: String(GRACE), PICK_MS: String(PICK),
  LOBBY_GRACE_MS: '250', SKIP_DELAY_MS: '40',
  ROOM_SWEEP_MS: '60', ROOM_TTL_EMPTY_MS: '350', ROOM_TTL_LOBBY_MS: '2200',
});
const quietLog = console.log; console.log = () => {}; // server พิมพ์ log ทุก action
const srv = require('../server/index.js');
const { io: ioc } = require('socket.io-client');
const logic = require('../shared/gameLogic');

let port; const socks = [];
test.before(async () => { port = await srv.start(0); });
test.after(async () => { socks.forEach(s => s.close()); await srv.stop(); console.log = quietLog; });

// ── helpers ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 2000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = fn(); if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`หมดเวลารอ: ${what} (${ms}ms)`);
    await sleep(15);
  }
}
function client() {
  const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  socks.push(s);
  s.updates = []; s.on('room_update', r => s.updates.push(r));
  s.hands = [];   s.on('your_hand', h => s.hands.push(h));
  return new Promise((res, rej) => { s.once('connect', () => res(s)); s.once('connect_error', rej); });
}
function emit(s, ev, data, ms = 1200) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`server ไม่ตอบ "${ev}" ใน ${ms}ms`)), ms);
    const cb = r => { clearTimeout(t); res(r); };
    if (data === undefined) s.emit(ev, cb); else s.emit(ev, data, cb);
  });
}
const last = s => s.updates[s.updates.length - 1];
const card = id => ({ ...logic.CARD_DEFS.find(d => d.id === id) });

// สร้างห้อง + ให้ทุกคนเข้า — คืน { code, players[], srv (ห้องฝั่ง server), S() (state ฝั่ง server) }
async function room(names = ['A', 'B'], cfg = {}) {
  const host = await client();
  const c = await emit(host, 'create_room', { name: names[0], cfg: { mapSize: 5, mapCols: 5, cardInterval: 0, ...cfg } });
  assert.equal(c.ok, true, c.msg); host.token = c.token; host.slot = c.slot;
  const players = [host];
  for (const n of names.slice(1)) {
    const s = await client();
    const j = await emit(s, 'join_room', { code: c.code, name: n });
    assert.equal(j.ok, true, j.msg); s.token = j.token; s.slot = j.slot;
    players.push(s);
  }
  await until(() => last(host) && last(host).members.length === names.length, 1500, 'ทุกคนเข้าห้อง');
  return { code: c.code, players, get srv() { return srv.rooms.get(c.code); }, S() { return srv.rooms.get(c.code).state; } };
}
async function started(names, cfg) {
  const r = await room(names, cfg);
  const res = await emit(r.players[0], 'start_game');
  assert.equal(res.ok, true, res.msg);
  await until(() => r.players.every(p => last(p) && last(p).state), 2000, 'เกมเริ่ม');
  return r;
}
const member = (upd, slot) => upd.members.find(m => m.slot === slot);
// A วาง แล้ว B วาง → กลับมาเป็นตา A (turnCount = 2) โดยทั้งคู่มีบอลบนกระดาน
async function bothPlaced(r) {
  const [a, b] = r.players;
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok);
  await until(() => r.S().current === 1, 1000, 'ถึงตา B');
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  await until(() => r.S().current === 0 && r.S().turnCount === 2 && last(b).state.turnCount === 2, 1000, 'กลับมาที่ตา A');
}

// ═══════════════ A: ความเสถียร ═══════════════

test('A1 ผู้เล่นหลุดกลางเกมแล้ว rejoin ด้วย token ได้ และได้ your_hand กลับ', async () => {
  const r = await started(['A', 'B']);
  const [a, b] = r.players;
  assert.equal(typeof b.token, 'string', 'join_room ต้องคืน playerToken');
  assert.equal(typeof a.token, 'string', 'create_room ต้องคืน playerToken');
  assert.notEqual(a.token, b.token);
  r.S().hands[1].push(card('c3')); // ให้ B มีการ์ด จะได้เช็กว่าได้มือเดิมกลับ
  b.close();
  await until(() => member(last(a), 1).connected === false, 2000, 'A เห็นว่า B หลุด');

  const b2 = await client();
  const res = await emit(b2, 'rejoin_room', { code: r.code, token: b.token });
  assert.equal(res.ok, true, res && res.msg);
  assert.equal(res.slot, 1);
  await until(() => b2.hands.length > 0, 1500, 'your_hand หลัง rejoin');
  assert.deepEqual(b2.hands[b2.hands.length - 1].hand.map(c => c.id), ['c3']);
  await until(() => member(last(a), 1).connected === true, 1500, 'A เห็นว่า B กลับมา');
  assert.equal(last(b2).phase, 'playing');
  assert.ok(last(b2).state, 'ได้ state ของเกมเดิมกลับ');

  const bad = await client();
  assert.equal((await emit(bad, 'rejoin_room', { code: r.code, token: 'not-a-token' })).ok, false, 'token ผิดต้องเข้าไม่ได้');
  assert.equal((await emit(bad, 'rejoin_room', { code: '0000', token: b.token })).ok, false, 'ห้องที่ไม่มีต้องเข้าไม่ได้');
});

test('A1 rejoin ได้ระหว่างเลือกการ์ด (group pick) และตอนเกมจบ', async () => {
  const r = await started(['A', 'B'], { cardInterval: 1 });
  const [a, b] = r.players;
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok);
  await until(() => r.S().current === 1, 1000, 'ถึงตา B');
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  await until(() => r.srv.groupPick, 1500, 'group pick เริ่ม');
  b.close();
  await until(() => member(last(a), 1).connected === false, 1500, 'B หลุด');
  const b2 = await client();
  const res = await emit(b2, 'rejoin_room', { code: r.code, token: b.token });
  assert.equal(res.ok, true, res && res.msg);
  await until(() => b2.hands.length > 0 && last(b2), 1500, 'ได้ room_update + your_hand');
});

test('A2 ผู้เล่นปัจจุบันหลุด → server ข้ามตาให้เองภายในเวลา grace', async () => {
  const r = await started(['A', 'B']);
  const [a, b] = r.players;
  await bothPlaced(r); // ทั้งคู่มีบอลบนกระดานแล้ว (คนที่ยังไม่เคยวางแล้วเสียตา = ตกรอบตามกติกาเดิม)
  assert.equal(last(b).state.current, 0);
  const t0 = Date.now();
  a.close();
  await until(() => last(b).state.current === 1 && last(b).state.turnCount === 3, GRACE + 1500, 'server ข้ามตาของ A ที่หลุด');
  assert.ok(Date.now() - t0 >= GRACE - 100, 'ต้องให้เวลา grace ก่อนข้าม');
  assert.deepEqual(r.S().alive, [0, 1], 'ข้ามตาเฉยๆ ไม่ได้ตกรอบ');
  // หลุดต่อเนื่อง: ตาถัดไปของ A ต้องถูกข้ามทันที ไม่รอ grace/เวลาเต็มอีก
  r.S().cells[3][3].count = 1; // กันไม่ให้การวางครั้งนี้ระเบิด (server บวกเวลาแอนิเมชันระเบิดให้ตาถัดไป)
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  const t1 = Date.now();
  await until(() => r.S().current === 1 && r.S().turnCount >= 5, 1000, 'ข้ามตา A อีกรอบทันที');
  assert.ok(Date.now() - t1 < GRACE, 'รอบที่สองไม่ควรรอ grace อีก');
});

test('A2 ผู้เล่นที่ไม่เดินจนหมดเวลา ถูกข้ามตาโดย timer ของ server', async () => {
  const r = await started(['A', 'B']);
  const [, b] = r.players;
  await bothPlaced(r);
  const t0 = Date.now();
  await until(() => last(b).state.current === 1 && last(b).state.turnCount === 3, TURN + 1500, 'timer ของ server ข้ามตา');
  assert.ok(Date.now() - t0 >= TURN - 150, `ข้ามเร็วเกินไป (${Date.now() - t0}ms)`);
});

test('A2 place_timeout จาก client เป็นแค่ hint — ข้ามตาก่อนเวลาจริงไม่ได้', async () => {
  const r = await started(['A', 'B']);
  const [a] = r.players;
  await emit(a, 'place_timeout', {}).catch(() => {});
  await sleep(120);
  assert.equal(r.S().current, 0, 'ตายังต้องเป็นของ A');
  assert.equal(r.S().moved[0], false);
  assert.equal(r.S().turnCount, 0);
});

test('A3 restart_game ตอนมีคนหลุด: เกมใหม่มีเฉพาะผู้เล่นที่ยังเชื่อมต่อ', async () => {
  const r = await started(['A', 'B', 'C']);
  const [a, b, c] = r.players;
  c.close();
  await until(() => member(last(a), 2).connected === false, 2000, 'C หลุด');
  const res = await emit(a, 'restart_game');
  assert.equal(res.ok, true, res && res.msg);
  assert.deepEqual(r.S().alive, [0, 1], 'C ต้องไม่อยู่ในเกมใหม่');
  assert.ok([0, 1].includes(r.S().current));
  // เดินครบรอบแล้วต้องวนกลับมาที่ A โดยไม่ไปค้างที่ C
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok);
  await until(() => r.S().current === 1, 1000, 'ถึงตา B');
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  await until(() => r.S().current === 0, 1000, 'วนกลับมาที่ A');

  // เหลือคนเชื่อมต่อคนเดียว: เริ่มใหม่ไม่ได้
  b.close();
  await until(() => member(last(a), 1).connected === false, 2000, 'B หลุด');
  assert.equal((await emit(a, 'restart_game')).ok, false);
});

// ═══════════════ B: ช่วงเลือกการ์ด ═══════════════

async function toGroupPick(r) { // 2 คน, cardInterval=1 → เดินคนละตาแล้วเข้า group pick
  const [a, b] = r.players;
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok);
  await until(() => r.S().current === 1, 1000, 'ถึงตา B');
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  await until(() => r.srv.groupPick, 1500, 'group pick เริ่ม');
}

test('B1 ระหว่างเลือกการ์ด: place / use_card / place_timeout ถูกปฏิเสธ และ group_pick_skip มีผลจริง', async () => {
  const r = await started(['A', 'B'], { cardInterval: 1 });
  const [a, b] = r.players;
  await toGroupPick(r);
  assert.equal(r.srv.phase, 'group_pick', 'room.phase ต้องเป็น group_pick ระหว่างเลือกการ์ด');
  await until(() => last(a).phase === 'group_pick', 1000, 'client เห็น phase group_pick');

  r.S().hands[0].push(card('c10')); // Cycle — ไม่ต้องมีเป้า
  const cur = r.S().current, turn = r.S().turnCount;
  const u = await emit(a, 'use_card', { cardId: 'c10', targets: {} });
  assert.equal(u.ok, false, 'use_card ต้องถูกปฏิเสธระหว่างเลือกการ์ด');
  assert.ok(r.S().hands[0].some(c => c.id === 'c10'), 'การ์ดต้องยังอยู่ในมือ');
  assert.equal((await emit(a, 'place', { r: 1, c: 1 })).ok, false, 'place ต้องถูกปฏิเสธ');
  await emit(a, 'place_timeout', {}).catch(() => {});
  await sleep(80);
  assert.equal(r.S().current, cur, 'place_timeout ต้องไม่ข้ามตา');
  assert.equal(r.S().turnCount, turn);
  assert.equal(r.S().phase, 'group_pick');
  assert.ok(r.srv.groupPick, 'การเลือกการ์ดต้องยังดำเนินอยู่');

  let prog = null; b.on('group_pick_progress', p => { prog = p; });
  await emit(a, 'group_pick_skip', {});
  await until(() => prog && prog.done === 1 && prog.total === 2, 1000, 'group_pick_progress หลัง skip');
  await emit(b, 'group_pick_skip', {});
  await until(() => r.srv.phase === 'playing' && !r.srv.groupPick, 1000, 'จบการเลือกการ์ดเมื่อทุกคน skip');
  await until(() => last(a).phase === 'playing' && last(a).state.phase === 'playing', 1000, 'client กลับมา playing');
});

test('B2 เทิร์นที่ระเบิดแล้วทริกเกอร์ group pick ยังได้ explosionWaves (และไม่ถูกส่งซ้ำ)', async () => {
  const r = await started(['A', 'B'], { cardInterval: 1 });
  const [a, b] = r.players;
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok);
  await until(() => r.S().current === 1, 1000, 'ถึงตา B');
  r.S().cells[3][3] = { count: 3, owner: 1, cap: 4 }; // B วางอีก 1 ลูก = ระเบิด
  const n0 = a.updates.length;
  assert.ok((await emit(b, 'place', { r: 3, c: 3 })).ok);
  const upd = await until(() => a.updates.slice(n0).find(u => u.state && u.state.phase === 'group_pick'), 1500, 'room_update ของเทิร์นที่ทริกเกอร์ group pick');
  assert.ok(Array.isArray(upd.state.explosionWaves) && upd.state.explosionWaves.length >= 1, 'ต้องมี explosionWaves ให้ client เล่นแอนิเมชัน');
  assert.deepEqual(upd.state.explosionWaves[0].explosions.map(e => [e.r, e.c, e.owner]), [[3, 3, 1]]);
  // update ถัดไป (จบการเลือกการ์ด) ต้องไม่ส่ง wave เดิมซ้ำ
  const n1 = a.updates.length;
  await emit(a, 'group_pick_skip', {}); await emit(b, 'group_pick_skip', {});
  const next = await until(() => a.updates.slice(n1).find(u => u.phase === 'playing'), 1500, 'update หลังเลือกการ์ด');
  assert.equal(next.state.explosionWaves, null, 'wave เดิมต้องไม่ถูกเล่นซ้ำ');
});

// ═══════════════ C: ข้อมูลเข้าและความปลอดภัย ═══════════════

test('C1 update_cfg: ค่าเกินช่วงและคีย์ที่ไม่อนุญาตถูกปฏิเสธ', async () => {
  const r = await room(['A', 'B']);
  const [a, b] = r.players;
  const before = JSON.parse(JSON.stringify(r.srv.cfg));
  a.emit('update_cfg', { cfg: { mapSize: 3000, mapCols: 3000, cardInterval: -5, players: 99, bots: [0, 1], evil: true, disabledCards: ['no-such-card', 'c1', 7] } });
  a.emit('update_cfg', { cfg: { mapSize: 6.5, mapCols: '7', cardInterval: 11, disabledCards: 'c1' } });
  a.emit('update_cfg', { cfg: null });
  a.emit('update_cfg');
  await sleep(200);
  assert.deepEqual(JSON.parse(JSON.stringify(r.srv.cfg)), before, 'cfg ต้องไม่เปลี่ยน');

  a.emit('update_cfg', { cfg: { mapSize: 6, mapCols: 13, cardInterval: 3, disabledCards: ['c1', 'c2'] } });
  await until(() => r.srv.cfg.mapSize === 6, 1000, 'ค่าที่ถูกต้องต้องถูกใช้');
  assert.equal(r.srv.cfg.mapCols, 13); assert.equal(r.srv.cfg.cardInterval, 3);
  assert.deepEqual(r.srv.cfg.disabledCards, ['c1', 'c2']);

  b.emit('update_cfg', { cfg: { mapSize: 9, mapCols: 9 } }); // ไม่ใช่ host
  await sleep(120);
  assert.equal(r.srv.cfg.mapSize, 6);

  // create_room ก็ต้องตรวจเหมือนกัน
  const h = await client();
  const c = await emit(h, 'create_room', { name: 'X', cfg: { mapSize: 3000, mapCols: 3000, cardInterval: 999, players: 50 } });
  assert.equal(c.ok, true);
  const cfg = srv.rooms.get(c.code).cfg;
  assert.ok(cfg.mapSize <= 16 && cfg.mapCols <= 18 && cfg.cardInterval <= 10, JSON.stringify(cfg));
});

test('C1 rate limit: ยิง event ถี่ๆ ถูกตัด และ server ยังตอบปกติ', async () => {
  const r = await started(['A', 'B']);
  const [, b] = r.players; // B ไม่ใช่ตา → ทุกคำขอถูกปฏิเสธอยู่แล้ว แต่ส่วนที่เกินโควตาต้องถูกตัดด้วยเหตุผล rate limit
  const rs = await Promise.all(Array.from({ length: 80 }, () => emit(b, 'place', { r: 0, c: 0 }, 3000)));
  const limited = rs.filter(x => x && x.ok === false && x.limited).length;
  assert.ok(limited > 0, 'ต้องมีคำขอที่ถูกตัดเพราะถี่เกินไป');
  assert.ok(limited < 80, 'คำขอช่วงแรกต้องผ่านตามปกติ');
});

test('C2 ชื่อผู้เล่น: server ตัดอักขระควบคุม/จำกัด 20 ตัว และ client ไม่ใส่ชื่อลง innerHTML ดิบๆ', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const host = await client();
  const c = await emit(host, 'create_room', { name: '  \u0000Al\u0007ice\n ', cfg: {} });
  assert.equal(c.ok, true);
  const g = await client(); assert.ok((await emit(g, 'join_room', { code: c.code, name: evil + 'x'.repeat(60) })).ok);
  const e = await client(); assert.ok((await emit(e, 'join_room', { code: c.code, name: '   ' })).ok);
  const n = await client(); assert.ok((await emit(n, 'join_room', { code: c.code, name: { toString() { return 'obj'; } } })).ok);
  const upd = await until(() => last(host) && last(host).members.length === 4 && last(host), 1500, 'ครบ 4 คน');
  const names = upd.members.map(m => m.name);
  assert.equal(names[0], 'Alice', 'ตัดอักขระควบคุม + trim');
  assert.ok(Array.from(names[1]).length <= 20, `ยาวเกิน 20: ${names[1].length}`);
  names.forEach(nm => { assert.equal(typeof nm, 'string'); assert.ok(nm.trim().length > 0, 'ชื่อห้ามว่าง'); assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(nm)); });
  assert.ok(names[1].startsWith('<img'), 'server ไม่ต้อง escape — เป็นหน้าที่ของ client ตอนแสดงผล');

  // client จริง (client/online.js) + DOM ปลอมที่จดทุกค่าที่ถูกเขียนลง innerHTML
  const dom = runOnlineClient();
  dom.socket.fire('room_update', upd);
  assert.ok(dom.text.some(t => t.includes('<img')), 'ชื่อต้องถูกแสดง (ผ่าน textContent)');
  const raw = dom.html.filter(h => /<img/i.test(h));
  assert.equal(raw.length, 0, 'ชื่อถูกใส่ลง innerHTML โดยไม่ escape: ' + (raw[0] || '').slice(0, 120));

  // จุดอื่นๆ ที่เอาชื่อผู้เล่นไปประกอบ innerHTML (สกอร์บอร์ด ฯลฯ) ต้องผ่าน esc() ทุกจุด
  for (const f of ['client/index.html', 'client/online.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (!line.includes('innerHTML')) return;
      for (const m of line.matchAll(/\$\{([^{}]*\b(?:getPlayerName\(|PLAYER_NAMES\[|m\.name\b|myName\b|winnerName\b|pName\b)[^{}]*)\}/g)) {
        assert.ok(/\besc\(/.test(m[1]), `${f}:${i + 1} ใส่ชื่อผู้เล่นลง innerHTML โดยไม่ผ่าน esc(): \${${m[1].slice(0, 80)}}`);
      }
    });
  }
});

test('C3 B ออกจาก lobby แล้ว C ยังรู้ slot ของตัวเองถูกต้อง', async () => {
  const r = await room(['A', 'B', 'C']);
  const [a, b, c] = r.players;
  assert.equal(c.slot, 2);
  b.emit('leave_room');
  const u = await until(() => { const x = last(c); return x && x.members.length === 2 && x; }, 1500, 'C เห็นว่า B ออก');
  assert.ok(u.you, 'room_update ต้องบอก slot ของผู้รับ (you)');
  assert.equal(u.you.slot, 1, 'C ต้องรู้ว่าตัวเองเลื่อนมาเป็น slot 1');
  assert.equal(u.members.find(m => m.name === 'C').slot, 1);
  assert.equal(last(a).you.slot, 0);
  assert.equal(last(a).you.isHost, true);
  assert.equal(u.you.isHost, false);
  // และเกมที่เริ่มหลังจากนั้นต้องส่งมือให้ถูกคน
  assert.ok((await emit(a, 'start_game')).ok);
  await until(() => c.hands.length > 0, 1500, 'C ได้ your_hand');
  assert.equal(c.hands[c.hands.length - 1].slot, 1);
});

test('C4 use_card เป้าหมายนอกกระดาน/ไม่ถูกรูปแบบ: state ไม่เปลี่ยนและตาไม่ค้าง', async () => {
  const r = await started(['A', 'B']);
  const [a] = r.players;
  r.S().cells[0][0] = { count: 2, owner: 0, cap: 4 };
  r.S().cells[0][1] = { count: 1, owner: 1, cap: 4 };
  r.S().hands[0].push(card('u2'), card('e4'), card('c8'));
  const snap = () => JSON.stringify([r.S().cells, r.S().hands, r.S().moved, r.S().current, r.S().turnCount, r.S().legendaryUsedBy, r.S().shielded]);
  const s0 = snap();

  const res = await emit(a, 'use_card', { cardId: 'u2', targets: { r: 0, c: 0, r2: 99, c2: 0 } });
  assert.equal(res.ok, false, 'r2 นอกกระดานต้องถูกปฏิเสธ');
  assert.equal(snap(), s0, 'state ต้องไม่เปลี่ยน (การ์ดยังอยู่ในมือ, ยังไม่ใช้ action)');

  for (const t of [{ r: 0, c: 0, r2: 1.5, c2: 0 }, { r: 0, c: 0, r2: '1', c2: 0 }, { r: -1, c: 0, r2: 0, c2: 1 }, { r: 0, c: 0 }, { r: 0, c: 0, r2: 0, c2: 0 }, null, 'x']) {
    const x = await emit(a, 'use_card', { cardId: 'u2', targets: t });
    assert.equal(x.ok, false, 'targets ' + JSON.stringify(t));
  }
  // Pillar ใช้ column ของช่องที่เลือก — ไม่มีเป้าต้องถูกปฏิเสธก่อนแตะ state (ของเดิม throw หลังกินการ์ดไปแล้ว)
  assert.equal((await emit(a, 'use_card', { cardId: 'e4', targets: {} })).ok, false);
  assert.equal(snap(), s0);

  // ถ้าการ์ด throw กลางทางจริงๆ ต้อง rollback ทั้ง state
  const shielded = r.S().shielded; r.S().shielded = null; // ทำให้ Shield (c8) พังหลังจากแก้ state ไปแล้ว
  const boom = await emit(a, 'use_card', { cardId: 'c8', targets: { r: 0, c: 0 } });
  assert.equal(boom.ok, false);
  assert.equal(r.S().shielded, null, 'rollback กลับไปเป็น state ก่อนใช้การ์ด');
  r.S().shielded = shielded;
  assert.equal(snap(), s0, 'การ์ดที่ throw ต้องไม่ทิ้ง state ครึ่งๆ กลางๆ');

  // ตายังเดินต่อได้
  const p = await emit(a, 'place', { r: 0, c: 0 });
  assert.equal(p.ok, true, p.msg);
  await until(() => r.S().current === 1, 1000, 'เปลี่ยนตาได้ตามปกติ');
});

test('C5 ผู้เล่นที่ยังมีชีวิตใช้ Rebirth (l5) ไม่ได้ — ตายแล้วจึงใช้ได้', async () => {
  const r = await started(['A', 'B']);
  const [a] = r.players;
  r.S().hands[0].push(card('l5'));
  const res = await emit(a, 'use_card', { cardId: 'l5', targets: { r: 2, c: 2 } });
  assert.equal(res.ok, false, 'ยังมีชีวิตอยู่ต้องใช้ไม่ได้');
  assert.ok(r.S().hands[0].some(c => c.id === 'l5'), 'การ์ดต้องยังอยู่ในมือ');
  assert.equal(r.S().legendaryUsedBy[0], 0);
  assert.equal(r.S().moved[0], false);
  assert.equal(r.S().cells[2][2].owner, -1);

  // ระดับ logic: ตายแล้วใช้ได้ และช่องที่ไม่ว่างถูกปฏิเสธก่อนกินการ์ด
  const st = logic.createInitialState({ players: 2, mapSize: 5, mapCols: 5 });
  st.alive = [1]; st.moved = [true, true]; st.hands[0] = [card('l5')]; st.cells[1][1] = { count: 2, owner: 1, cap: 4 };
  const blocked = logic.applyCard(st, 0, st.hands[0][0], { r: 1, c: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(st.hands[0].length, 1, 'ช่องไม่ว่าง: การ์ดต้องไม่ถูกกิน');
  assert.equal(st.legendaryUsedBy[0], 0);
  const ok = logic.applyCard(st, 0, st.hands[0][0], { r: 2, c: 2 });
  assert.equal(ok.ok, true);
  assert.deepEqual(st.alive, [0, 1]);
  assert.equal(st.cells[2][2].count, 3);
});

// ═══════════════ D: ปรับเล็กน้อย ═══════════════

test('D state ที่ส่งให้ client มีเฉพาะ field ที่ใช้จริง', async () => {
  const r = await started(['A', 'B']);
  const [a] = r.players;
  assert.ok((await emit(a, 'place', { r: 1, c: 1 })).ok); // ทำให้มี _snapshot ฝั่ง server
  const st = (await until(() => last(a).state.turnCount === 1 && last(a), 1000, 'update หลังเดิน')).state;
  for (const k of ['_snapshot', '_allWaves', '_lastExplosions', 'voidSnapshot', 'hands', '_pendingDelayFor', '_lastCardId', '_lastCardVfxData', 'playerTurns', 'catalyzed'])
    assert.equal(k in st, false, `ไม่ควรส่ง ${k}`);
  for (const k of ['rows', 'cols', 'players', 'current', 'alive', 'moved', 'turnCount', 'scores', 'cells', 'shielded', 'shieldOwner', 'timeBombs', 'frozen', 'eclipse', 'voidCells', 'severed', 'pinned', 'phase', 'winner', 'legendaryUsedBy', 'mythicalUsedBy', 'handsCount', 'explosionWaves', 'lastCardId', 'lastCardVfxData'])
    assert.equal(k in st, true, `ต้องมี ${k}`);
});

test('D ผู้ตายที่ถือ Rebirth แต่ไม่ใช้จนหมดเวลา ถูกตัดสิทธิ์ แล้วเกมจบได้', async () => {
  const r = await started(['A', 'B']);
  const [a, b] = r.players;
  let over = null; a.on('game_over', g => { over = g; });
  // A ระเบิดกินช่องสุดท้ายของ B → B ตาย แต่ถือ Rebirth อยู่ → เกมยังไม่จบ และ B ได้ตา
  const st = r.S();
  st.cells[2][2] = { count: 3, owner: 0, cap: 4 };
  st.cells[2][3] = { count: 1, owner: 1, cap: 4 };
  st.moved[1] = true; st.hands[1] = [card('l5')];
  assert.ok((await emit(a, 'place', { r: 2, c: 2 })).ok);
  await until(() => r.S().current === 1 && !r.S().alive.includes(1), 1000, 'B ตายแต่ได้ตาเพราะมี Rebirth');
  assert.equal(over, null, 'เกมยังไม่จบเพราะ B ยังคืนชีพได้');
  // คนตายวางบอลปกติไม่ได้ ต้องใช้ Rebirth เท่านั้น
  assert.equal((await emit(b, 'place', { r: 0, c: 0 })).ok, false);
  // B ไม่ทำอะไรจนหมดเวลา → เสียสิทธิ์ → A ชนะ
  await until(() => over, TURN + 2500, 'game_over หลัง B หมดเวลา');
  assert.equal(over.winner, 0);
  assert.equal(over.winnerName, 'A', 'ชื่อผู้ชนะต้องเป็นชื่อจริงของผู้เล่น');
  assert.equal(r.srv.phase, 'finished');
});

test('D ห้องที่ไม่มีคนเชื่อมต่อถูกลบเมื่อครบกำหนด (ไม่ใช่ทันที — ต้องเหลือเวลาให้ rejoin)', async () => {
  const r = await started(['A', 'B']);
  const [a, b] = r.players;
  a.close(); b.close();
  await sleep(120);
  assert.ok(srv.rooms.has(r.code), 'ทุกคนหลุดพร้อมกันชั่วครู่: ห้องต้องยังอยู่ให้กลับเข้าได้');
  await until(() => !srv.rooms.has(r.code), 2000, 'ห้องว่างถูกลบเมื่อครบกำหนด');
});

test('D ห้อง lobby ที่ไม่มีความเคลื่อนไหวถูกลบ และสมาชิกได้รับแจ้ง', async () => {
  const r = await room(['A']);
  const [a] = r.players;
  let closed = null; a.on('room_closed', x => { closed = x || true; });
  await until(() => !srv.rooms.has(r.code), 4000, 'lobby ที่นิ่งเกินกำหนดถูกลบ');
  await until(() => closed, 500, 'แจ้ง room_closed');
});

// ═══════════════ client จริงใน DOM ปลอม (ใช้กับ C2) ═══════════════
// โหลด client/online.js ใน vm พร้อม document ปลอมที่บันทึกทุกค่าที่ถูกเขียนลง innerHTML / textContent
function runOnlineClient() {
  const html = [], text = [];
  const mkEl = (tag = 'div') => {
    const listeners = {};
    const el = {
      tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], listeners, value: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener() {},
      appendChild(c) { el.children.push(c); return c; }, append(...cs) { el.children.push(...cs); }, prepend(...cs) { el.children.unshift(...cs); },
      replaceChildren(...cs) { el.children = cs; }, remove() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      querySelector() { return mkEl(); }, querySelectorAll() { return []; }, closest() { return null; },
      focus() {}, click() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }, animate() { return { cancel() {} }; },
    };
    let h = '', t = '';
    Object.defineProperty(el, 'innerHTML', { get: () => h, set: v => { h = String(v); html.push(h); } });
    Object.defineProperty(el, 'textContent', { get: () => t, set: v => { t = String(v); text.push(t); } });
    Object.defineProperty(el, 'innerText', { get: () => t, set: v => { t = String(v); text.push(t); } });
    return el;
  };
  const byId = new Map();
  const document = {
    getElementById(id) { if (!byId.has(id)) byId.set(id, mkEl()); return byId.get(id); },
    createElement: mkEl, createTextNode(s) { text.push(String(s)); return { nodeValue: String(s) }; },
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    head: mkEl('head'), body: mkEl('body'), addEventListener() {}, hidden: false,
  };
  const handlers = {};
  const socket = {
    connected: true, id: 'fake', io: { on() {} },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return socket; },
    once(ev, fn) { return socket.on(ev, fn); }, off() {}, emit() {}, connect() {}, disconnect() {},
    fire(ev, data) { (handlers[ev] || []).forEach(fn => fn(data)); },
  };
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined });
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const ctx = {
    document, navigator: {}, console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    sessionStorage: store(), localStorage: store(), location: { search: '', hash: '' },
    io: () => socket, SFX: noop, FX: noop, STATE: {}, cfg: {}, CARD_DEFS: logic.CARD_DEFS,
    showScreen() {}, showToast(m) { text.push(String(m)); }, renderGrid() {}, renderHandBar() {}, renderScoreboard() {}, updateTurnLabel() {},
    esc: s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'client', 'online.js'), 'utf8'), ctx, { filename: 'client/online.js' });
  // กดปุ่ม "ออนไลน์" เพื่อให้ client สร้าง socket และผูก handler
  (document.getElementById('btn-online').listeners.click || []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {} }));
  assert.ok(handlers.room_update, 'client ต้องผูก handler room_update');
  return { html, text, socket, document };
}
