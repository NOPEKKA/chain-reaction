'use strict';
// ชุดทดสอบโหมด Firebase (ไม่มีเซิร์ฟเวอร์) — รัน: npm test
// ใช้ client/fb-transport.js ของจริง + server/game-server.js ของจริง ต่อกันผ่าน Realtime Database จำลองในหน่วยความจำ
// (Rules ของ Firebase และ SDK จริงทดสอบในโปรเซสนี้ไม่ได้ — ดู README หัวข้อ "ทดสอบกับ Firebase จริง")

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeIo } = require('../client/fb-transport.js');
const { MemDB, memoryAdapter } = require('./support/memdb.js');
const { attach } = require('../server/game-server.js');
const logic = require('../shared/gameLogic');

const ENV = { TURN_MS: '1200', DISCONNECT_GRACE_MS: '300', SKIP_DELAY_MS: '40', LOBBY_GRACE_MS: '250', PICK_MS: '2000',
  ROOM_SWEEP_MS: '60', ROOM_TTL_EMPTY_MS: '5000', ROOM_TTL_LOBBY_MS: '60000' };
// limits: ค่าป้องกันของโฮสต์ (ดู HOST_LIMITS ใน fb-transport.js) — ย่อเวลาให้เทสต์เร็ว
const deps = { loadAttach: async () => attach, env: ENV, quiet: true, hostGoneMs: 350, ackMs: 500, limits: { joinGraceMs: 300, heartbeatMs: 60000 } };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 2000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = fn(); if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`หมดเวลารอ: ${what} (${ms}ms)`);
    await sleep(15);
  }
}
const opened = [];
test.after(() => { opened.forEach(s => { try { s.disconnect(); } catch (e) {} }); setTimeout(() => process.exit(), 50).unref(); });

// ผู้เล่นหนึ่งคน = adapter (uid) + socket จำลอง — เก็บ event ไว้ให้ตรวจ
function player(db, uid, extra) {
  const a = memoryAdapter(db, uid);
  const s = makeIo(Promise.resolve(a), extra ? { ...deps, ...extra, limits: { ...deps.limits, ...(extra.limits || {}) } } : deps)({});
  opened.push(s);
  s.a = a; s.updates = []; s.events = [];
  s.on('room_update', r => s.updates.push(r));
  for (const ev of ['disconnect', 'connect', 'room_closed', 'turn_skipped', 'place_vfx', 'your_hand', 'game_over']) s.on(ev, d => s.events.push([ev, d]));
  return new Promise(res => s.once('connect', () => res(s)));
}
function emit(s, ev, data, ms = 1500) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`ไม่มีคำตอบสำหรับ "${ev}" ใน ${ms}ms`)), ms);
    const cb = r => { clearTimeout(t); res(r); };
    if (data === undefined) s.emit(ev, cb); else s.emit(ev, data, cb);
  });
}
const last = s => s.updates[s.updates.length - 1];
const seen = (s, ev) => s.events.filter(e => e[0] === ev);

async function room(db, names = ['A', 'B'], cfg = {}) {
  const host = await player(db, 'uidhost' + Math.random().toString(36).slice(2, 8));
  const c = await emit(host, 'create_room', { name: names[0], cfg: { mapSize: 5, mapCols: 5, cardInterval: 0, ...cfg } });
  assert.equal(c.ok, true, c.msg);
  host.token = c.token;
  const players = [host];
  for (const n of names.slice(1)) {
    const g = await player(db, 'uidguest' + Math.random().toString(36).slice(2, 8));
    const j = await emit(g, 'join_room', { code: c.code, name: n });
    assert.equal(j.ok, true, j.msg);
    g.token = j.token; g.slot = j.slot;
    players.push(g);
  }
  await until(() => players.every(p => last(p) && last(p).members.length === names.length), 2000, 'ทุกคนเห็นสมาชิกครบ');
  return { code: c.code, players, host, rt: () => host.a._rt };
}

test('F1 สร้างห้อง → เข้าห้อง → เริ่มเกม → วางบอล: ข้อมูลไปถึงทุกคนผ่าน Firebase', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  assert.match(r.code, /^\d{4}$/);
  assert.equal(db.get(`cr/hosts/${r.code}/host`), a.a.uid, 'โฮสต์จองรหัสไว้ใน Firebase');
  assert.equal(last(a).you.slot, 0); assert.equal(last(a).you.isHost, true);
  assert.equal(last(b).you.slot, 1); assert.equal(last(b).you.isHost, false);
  assert.deepEqual(last(b).members.map(m => m.name), ['A', 'B']);

  assert.equal((await emit(b, 'start_game')).ok, false, 'แขกเริ่มเกมไม่ได้');
  assert.equal((await emit(a, 'update_cfg', { cfg: { cardInterval: 0, mapSize: 6, mapCols: 6 } })).ok, true);
  await until(() => last(b).cfg.mapSize === 6, 1500, 'แขกเห็นค่าตั้งห้องใหม่');
  assert.equal((await emit(a, 'start_game')).ok, true);
  await until(() => r.players.every(p => last(p).state), 2000, 'เกมเริ่ม');
  await until(() => seen(b, 'your_hand').length > 0, 1500, 'แขกได้มือการ์ดของตัวเอง');
  assert.equal(last(a).state.rows, 6);

  assert.equal((await emit(b, 'place', { r: 3, c: 3 })).ok, false, 'ยังไม่ใช่ตาแขก');
  assert.equal((await emit(a, 'place', { r: 0, c: 0 })).ok, true);
  await until(() => last(b).state.current === 1 && seen(b, 'place_vfx').length === 1, 1500, 'แขกเห็นการวางของโฮสต์');
  assert.equal(last(b).state.cells[0][0].owner, 0);
  assert.equal((await emit(b, 'place', { r: 5, c: 5 })).ok, true);
  await until(() => last(a).state.current === 0 && last(a).state.cells[5][5].owner === 1, 1500, 'โฮสต์เห็นการวางของแขก');
});

test('F2 รหัสห้องผิด / ข้อความขยะใน Firebase: ปฏิเสธเรียบร้อย ห้องยังเล่นต่อได้', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  const x = await player(db, 'uidstranger');
  assert.equal((await emit(x, 'join_room', { code: '0000', name: 'Z' })).ok, false);
  assert.equal((await emit(x, 'join_room', { code: '<img>', name: 'Z' })).ok, false);
  assert.equal((await emit(x, 'rejoin_room', { code: '4321', token: 'x' })).gone, true);

  // ใครเขียนอะไรลงกล่องจดหมายของห้องก็ได้ถ้าไม่มี Rules — โฮสต์ต้องไม่พังและไม่เชื่อ
  const inbox = `cr/rooms/${r.code}/in`;
  await memoryAdapter(db, 'evil').push(inbox, { from: 'no sid', d: '{' });
  await memoryAdapter(db, 'evil').push(inbox, { from: 'evil_00', d: '{}' });                 // sid ผิดรูปแบบ
  await memoryAdapter(db, 'evil').push(inbox, { from: 'evil_000000aa', d: '{bad json' });
  await memoryAdapter(db, 'evil').push(inbox, { from: 'evil_000000aa', d: JSON.stringify({ ev: 'disconnect', a: null }) });
  await memoryAdapter(db, 'evil').push(inbox, { from: 'evil_000000aa', d: JSON.stringify({ ev: 'place', a: { r: 1, c: 1 }, k: 'k1' }) }); // ยังไม่ได้เข้าห้อง
  await memoryAdapter(db, 'evil').push(inbox, { from: 'evil_000000aa', d: JSON.stringify({ ev: '__proto__', a: 1 }) });
  await memoryAdapter(db, 'evil').push(inbox, { from: a.id, d: JSON.stringify({ ev: 'start_game', k: 'k2' }) });                         // ปลอมเป็น sid ของโฮสต์เอง
  await sleep(900);
  assert.equal((await emit(a, 'start_game')).ok, true, 'โฮสต์ยังทำงานปกติ');
  assert.equal(last(a).members.length, 2, 'ไม่มีสมาชิกปลอมโผล่');
  assert.equal(db.get(`${inbox}`), null, 'โฮสต์เก็บกวาดกล่องจดหมายแล้ว');
  assert.equal((await r.rt()).io.sockets.sockets.size, 2, 'ไม่มี socket ปลอมค้างในโฮสต์');
});

test('F3 แขกรีเฟรชหน้า (conn ใหม่ + token เดิม) กลับเข้าที่นั่งเดิมได้', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  await emit(a, 'start_game');
  await until(() => last(b).state, 1500, 'เกมเริ่ม');
  // "รีเฟรช": ผูก onDisconnect ลบ presence ของหน้าเก่า (drop) แล้วเปิดหน้าใหม่ uid เดิม
  const uid = b.a.uid; b.a.drop();
  await until(() => last(a).members[1].connected === false, 1500, 'โฮสต์รู้ว่าแขกหลุด');
  const b2 = await player(db, uid);
  const res = await emit(b2, 'rejoin_room', { code: r.code, token: b.token, takeover: true });
  assert.equal(res.ok, true, res.msg); assert.equal(res.slot, 1); assert.equal(res.phase, 'playing');
  await until(() => last(a).members[1].connected === true, 1500, 'โฮสต์เห็นแขกกลับมา');
  await until(() => last(b2) && last(b2).state && last(b2).you.slot === 1, 1500, 'หน้าใหม่ได้ state');
  assert.equal(seen(b2, 'your_hand').length > 0, true, 'ได้มือการ์ดคืน');
  // token ผิด → ไม่ได้ที่นั่ง
  const b3 = await player(db, 'uidthief');
  assert.equal((await emit(b3, 'rejoin_room', { code: r.code, token: 'nope' })).ok, false);
});

test('F4 โฮสต์หายไปเลย: แขกถูกแจ้ง disconnect แล้ว room_closed (host_left)', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  a.a.drop(); // ปิดแท็บโฮสต์: onDisconnect ลบ hosts/{code}
  await until(() => seen(b, 'disconnect').length > 0, 1500, 'แขกรู้ว่าโฮสต์หลุด');
  assert.equal(b.connected, false);
  const rc = await until(() => seen(b, 'room_closed')[0], 2000, 'ห้องปิด');
  assert.equal(rc[1].reason, 'host_left');
});

test('F5 โฮสต์หลุดสั้นๆ แล้วกลับมา: ห้องและเกมยังอยู่ แขกต่อกลับได้เอง', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  await emit(a, 'start_game');
  await until(() => last(b).state, 1500, 'เกมเริ่ม');
  a.a.drop();
  await until(() => seen(b, 'disconnect').length > 0, 1500, 'แขกรู้ว่าโฮสต์หลุด');
  await sleep(100);
  a.a.restore();
  await until(() => seen(b, 'connect').length >= 2, 1500, 'แขกต่อกลับ');
  assert.equal(seen(b, 'room_closed').length, 0);
  assert.equal(db.get(`cr/hosts/${r.code}/host`), a.a.uid, 'โฮสต์ประกาศตัวใหม่');
  // client จริงจะ rejoin ด้วย token ทันทีที่ได้ connect (ที่นั่งและเกมยังอยู่ในหน้าของโฮสต์)
  const rj = await emit(b, 'rejoin_room', { code: r.code, token: b.token, takeover: true });
  assert.equal(rj.ok, true, rj.msg); assert.equal(rj.slot, 1); assert.equal(rj.phase, 'playing');
  // ต่อมาตัวเกมต้องยังเดินได้
  assert.equal((await emit(a, 'place', { r: 0, c: 0 })).ok, true);
  assert.equal((await emit(b, 'place', { r: 4, c: 4 })).ok, true);
});

test('F6 โฮสต์ที่ไม่ตอบ: คำสั่งที่ขอ callback ได้ข้อความ error แทนที่จะค้าง', async () => {
  const db = new MemDB();
  db.write('cr/hosts/7777', { host: 'ghost', t: Date.now() }); // มีรายการโฮสต์ค้างอยู่ แต่ไม่มีใครฟัง
  const x = await player(db, 'uidx');
  const j = await emit(x, 'join_room', { code: '7777', name: 'X' }, 2000);
  assert.equal(j.ok, false); assert.match(j.msg, /โฮสต์ไม่ตอบ/);
  const x2 = await player(db, 'uidx2');
  const rj = await emit(x2, 'rejoin_room', { code: '7777', token: 't' }, 2000);
  assert.equal(rj.ok, false); assert.equal(rj.gone, true, 'rejoin ที่ไม่มีคนตอบ = ที่นั่งหายไปแล้ว → client ล้าง session');
});

test('F7 รหัสห้องไม่ซ้ำ แม้โฮสต์หลายคนสร้างพร้อมกัน และไม่เอารหัสที่มีคนจองอยู่', async () => {
  const db = new MemDB();
  const hs = await Promise.all([player(db, 'h1'), player(db, 'h2'), player(db, 'h3')]);
  // จองรหัสไว้ก่อน 78%: เหลือ 8000–9999
  for (let c = 1000; c <= 7999; c++) db.write(`cr/hosts/${c}`, { host: 'other', t: Date.now() });
  const res = await Promise.all(hs.map(h => emit(h, 'create_room', { name: 'H' }, 4000)));
  const codes = res.map(r => { assert.equal(r.ok, true, r.msg); return r.code; });
  assert.equal(new Set(codes).size, 3, 'ไม่ซ้ำกัน');
  codes.forEach(c => assert.ok(Number(c) >= 8000, 'ไม่ทับรหัสที่ถูกจอง: ' + c));
});

test('F8 ออกจากห้องจนว่าง: รหัสถูกปล่อยและกวาดข้อมูลของห้องทิ้ง', async () => {
  const db = new MemDB();
  const h = await player(db, 'hh');
  const c = await emit(h, 'create_room', { name: 'Solo' });
  assert.equal(c.ok, true);
  assert.ok(db.get(`cr/hosts/${c.code}`));
  h.emit('leave_room');
  await until(() => db.get(`cr/hosts/${c.code}`) === null && db.get(`cr/rooms/${c.code}`) === null, 1500, 'เก็บกวาดข้อมูลห้อง');
  // สร้างห้องใหม่ต่อได้ในหน้าเดิม
  const c2 = await emit(h, 'create_room', { name: 'Solo' });
  assert.equal(c2.ok, true);
});

test('F9 นาฬิกาตาอยู่ที่โฮสต์: หมดเวลาแล้วข้ามตา และแขกได้เห็น turn_skipped', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  await emit(a, 'start_game');
  await until(() => last(b).state, 1500, 'เกมเริ่ม');
  assert.equal((await emit(a, 'place', { r: 0, c: 0 })).ok, true);
  assert.equal((await emit(b, 'place', { r: 4, c: 4 })).ok, true);
  await until(() => last(b).state.current === 0 && last(b).turnEndsIn > 0, 1500, 'ตาโฮสต์');
  // ลดบอลให้ไม่ระเบิด แล้วปล่อยให้หมดเวลา
  const skipped = await until(() => seen(b, 'turn_skipped')[0], 3000, 'โฮสต์ข้ามตาที่หมดเวลา');
  assert.equal(skipped[1].playerIdx, 0); assert.equal(skipped[1].reason, 'timeout');
  await until(() => last(b).state.current === 1, 1500, 'ตาเปลี่ยนไปที่แขก');
});

test('F10 ลูกโซ่ผ่าน Firebase ที่หน่วง: แขกได้ wave ครบ + กระดานก่อนระเบิด + ข้อมูลของตานั้นใน update ก้อนเดียว และลำดับข้อความไม่สลับ', async () => {
  const db = new MemDB({ delay: () => 5 + Math.random() * 45 });
  const r = await room(db);
  const [a, b] = r.players;
  assert.equal((await emit(a, 'start_game')).ok, true);
  await until(() => last(b).state, 2000, 'เกมเริ่ม');
  const order = [];
  for (const ev of ['place_vfx', 'room_update', 'game_over']) b.on(ev, () => order.push(ev));
  // แถว 0: โฮสต์ (0,0)=3 + แขก (0,1..4)=3 → โฮสต์วาง = ลูกโซ่ 5 wave กวาดแขกหมด → จบเกม
  const st = (await r.rt()).game.rooms.get(r.code).state;
  for (const row of st.cells) for (const c of row) { c.count = 0; c.owner = -1; }
  st.cells[0][0] = { count: 3, owner: 0, cap: 4 };
  for (let c = 1; c < 5; c++) st.cells[0][c] = { count: 3, owner: 1, cap: 4 };
  st.moved = [false, true]; st.current = 0; st.turnCount = 2;
  assert.equal((await emit(a, 'place', { r: 0, c: 0 })).ok, true);
  const upd = await until(() => b.updates.find(u => u.phase === 'finished'), 3000, 'แขกได้ update จบเกม');
  await until(() => seen(b, 'game_over').length === 1, 2000, 'แขกได้ game_over');
  assert.equal(upd.state.explosionWaves.length, 5, 'ลูกโซ่ครบทุก wave');
  assert.deepEqual(upd.state.explosionWaves[0].e, [0, 0, 0]);
  assert.equal(upd.state.fxBase.length, st.rows * st.cols * 2, 'มีกระดานก่อน wave แรก');
  assert.deepEqual(upd.state.fxBase.slice(0, 4), [4, 0, 3, 1], 'base = หลังวาง ก่อนระเบิด: (0,0) มี 4 ลูกของโฮสต์, (0,1) ยังเป็นของแขก');
  assert.deepEqual(upd.state.last, { place: { r: 0, c: 0, playerIdx: 0, isFirstPlace: false } });
  assert.equal(typeof upd.gameId, 'number');
  assert.equal(upd.state.winner, 0);
  assert.deepEqual(order, ['place_vfx', 'room_update', 'game_over'], 'ลำดับเดียวกับที่โฮสต์ส่ง');
  // ฝั่งโฮสต์ (ไม่ผ่าน Firebase) ต้องได้ข้อมูลเดียวกัน
  const mine = a.updates.find(u => u.phase === 'finished');
  assert.deepEqual(mine.state.explosionWaves, upd.state.explosionWaves);
  assert.deepEqual(mine.state.fxBase, upd.state.fxBase);
});

// ════════ ส่วน C: ความปลอดภัยของโหมด Firebase ════════
// ฐานข้อมูลจำลองไม่มี Rules (ยกเว้นกฎของ cr/hosts) — "ผู้โจมตี" จึงเขียนได้มากกว่าที่ Firebase จริงยอมด้วยซ้ำ: โฮสต์ต้องรอดด้วยตัวเอง

test('C1 รหัสห้อง: เวลาเป็นของ server, ต่ออายุสม่ำเสมอ, รายการเก่ากว่า 5 นาทีจองทับได้ แต่ของโฮสต์ที่ยังอยู่จองทับไม่ได้', async () => {
  const db = new MemDB();
  const want = ['1234', '5678', '2468'];
  const h = await player(db, 'hostA', { pickCode: i => want[i] || '9' + String(100 + i), limits: { heartbeatMs: 40 } });
  const c = await emit(h, 'create_room', { name: 'A' });
  assert.equal(c.code, '1234');
  const e1 = db.get('cr/hosts/1234');
  assert.deepEqual(Object.keys(e1).sort(), ['host', 't'], 'มีแค่ host กับ t');
  assert.ok(Math.abs(e1.t - db.now()) < 2000, 'เวลาเป็นของฐานข้อมูล');
  assert.equal(db.get('cr/hostOf/hostA'), '1234', 'ดัชนี หนึ่ง uid ↔ หนึ่งห้อง');
  await sleep(150);
  assert.ok(db.get('cr/hosts/1234').t > e1.t, 'heartbeat ต่ออายุ');

  // ข้ามเวลาไป 6 นาที: โฮสต์ที่ยังอยู่ต่ออายุทัน → คนอื่นจองทับรหัสเดิมไม่ได้
  db.skew += 6 * 60 * 1000;
  await sleep(150);
  const other = await player(db, 'hostB', { pickCode: i => want[i] });
  const c2 = await emit(other, 'create_room', { name: 'B' });
  assert.equal(c2.code, '5678', 'ข้ามรหัสที่มีโฮสต์ต่ออายุอยู่');
  assert.equal(db.get('cr/hosts/1234/host'), 'hostA');
  // เขียนทับตรงๆ (ข้าม client) ก็ไม่ผ่านกฎ
  await assert.rejects(memoryAdapter(db, 'evil').update({ 'cr/hosts/1234': { host: 'evil', t: { '.sv': 'timestamp' } }, 'cr/hostOf/evil': '1234' }), /PERMISSION_DENIED/);

  // รายการค้างที่ไม่มีใครต่ออายุ (โฮสต์ตายโดยไม่ทันลบ): เกิน 5 นาทีแล้วจองทับได้
  db.write('cr/hosts/2468', { host: 'ghost', t: db.now() - 6 * 60 * 1000 });
  db.write('cr/rooms/2468/in/zz', { from: 'ghost_00000000', d: '{}' });
  const third = await player(db, 'hostC', { pickCode: () => '2468' });
  const c3 = await emit(third, 'create_room', { name: 'C' });
  assert.equal(c3.ok, true, c3.msg); assert.equal(c3.code, '2468');
  assert.equal(db.get('cr/hosts/2468/host'), 'hostC');
  // รายการที่ยังสด จองทับไม่ได้
  db.write('cr/hosts/1357', { host: 'someone', t: db.now() });
  const fourth = await player(db, 'hostD', { pickCode: i => ['1357', '8642'][i] });
  assert.equal((await emit(fourth, 'create_room', { name: 'D' })).code, '8642');
});

test('C1 หนึ่ง uid ถือได้ห้องเดียว: เปิดห้องใหม่ → ห้องเก่าถูกปิดและเก็บกวาด (ทั้งในหน้าเดิม และจากแท็บใหม่ของ uid เดียวกัน)', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  // หน้าเดิม: โฮสต์ออกจากห้อง (แขกยังอยู่) แล้วสร้างห้องใหม่
  a.emit('leave_room');
  await until(() => last(b).members.length === 1, 1500, 'โฮสต์ออกจากห้อง');
  const c2 = await emit(a, 'create_room', { name: 'A2' });
  assert.equal(c2.ok, true, c2.msg); assert.notEqual(c2.code, r.code);
  await until(() => seen(b, 'room_closed').length === 1, 2000, 'แขกของห้องเก่าถูกแจ้งว่าห้องปิด');
  await until(() => db.get(`cr/hosts/${r.code}`) === null && db.get(`cr/rooms/${r.code}`) === null, 1500, 'ห้องเก่าถูกเก็บกวาด');
  assert.equal(db.get(`cr/hostOf/${a.a.uid}`), c2.code);
  assert.equal((await r.rt()).codes.size, 1);

  // แท็บใหม่ของ uid เดียวกัน (แท็บเดิมยังเปิดค้างอยู่): ห้องของแท็บเดิมถูกเก็บกวาด และแท็บเดิมรู้ตัวตอนต่ออายุ
  const tab2 = await player(db, a.a.uid, { limits: { heartbeatMs: 60000 } });
  const c3 = await emit(tab2, 'create_room', { name: 'A3' });
  assert.equal(c3.ok, true, c3.msg);
  assert.equal(db.get(`cr/hosts/${c2.code}`), null, 'รหัสของแท็บเดิมถูกปล่อย');
  assert.equal(db.get(`cr/hostOf/${a.a.uid}`), c3.code);
  await (await r.rt()).heartbeat();
  assert.equal((await r.rt()).codes.size, 0, 'แท็บเดิมปิดห้องของตัวเองเมื่อต่ออายุไม่ผ่าน');
  await until(() => seen(a, 'room_closed').length >= 1, 1500, 'ผู้เล่นในแท็บเดิมถูกแจ้ง');
});

test('C2 ถล่มคิวคำสั่ง: 500 sid ปลอม 2,000 ข้อความ — โฮสต์ไม่บวม ไม่ค้าง ผู้เล่นจริงยังเล่นต่อได้ทันเวลา', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  assert.equal((await emit(a, 'start_game')).ok, true);
  await until(() => last(b).state, 1500, 'เกมเริ่ม');
  const rt = await r.rt(), st = rt.codes.get(r.code), evil = memoryAdapter(db, 'evil');
  const inbox = `cr/rooms/${r.code}/in`;
  let maxSockets = 0, maxQueue = 0;
  const watch = setInterval(() => { maxSockets = Math.max(maxSockets, rt.io.sockets.sockets.size); maxQueue = Math.max(maxQueue, st.queue.length); }, 5);
  const flood = (async () => {
    for (let i = 0; i < 2000; i++) {
      const uid = i % 2 ? 'evil' : 'evil' + (i % 250);                       // uid เดียวหลายร้อย sid + อีก 125 uid
      const sid = uid + '_' + (i % 500).toString(16).padStart(8, '0');
      const ev = ['join_room', 'place', 'create_room', 'rejoin_room', 'use_card'][i % 5];
      evil.push(inbox, { from: sid, d: JSON.stringify({ ev, a: { code: r.code, name: 'x' + i, r: 1, c: 1, token: 'nope', cardId: 'c1' }, k: 'k' + i }) });
      if (i % 100 === 99) await sleep(2);
    }
  })();
  // ระหว่างที่ถูกถล่ม ผู้เล่นจริงเดินได้และได้คำตอบทันเวลา
  const t0 = Date.now();
  assert.equal((await emit(a, 'place', { r: 0, c: 0 }, 1500)).ok, true, 'โฮสต์เดินได้');
  assert.equal((await emit(b, 'place', { r: 4, c: 4 }, 2500)).ok, true, 'แขกเดินได้ระหว่างถูกถล่ม');
  const guestMs = Date.now() - t0;
  await flood; await sleep(900);
  clearInterval(watch);
  assert.ok(guestMs < 2500, `แขกได้คำตอบใน ${guestMs}ms`);
  assert.ok(maxSockets <= 2 + 12, `จำนวน socket ในโฮสต์สูงสุด ${maxSockets} (เพดาน 6 ที่นั่ง + เผื่อ = 12 ต่อห้อง)`);
  assert.ok(maxQueue <= 300, `คิวค้างสูงสุด ${maxQueue}`);
  assert.ok(st.uids.size <= 200, `จำสถิติ ${st.uids.size} uid`);
  assert.equal(rt.io.sockets.sockets.size, 2, 'socket ปลอมที่ไม่ได้เข้าห้องถูกตัดทิ้งหมด');
  assert.equal(rt.game.rooms.size, 1, 'ไม่มีห้องงอกในโฮสต์');
  assert.equal(last(a).members.length, 2, 'ไม่มีสมาชิกปลอม');
  assert.ok(st.uids.get('evil') && st.uids.get('evil').blockedUntil > Date.now(), 'uid ที่ยิงถี่ถูกบล็อกชั่วคราว');
  assert.equal(db.get(inbox), null, 'กล่องจดหมายถูกเก็บกวาด');
  // ยังเล่นต่อได้ตามปกติหลังจากนั้น (ตาของใครก็ได้ — นาฬิกาตาเดินอยู่ตลอด)
  const cur = (await rt.game.rooms.get(r.code)).state.current;
  assert.equal((await emit(r.players[cur], 'place', cur === 0 ? { r: 0, c: 0 } : { r: 4, c: 4 })).ok, true, 'เดินต่อได้หลังถูกถล่ม');
});

test('C2 แขกส่ง create_room / คำสั่งนอกรายการผ่านคิว: ไม่เกิดห้องในโฮสต์ (ของเดิม: ได้ห้องชื่อ "null")', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  const rt = await r.rt();
  const inbox = `cr/rooms/${r.code}/in`;
  const raw = (from, ev, data) => b.a.push(inbox, { from, d: JSON.stringify({ ev, a: data, k: 'x' + Math.random() }) });
  await raw(b.id, 'create_room', { name: 'pwn', cfg: { mapSize: 16 } });        // แขกตัวจริงที่อยู่ในห้อง
  await raw(b.a.uid + '_00000abc', 'create_room', { name: 'pwn' });            // sid ใหม่ที่ไม่เคยเข้าห้อง
  await raw(b.id, 'disconnect', null);                                          // event ภายในของ socket
  await sleep(250);
  assert.deepEqual([...rt.game.rooms.keys()], [r.code], 'มีแค่ห้องจริงห้องเดียว');
  assert.equal(rt.game.rooms.has('null'), false);
  assert.equal(last(a).members.length, 2); assert.equal(last(a).members[1].connected, true, 'แขกตัวจริงยังอยู่ในห้อง');
  // ตรรกะของเซิร์ฟเวอร์เองก็ไม่สร้างห้องเมื่อไม่มีรหัสที่จองไว้
  let res; rt.io.sockets.sockets.get(b.id)._dispatch('create_room', [{ name: 'direct' }, x => { res = x; }]);
  assert.equal(res.ok, false);
  assert.deepEqual([...rt.game.rooms.keys()], [r.code]);
  assert.equal(rt.game.rooms.get(r.code).members.length, 2, 'สร้างห้องไม่สำเร็จ ต้องไม่หลุดจากห้องเดิม');
  // ส่งคำสั่งนอกรายการซ้ำๆ = ไม่ใช่ client ของเกม → uid นั้นถูกบล็อกและตัดการเชื่อมต่อ
  for (let i = 0; i < 6; i++) await raw(b.id, 'room_update', { code: r.code });
  await until(() => last(a).members.length === 2 && last(a).members[1].connected === false, 1500, 'แขกที่ส่งคำสั่งนอกรายการรัวๆ ถูกตัด');
  assert.ok(rt.codes.get(r.code).uids.get(b.a.uid).blockedUntil > Date.now());
});

test('C3 โฮสต์แครช: รายการโฮสต์ + ข้อมูลห้อง + ดัชนี หายทั้งหมด · โฮสต์ใหม่จองรหัสเดิมได้และเริ่มจากห้องว่าง', async () => {
  const db = new MemDB();
  const r = await room(db);
  const [a, b] = r.players;
  await emit(a, 'start_game');
  await until(() => last(b).state, 1500, 'เกมเริ่ม');
  assert.ok(db.get(`cr/rooms/${r.code}/presence`), 'มี presence ของแขก');
  assert.equal(db.get(`cr/rooms/${r.code}/meta/host`), a.a.uid);
  a.a.drop();                                                   // แท็บโฮสต์ตาย: onDisconnect ทำงาน
  assert.equal(db.get(`cr/hosts/${r.code}`), null);
  assert.equal(db.get(`cr/rooms/${r.code}`), null, 'ข้อมูลห้องถูกลบพร้อมกัน (ของเดิมค้างและไม่มีใครลบได้อีก)');
  assert.equal(db.get(`cr/hostOf/${a.a.uid}`), null);

  // ของค้างที่อาจเหลือจากโฮสต์เก่า (เช่น onDisconnect ไม่ทันทำงาน) ต้องไม่ถูกโฮสต์ใหม่ประมวลผล
  db.write(`cr/rooms/${r.code}/in/old1`, { from: 'ghost_0000beef', d: JSON.stringify({ ev: 'join_room', a: { code: r.code, name: 'ผี' }, k: 'k' }) });
  db.write(`cr/rooms/${r.code}/presence/ghost_0000beef`, { t: 1 });
  db.write(`cr/rooms/${r.code}/out/ghost_0000beef/x`, { d: '[]' });
  const h2 = await player(db, 'newhost', { pickCode: () => r.code });
  const c = await emit(h2, 'create_room', { name: 'ใหม่' });
  assert.equal(c.ok, true, c.msg); assert.equal(c.code, r.code, 'จองรหัสเดิมได้');
  await sleep(200);
  assert.deepEqual(last(h2).members.map(m => m.name), ['ใหม่'], 'ห้องใหม่ว่าง ไม่มีสมาชิกจากของค้าง');
  assert.equal(db.get(`cr/rooms/${r.code}/in`), null);
  assert.equal(db.get(`cr/rooms/${r.code}/out`), null);
  assert.equal(db.get(`cr/rooms/${r.code}/meta/host`), 'newhost');
  // แขกของห้องเก่า: รหัสเดิมแต่คนละโฮสต์ = ห้องปิด (ไม่ใช่ "โฮสต์กลับมา") แล้วถอนตัวออกจากห้องของคนอื่น
  await until(() => seen(b, 'room_closed').length === 1, 2000, 'แขกเก่ารู้ว่าห้องปิด');
  assert.equal(seen(b, 'connect').length, 1, 'ไม่มี connect รอบสอง');
  await until(() => db.get(`cr/rooms/${r.code}/presence`) === null, 1500, 'ไม่มี presence ค้างในห้องใหม่');
  assert.equal((await h2.a._rt).io.sockets.sockets.size, 1);
});
