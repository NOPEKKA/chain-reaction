'use strict';
// e2e: จังหวะเอฟเฟกต์ของโหมดออนไลน์ — client จริงใน headless Chrome ต่อกับ server จริงในโปรเซสนี้
// รัน: npm run test:fx   (ไม่อยู่ใน npm test หลัก · ข้ามเองถ้าหา Chrome ไม่พบ หรือ Node ไม่มี WebSocket ในตัว)
// ตั้ง CHROME_PATH เองได้ถ้า Chrome ไม่ได้อยู่ที่ตำแหน่งมาตรฐาน
//
// วิธีวัด (ในหน้า): ครอบ FX.wave จดเวลา + จำนวนลูกรวมบนกระดานตอน wave เริ่ม, MutationObserver จดเวลาที่หน้าผู้ชนะ / หน้าเลือกการ์ดขึ้น
// ผู้เล่น A = หน้าเว็บ (host, slot 0) · ผู้เล่น B = socket.io-client (slot 1) · กระดานถูกยัดเข้า room.state ฝั่ง server แล้วบังคับ broadcast

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

function findChrome() {
  const ok = p => p && fs.existsSync(p);
  if (ok(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const list = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try { list.push(execSync('command -v ' + n, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) {}
    }
  }
  return list.find(ok) || null;
}
const CHROME = findChrome();
const SKIP = !CHROME ? 'ไม่พบ Chrome (ตั้ง CHROME_PATH ได้)' : typeof WebSocket === 'undefined' ? 'Node รุ่นนี้ไม่มี WebSocket ในตัว (ต้อง 22+)' : false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, what = 'condition', step = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn(); if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`หมดเวลารอ: ${what} (${ms}ms)`);
    await sleep(step);
  }
}

// ── server จริง (ปิด log ของ server: มันพิมพ์ทุก action) ──
let srv, ioc, logic, port, chrome, cdpPort, profile;
const socks = [], pages = [], metrics = {};

// ── CDP แบบพอใช้ ──
async function launchChrome() {
  cdpPort = 9400 + Math.floor(Math.random() * 500);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-fx-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--window-size=900,760', 'about:blank'], { stdio: 'ignore' });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch (e) { return false; } }, 15000, 'Chrome เปิด');
}
async function openPage(url, inject) {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 500));
    return r.result?.result?.value;
  };
  const P = { send, ev, logs, close: () => { try { send('Page.close'); } catch (e) {} setTimeout(() => { try { ws.close(); } catch (e) {} }, 100); } };
  pages.push(P);
  // โปรไฟล์ Chrome ใช้ร่วมกันทั้งชุด: ล้างที่นั่งค้าง (localStorage) ของเคสก่อนหน้า ไม่งั้นหน้าใหม่จะ rejoin เข้าห้องเก่าเอง
  await send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'local_storage,session_storage' });
  if (inject) await send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
  await send('Page.navigate', { url });
  await until(() => ev(`document.readyState === 'complete' && typeof FX === 'object' && typeof window._onlineCellClick === 'function'`).catch(() => false), 15000, 'หน้าเกมโหลด');
  return P;
}

// เครื่องมือวัดในหน้า — ไม่ขึ้นกับโครงสร้างภายในของ online.js
const INSTRUMENT = `(() => {
  const total = () => { let n = 0; for (const row of (STATE.cells || [])) for (const c of row) n += c.count; return n; };
  const M = window.__m = { waves: [], winnerAt: null, pickAt: null, hiddenWaves: 0,
    reset() { this.waves = []; this.winnerAt = null; this.pickAt = null; this.hiddenWaves = 0; }, total };
  const ow = FX.wave;
  FX.wave = function (list, d) { M.waves.push({ t: performance.now(), n: list.length, total: total() }); if (document.hidden) M.hiddenWaves++; return ow.apply(this, arguments); };
  const wo = document.getElementById('winner-overlay');
  new MutationObserver(() => { if (wo.classList.contains('show')) { if (M.winnerAt == null) M.winnerAt = performance.now(); } }).observe(wo, { attributes: true, attributeFilter: ['class'] });
  // หน้าเลือกการ์ดถูกสร้างตอนใช้ครั้งแรก → เฝ้าที่ body
  new MutationObserver(() => { const gp = document.getElementById('group-pick-overlay'); if (gp && gp.style.display === 'flex' && M.pickAt == null) M.pickAt = performance.now(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  // บันทึก event เข้า/ออกของ socket (ไว้อ่านตอนเทสต์ล้ม)
  M.net = [];
  try {
    const SP = io.Socket.prototype, oe = SP.emitEvent, om = SP.emit;
    SP.emitEvent = function (args) { const d = args[1] || {}; M.net.push([Math.round(performance.now()), '<' + args[0], d.phase || '', d.state ? d.state.turnCount + '/' + d.state.current + '/w' + ((d.state.explosionWaves || []).length) : '']); if (M.net.length > 40) M.net.shift(); return oe.apply(this, arguments); };
    SP.emit = function (ev) { if (typeof ev === 'string' && !/^(connect|disconnect)/.test(ev)) { M.net.push([Math.round(performance.now()), '>' + ev]); if (M.net.length > 40) M.net.shift(); } return om.apply(this, arguments); };
  } catch (e) {}
  window.__sig = () => (STATE.cells || []).map(r => r.map(c => c.count + ':' + (c.count ? c.owner : -1)).join(',')).join('/');
})()`;
const sigOf = state => state.cells.map(r => r.map(c => c.count + ':' + (c.count ? c.owner : -1)).join(',')).join('/');
const totalOf = state => state.cells.reduce((n, r) => n + r.reduce((m, c) => m + c.count, 0), 0);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const wavesIn = upd => (upd.state && upd.state.explosionWaves ? upd.state.explosionWaves.length : 0);

function emit(s, ev, data, ms = 3000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`server ไม่ตอบ "${ev}"`)), ms);
    const cb = r => { clearTimeout(t); res(r); };
    if (data === undefined) s.emit(ev, cb); else s.emit(ev, data, cb);
  });
}

// ห้องใหม่ + หน้าใหม่ทุกเคส: A = หน้าเว็บ (host), B = socket
async function game({ rows = 6, cols = 8, cardInterval = 0, players = 2 } = {}) {
  const P = await openPage(`http://localhost:${port}/`);
  await P.ev(INSTRUMENT);
  await P.ev(`document.getElementById('btn-online').click()`);
  await until(() => P.ev(`document.getElementById('online-screen').classList.contains('active')`), 5000, 'หน้าออนไลน์');
  await P.ev(`document.getElementById('online-name').value = 'Alice'`);
  // กดสร้างห้อง "ครั้งเดียว": ถ้า socket ยังต่อไม่ติด หน้าเกมจะลองกดซ้ำเองใน 1.5 วินาที (กดซ้ำจากเทสต์จะได้ create_room ซ้อนตามมาทีหลัง)
  await sleep(250);
  await P.ev(`document.getElementById('btn-create-room').click()`);
  const code = await until(async () => {
    const c = await P.ev(`document.getElementById('room-screen').classList.contains('active') ? document.getElementById('room-code-big').textContent.trim() : ''`);
    return /^\d{4}$/.test(c) ? c : null;
  }, 10000, 'สร้างห้อง', 100);
  const B = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  socks.push(B);
  B.updates = []; B.on('room_update', r => B.updates.push(r));
  B.skips = []; B.on('turn_skipped', x => B.skips.push(x));
  await new Promise((res, rej) => { B.once('connect', res); B.once('connect_error', rej); });
  const j = await emit(B, 'join_room', { code, name: 'Bob' });
  assert.equal(j.ok, true, j.msg); B.token = j.token;
  const room = () => srv.rooms.get(code);
  // ผู้เล่นคนที่ 3 ขึ้นไป (ถ้าขอ): socket เปล่าๆ ที่เทสต์สั่งเดินเอง
  const extra = [];
  for (let i = 2; i < players; i++) {
    const X = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    socks.push(X);
    await new Promise((res, rej) => { X.once('connect', res); X.once('connect_error', rej); });
    assert.equal((await emit(X, 'join_room', { code, name: 'P' + (i + 1) })).ok, true);
    extra.push(X);
  }
  Object.assign(room().cfg, { mapSize: rows, mapCols: cols, cardInterval });
  await until(() => room().members.length === players, 2000, 'ทุกคนเข้าห้อง');
  await P.ev(`document.getElementById('btn-start-online').click()`);
  await until(() => P.ev(`!!(window._getOnlineMode() && STATE.cells && STATE.size === ${rows} && STATE.cols === ${cols})`), 6000, 'เกมเริ่มในหน้า');
  const g = { P, B, extra, code, room, S: () => room().state };
  // ยัดกระดาน: fn(set) โดย set(r, c, count, owner)
  // moved[i] = "เดินไปแล้วในรอบล่าสุด": คนที่ถึงตา = false (ยังเดินได้) · คนอื่น = true (ไม่มีช่องเหลือ = ตกรอบ) เว้นแต่บอกเป็นอย่างอื่น
  g.board = async (fn, { current = 0, turnCount = 2, moved = Array.from({ length: players }, (_, i) => i !== current) } = {}) => {
    const s = g.S();
    for (const row of s.cells) for (const c of row) { c.count = 0; c.owner = -1; }
    fn((r, c, n, o) => { s.cells[r][c].count = n; s.cells[r][c].owner = o; });
    s.moved = moved.slice(); s.current = current; s.turnCount = turnCount; s.alive = Array.from({ length: players }, (_, i) => i); s.phase = 'playing';
    await g.sync();
  };
  // บังคับ broadcast (B rejoin ด้วย token) แล้วรอจนหน้าแสดงกระดานเดียวกับ server และเอฟเฟกต์นิ่ง
  g.sync = async () => {
    const r = await emit(B, 'rejoin_room', { code, token: B.token, takeover: true });
    assert.equal(r.ok, true, r.msg);
    await until(async () => (await P.ev(`__sig()`)) === sigOf(g.S()), 8000, 'หน้าซิงก์กระดานกับ server');
    await sleep(350);
  };
  g.hand = async (ids) => {
    const defs = ids.map(id => ({ ...logic.CARD_DEFS.find(d => d.id === id) }));
    g.S().hands[0] = defs;
    srv.io.to(room().members.find(m => m.slot === 0).socketId).emit('your_hand', { slot: 0, hand: defs });
    await until(() => P.ev(`(STATE.hands[0] || []).map(d => d.id).join(',') === ${JSON.stringify(ids.join(','))}`), 3000, 'หน้ารับมือการ์ด');
  };
  // ทำ action ในหน้าซ้ำจน server รับ (ช่วงที่เอฟเฟกต์ยังไม่นิ่ง หน้าจะไม่รับ input)
  g.act = async (js, what = 'server รับ action') => {
    const before = g.S().turnCount, phase = room().phase;
    await P.ev(`__m.reset()`);
    const mark = B.updates.length;
    try {
      await until(async () => { if (g.S().turnCount !== before || room().phase !== phase) return true; await P.ev(js); await sleep(120); return g.S().turnCount !== before || room().phase !== phase; }, 6000, what, 150);
    } catch (e) {
      const d = await P.ev(`JSON.stringify({ cur: STATE.current, me: window._getMySlot(), online: window._getOnlineMode(), moved: STATE.moved, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).slice(-3) })`).catch(x => String(x));
      throw new Error(e.message + ' · หน้า: ' + d + ' · server: ' + JSON.stringify({ cur: g.S().current, phase: room().phase, turn: g.S().turnCount }));
    }
    return mark;
  };
  g.place = (r, c) => g.act(`window._onlineCellClick(${r}, ${c})`);
  g.cardAt = (id, r, c) => g.act(`(() => { if (STATE.current !== 0) return; selectedHandCard = { playerIdx: 0, cardIdx: 0, cardId: '${id}' }; targetData = {}; window._onlineCellClick(${r}, ${c}); })()`);
  g.cardNow = () => g.act(`(() => { if (STATE.current !== 0 || !STATE.hands[0][0]) return; window._onlineActivateCard(0, 0, STATE.hands[0][0]); })()`);
  // รอจนหน้าแสดงกระดานเดียวกับ server, ไม่มี wave ใหม่ quietMs (และเงื่อนไขเสริมเป็นจริง) แล้วคืนค่าที่วัดได้
  g.settle = async ({ quietMs = 1300, need = 'true', ms = 25000 } = {}) => {
    const want = JSON.stringify(sigOf(g.S()));
    try {
      await until(() => P.ev(`(() => { const w = __m.waves, last = w.length ? w[w.length - 1].t : 0; return __sig() === ${want} && (performance.now() - last > ${quietMs}) && (${need}); })()`), ms, 'เอฟเฟกต์นิ่งและกระดานตรงกับ server', 100);
    } catch (e) {
      const d = await P.ev(`JSON.stringify({ sigOk: __sig() === ${want}, waves: __m.waves.length, winnerAt: __m.winnerAt, pickAt: __m.pickAt, fx: window._onlineFx ? window._onlineFx() : null, now: Math.round(performance.now()), net: __m.net.slice(-12) })`).catch(x => String(x));
      throw new Error(e.message + ' · หน้า: ' + d + ' · server: ' + JSON.stringify({ phase: room().phase, turn: g.S().turnCount, cur: g.S().current, alive: g.S().alive, updatesToB: B.updates.length, skips: B.skips, lasts: B.updates.slice(-3).map(u => u.state && u.state.last) }) + ' · console: ' + P.logs.slice(-3).join(' | '));
    }
    return P.ev(`({ waves: __m.waves, winnerAt: __m.winnerAt, pickAt: __m.pickAt, hiddenWaves: __m.hiddenWaves, sig: __sig(), fx: window._onlineFx ? window._onlineFx() : null })`);
  };
  g.sent = mark => B.updates.slice(mark).map(wavesIn).filter(n => n > 0);
  return g;
}
const gaps = waves => waves.slice(1).map((w, i) => w.t - waves[i].t);
const noErrors = g => assert.deepEqual(g.P.logs.filter(l => !/favicon|vibrate/.test(l)), [], 'ไม่มี error ใน console ของหน้า');

test.before(async () => {
  if (SKIP) return;
  const quiet = console.log; console.log = () => {};
  srv = require('../server/index.js'); console.log = quiet;
  ({ io: ioc } = require('socket.io-client'));
  logic = require('../shared/gameLogic');
  port = await srv.start(0);
  await launchChrome();
});
test.after(async () => {
  if (SKIP) return;
  console.log('\n[fx-timing] ค่าที่วัดได้:\n' + JSON.stringify(metrics, null, 1));
  socks.forEach(s => s.close());
  try { chrome.kill(); } catch (e) {}
  await srv.stop();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  setTimeout(() => process.exit(), 100).unref();
});

// แถว 0: A (0,0)=3 + B (0,1..7)=3 → A เติม/ระเบิด (0,0) = ลูกโซ่ 8 wave กวาด B หมดกระดาน → A ชนะ
const rowKill = set => { set(0, 0, 3, 0); for (let c = 1; c < 8; c++) set(0, c, 3, 1); };

test('1a ชนะด้วยการวางบอล: หน้าผู้ชนะขึ้นหลัง wave สุดท้ายเริ่มไปแล้วอย่างน้อยหนึ่งช่วง wave', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(rowKill);
  const mark = await g.place(0, 0);
  const m = await g.settle({ need: '__m.winnerAt != null' });
  const sent = g.sent(mark), gap = median(gaps(m.waves)), last = m.waves[m.waves.length - 1].t;
  metrics['1a ชนะด้วยการวาง'] = { wavesSent: sent, wavesPlayed: m.waves.length, msPerWave: Math.round(gap), winnerAfterLastWaveStart: Math.round(m.winnerAt - last), winnerAfterFirstWave: Math.round(m.winnerAt - m.waves[0].t) };
  assert.equal(g.room().phase, 'finished');
  assert.equal(m.waves.length, sent.reduce((a, b) => a + b, 0), 'เล่นครบทุก wave');
  assert.ok(m.winnerAt - last >= gap * 0.9, `หน้าผู้ชนะขึ้น ${Math.round(m.winnerAt - last)}ms หลัง wave สุดท้ายเริ่ม (ต้อง ≥ ${Math.round(gap * 0.9)})`);
  noErrors(g); g.P.close();
});

test('1b ชนะด้วยการ์ด (Instant Burst): หน้าผู้ชนะต้องไม่ขึ้นก่อนลูกโซ่จบ', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(rowKill);
  await g.hand(['u1']);
  const mark = await g.cardAt('u1', 0, 0);
  const m = await g.settle({ need: '__m.winnerAt != null' });
  const sent = g.sent(mark), gap = median(gaps(m.waves)), last = m.waves[m.waves.length - 1].t;
  metrics['1b ชนะด้วยการ์ด'] = { wavesSent: sent, wavesPlayed: m.waves.length, msPerWave: Math.round(gap), winnerAfterLastWaveStart: Math.round(m.winnerAt - last), winnerAfterFirstWave: Math.round(m.winnerAt - m.waves[0].t) };
  assert.equal(g.room().phase, 'finished');
  assert.equal(m.waves.length, sent.reduce((a, b) => a + b, 0), 'เล่นครบทุก wave');
  assert.ok(m.winnerAt - last >= gap * 0.9, `หน้าผู้ชนะขึ้น ${Math.round(m.winnerAt - last)}ms เทียบกับ wave สุดท้ายเริ่ม (ต้อง ≥ ${Math.round(gap * 0.9)})`);
  noErrors(g); g.P.close();
});

test('2 สองตาติดกัน: ลูกโซ่ของตาที่สองต้องถูกเล่นด้วย (จำนวน FX.wave = ผลรวม wave ที่ server ส่ง)', { skip: SKIP }, async () => {
  const g = await game();
  // แถว 0 เป็นของ A ทั้งแถว (8 wave) · แถว 5 ของ B ห้าช่อง (5 wave) — สองลูกโซ่ไม่แตะกัน เกมไม่จบ
  await g.board(set => { for (let c = 0; c < 8; c++) set(0, c, 3, 0); for (let c = 0; c < 5; c++) set(5, c, 3, 1); });
  let fired = false;
  g.B.on('room_update', r => { if (!fired && r.state && r.state.current === 1 && r.state.turnCount === 3) { fired = true; g.B.emit('place', { r: 5, c: 0 }); } }); // B เดินทันทีที่ได้ update
  const mark = await g.place(0, 0);
  await until(() => g.S().turnCount === 4, 5000, 'B เดินแล้ว');
  const m = await g.settle({ quietMs: 1600 });
  const sent = g.sent(mark), total = sent.reduce((a, b) => a + b, 0);
  metrics['2 สองตาติดกัน'] = { wavesSent: sent, wavesPlayed: m.waves.length, ms: Math.round(m.waves[m.waves.length - 1].t - m.waves[0].t) };
  assert.ok(sent.length === 2 && sent[0] >= 8 && sent[1] >= 5, 'server ส่งสองลูกโซ่: ' + JSON.stringify(sent));
  assert.equal(m.waves.length, total, `หน้าเล่น ${m.waves.length} wave จากที่ server ส่ง ${total}`);
  assert.equal(m.sig, sigOf(g.S()), 'กระดานสุดท้ายตรงกับ server');
  noErrors(g); g.P.close();
});

for (const [name, rows, cols] of [['3a ลูกโซ่ยาว 4×18', 4, 18], ['3b ลูกโซ่ยาว กระดานใหญ่สุด 16×18', 16, 18]]) {
  test(`${name}: เล่นครบทุก wave ไม่ตัดท้าย ไม่วาร์ป และไม่เกินเพดานเวลา`, { skip: SKIP }, async () => {
    const g = await game({ rows, cols });
    // เต็มกระดานด้วยช่อง 3 ลูกของ A · B ยังไม่ได้เดิน (ไม่ตกรอบ) → เกมไม่จบ วัดเฉพาะลูกโซ่
    await g.board(set => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) set(r, c, 3, 0); }, { moved: [false, false] });
    // จำนวน wave จริงตามกติกา (คำนวณด้วย shared logic บนสำเนา) — server ต้องส่งครบเท่านี้
    const sim = JSON.parse(JSON.stringify(g.S()));
    assert.equal(logic.applyPlace(sim, 0, 0, 0).ok, true);
    const real = logic.processExplosionsWithWaves(sim).length;
    const mark = await g.place(0, 0);
    const m = await g.settle({ quietMs: 1700, ms: 40000 });
    const sent = g.sent(mark), total = sent.reduce((a, b) => a + b, 0);
    const span = m.waves.length ? m.waves[m.waves.length - 1].t - m.waves[0].t : 0;
    const played = m.fx && m.fx.wavesPlayed != null ? m.fx.wavesPlayed : m.waves.length; // ถ้า client รวมหลาย wave เป็นขั้นภาพเดียว ใช้ตัวนับของมัน
    const bytes = Buffer.byteLength(JSON.stringify(g.B.updates.slice(mark).find(u => wavesIn(u) > 0)));
    metrics[name] = { wavesByRules: real, wavesSent: total, wavesPlayed: played, visualSteps: m.waves.length, chainMs: Math.round(span), payloadBytes: bytes, warpCells: m.fx ? m.fx.warpCells : 'n/a' };
    assert.ok(real >= 21, 'ลูกโซ่ยาวพอ: ' + real);
    assert.equal(total, real, `server ส่ง ${total} wave จากลูกโซ่จริง ${real} wave`);
    assert.equal(played, total, `หน้าเล่น ${played} wave จากที่ server ส่ง ${total}`);
    assert.ok(span <= 9000, `ลูกโซ่ใช้เวลา ${Math.round(span)}ms (เพดาน ~8 วินาที)`);
    assert.equal(m.sig, sigOf(g.S()), 'กระดานสุดท้ายตรงกับ server');
    if (m.fx) assert.equal(m.fx.warpCells, 0, 'กระดานหลัง wave สุดท้ายต้องเท่ากับผลลัพธ์ของ server (ไม่กระโดด)');
    noErrors(g); g.P.close();
  });
}

// การ์ดที่เปลี่ยนกระดานทั้งแผ่นก่อนระเบิด: ลูกโซ่ต้องเริ่มเล่นจากกระดาน "ก่อนระเบิด" ที่ server คำนวณ
const absorbBoard = set => { set(0, 0, 2, 0); set(0, 3, 3, 0); set(2, 2, 1, 0); set(5, 7, 2, 1); set(3, 7, 3, 1); set(5, 0, 1, 1); set(1, 5, 2, 0); };
for (const [id, name, target] of [['l2', 'Nuclear', null], ['m1', 'Singularity', [0, 0]]]) {
  test(`4 ${name} (${id}): จำนวนลูกตอน wave แรกเริ่ม = จำนวนก่อนระเบิดที่ server คำนวณ`, { skip: SKIP }, async () => {
    const g = await game();
    await g.board(absorbBoard);
    await g.hand([id]);
    const sim = JSON.parse(JSON.stringify(g.S()));
    const res = logic.applyCard(sim, 0, sim.hands[0][0], target ? { r: target[0], c: target[1] } : {});
    assert.equal(res.ok, true, res.msg);
    const pre = totalOf(sim);
    const mark = target ? await g.cardAt(id, target[0], target[1]) : await g.cardNow();
    const m = await g.settle({ quietMs: 1600, need: '__m.waves.length > 0' });
    const post = totalOf(g.S());
    metrics[`4 ${name}`] = { orbsBeforeExplosion: pre, orbsShownAtFirstWave: m.waves[0].total, orbsAfter: post, wavesSent: g.sent(mark), wavesPlayed: m.waves.length };
    assert.notEqual(pre, post, 'เคสต้องมีลูกหายตอนระเบิด ไม่งั้นวัดอะไรไม่ได้');
    assert.equal(m.waves[0].total, pre, `wave แรกเริ่มตอนกระดานแสดง ${m.waves[0].total} ลูก (ก่อนระเบิดจริงมี ${pre}, หลังระเบิด ${post})`);
    assert.equal(m.sig, sigOf(g.S()), 'กระดานสุดท้ายตรงกับ server');
    noErrors(g); g.P.close();
  });
}
test('4 Annihilate (l1): ลบบอลศัตรูทั้งหมด → หน้าผู้ชนะขึ้นหลัง VFX ของการ์ด และกระดานตรงกับ server', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(absorbBoard);
  await g.hand(['l1']);
  const t0 = await g.P.ev(`performance.now()`);
  await g.cardNow();
  const m = await g.settle({ need: '__m.winnerAt != null' });
  metrics['4 Annihilate'] = { winnerAfterAction: Math.round(m.winnerAt - t0), orbsAfter: totalOf(g.S()) };
  assert.equal(g.room().phase, 'finished');
  assert.ok(m.winnerAt - t0 >= 1200, `หน้าผู้ชนะขึ้น ${Math.round(m.winnerAt - t0)}ms หลังใช้การ์ด (VFX ของใบนี้ยาว ~1.4 วินาที)`);
  assert.equal(m.sig, sigOf(g.S()));
  noErrors(g); g.P.close();
});

test('5 แท็บถูกซ่อน: ไม่เล่นแอนิเมชันค้าง พอกลับมามองเห็น กระดานตรงกับ state ล่าสุดทันที', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(set => { for (let c = 0; c < 8; c++) set(0, c, 3, 0); for (let c = 0; c < 8; c++) set(5, c, 3, 1); set(2, 2, 1, 0); set(3, 5, 1, 1); });
  const hide = on => g.P.ev(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${on} });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${on ? 'hidden' : 'visible'}' }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  await g.P.ev(`__m.reset()`);
  await hide(true);
  // 4 update ติดกันระหว่างซ่อน: A (ลูกโซ่ 8) → B (ลูกโซ่ 8) → A → B · ฝั่ง A ยิงผ่าน socket ของหน้าเองไม่ได้ จึงเดินแทนที่ server
  const mark = g.B.updates.length;
  const step = async (slot, r, c) => {
    const before = g.S().turnCount;
    if (slot === 1) g.B.emit('place', { r, c });
    else await g.P.ev(`window._onlineCellClick(${r}, ${c})`);
    await until(async () => { if (g.S().turnCount !== before) return true; if (slot === 0) await g.P.ev(`window._onlineCellClick(${r}, ${c})`); return false; }, 12000, 'เดินระหว่างแท็บซ่อน', 200);
  };
  await step(0, 0, 0); await step(1, 5, 0); await step(0, 2, 2); await step(1, 3, 5);
  await sleep(200);
  const hidden = await g.P.ev(`({ waves: __m.hiddenWaves, sig: __sig() })`);
  await hide(false);
  await sleep(350);
  const shown = await g.P.ev(`({ sig: __sig(), fx: window._onlineFx ? window._onlineFx() : null, wavesAfter: __m.waves.length - __m.hiddenWaves })`);
  const sent = g.sent(mark);
  metrics['5 แท็บซ่อน'] = { updates: g.B.updates.length - mark, wavesSent: sent, wavesAnimatedWhileHidden: hidden.waves, boardMatchesWhileHidden: hidden.sig === sigOf(g.S()), boardMatches350msAfterVisible: shown.sig === sigOf(g.S()), queue: shown.fx };
  assert.equal(hidden.waves, 0, `ระหว่างซ่อนไม่ควรเล่นแอนิเมชัน wave (เล่นไป ${hidden.waves})`);
  assert.equal(shown.sig, sigOf(g.S()), 'กลับมามองเห็นแล้วกระดานต้องตรงกับ state ล่าสุด');
  if (shown.fx) { assert.equal(shown.fx.queued, 0, 'คิวว่าง'); assert.equal(shown.fx.running, false, 'ไม่มีงานค้าง'); }
  // เล่นต่อได้ตามปกติ และมีแอนิเมชันอีกครั้ง
  await g.board(set => { for (let c = 0; c < 4; c++) set(0, c, 3, 0); set(5, 5, 2, 1); });
  await g.place(0, 0);
  const m = await g.settle();
  assert.ok(m.waves.length >= 4, 'หลังกลับมา ลูกโซ่ถูกเล่นตามปกติ');
  noErrors(g); g.P.close();
});

test('6a หน้าเลือกการ์ดที่ตามหลังลูกโซ่ ขึ้นหลังลูกโซ่จบ', { skip: SKIP }, async () => {
  const g = await game({ cardInterval: 1 });
  g.S().cardInterval = 1;
  await g.board(set => { for (let c = 0; c < 8; c++) set(0, c, 3, 0); set(5, 5, 2, 1); }, { turnCount: 1 }); // หลังตานี้ turnCount = 2 → ถึงรอบเลือกการ์ด
  const mark = await g.place(0, 0);
  const m = await g.settle({ need: '__m.pickAt != null', ms: 20000 });
  const gap = median(gaps(m.waves)), last = m.waves[m.waves.length - 1].t;
  metrics['6a เลือกการ์ดหลังลูกโซ่'] = { wavesSent: g.sent(mark), wavesPlayed: m.waves.length, pickAfterLastWaveStart: Math.round(m.pickAt - last) };
  assert.equal(g.room().phase, 'group_pick');
  assert.ok(m.waves.length >= 8, 'ลูกโซ่ถูกเล่น');
  assert.ok(m.pickAt - last >= gap * 0.9, `หน้าเลือกการ์ดขึ้น ${Math.round(m.pickAt - last)}ms หลัง wave สุดท้ายเริ่ม`);
  noErrors(g); g.P.close();
});

test('6b รีเฟรชกลางเกม: กลับเข้ามาเห็นกระดานล่าสุด และเล่นต่อได้', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(set => { for (let c = 0; c < 4; c++) set(0, c, 3, 0); set(5, 5, 2, 1); set(4, 4, 1, 1); });
  await g.P.send('Page.reload');
  await until(() => g.P.ev(`typeof FX === 'object' && !!(window._getOnlineMode && window._getOnlineMode() && STATE.cells)`).catch(() => false), 12000, 'กลับเข้าเกมหลังรีเฟรช');
  await g.P.ev(INSTRUMENT);
  await until(async () => (await g.P.ev(`__sig()`)) === sigOf(g.S()), 5000, 'กระดานหลังรีเฟรช');
  const mark = await g.place(0, 0);
  const m = await g.settle();
  metrics['6b รีเฟรชกลางเกม'] = { wavesSent: g.sent(mark), wavesPlayed: m.waves.length };
  assert.equal(m.waves.length, g.sent(mark).reduce((a, b) => a + b, 0));
  assert.equal(m.sig, sigOf(g.S()));
  g.P.close();
});

test('6c จบเกมแล้วกด "เล่นใหม่": หน้าผู้ชนะหาย เกมใหม่เริ่ม และจบได้อีกรอบโดยหน้าผู้ชนะขึ้นครั้งเดียวต่อเกม', { skip: SKIP }, async () => {
  const g = await game();
  await g.board(rowKill);
  await g.place(0, 0);
  await g.settle({ need: '__m.winnerAt != null' });
  // game_over ซ้ำ (เช่นเครือข่ายส่งซ้ำ) ต้องไม่ทำให้หน้าผู้ชนะ/เสียงเล่นรอบสอง
  const shows = `(() => { window.__shows = 0; const wo = document.getElementById('winner-overlay'); let on = wo.classList.contains('show');
    new MutationObserver(() => { const s = wo.classList.contains('show'); if (s && !on) window.__shows++; on = s; }).observe(wo, { attributes: true, attributeFilter: ['class'] }); })()`;
  await g.P.ev(shows);
  srv.io.to(g.code).emit('game_over', { winner: 0, winnerName: 'Alice', scores: g.S().scores });
  await sleep(600);
  assert.equal(await g.P.ev(`window.__shows`), 0, 'game_over ซ้ำไม่เปิดหน้าผู้ชนะรอบสอง');
  await g.P.ev(`document.getElementById('winner-replay').click()`);
  await until(() => g.room().phase === 'playing', 4000, 'เกมใหม่เริ่มที่ server');
  await until(() => g.P.ev(`!document.getElementById('winner-overlay').classList.contains('show') && __sig() === ${JSON.stringify(sigOf(g.S()))}`), 5000, 'หน้าผู้ชนะหายและกระดานว่าง');
  await g.board(rowKill);
  await g.place(0, 0);
  const m = await g.settle({ need: '__m.winnerAt != null' });
  await sleep(500);
  metrics['6c เล่นใหม่'] = { winnerShownTimesInSecondGame: await g.P.ev(`window.__shows`), wavesPlayed: m.waves.length };
  assert.equal(await g.P.ev(`window.__shows`), 1, 'เกมที่สองจบ: หน้าผู้ชนะขึ้นครั้งเดียว');
  noErrors(g); g.P.close();
});

test('8 งานค้างสามชิ้น (ผู้เล่นอีกสองคนเดินทันที): เล่นครบทุก wave ตามลำดับ แต่เร่งความเร็ว', { skip: SKIP }, async () => {
  const g = await game({ players: 3 });
  // สามลูกโซ่ที่ไม่แตะกัน: A แถว 0 (8 wave) · B แถว 2 (6 wave) · C แถว 5 (6 wave)
  await g.board(set => { for (let c = 0; c < 8; c++) set(0, c, 3, 0); for (let c = 0; c < 6; c++) set(3, c, 3, 1); for (let c = 0; c < 6; c++) set(5, c, 3, 2); });
  let b = false, c = false;
  g.B.on('room_update', r => { if (!b && r.state && r.state.current === 1 && r.state.turnCount === 3) { b = true; g.B.emit('place', { r: 3, c: 0 }); } });
  g.extra[0].on('room_update', r => { if (!c && r.state && r.state.current === 2 && r.state.turnCount === 4) { c = true; g.extra[0].emit('place', { r: 5, c: 0 }); } });
  const mark = await g.place(0, 0);
  await until(() => g.S().turnCount === 5, 5000, 'B และ C เดินแล้ว');
  const m = await g.settle({ quietMs: 1600 });
  const sent = g.sent(mark), total = sent.reduce((x, y) => x + y, 0);
  const span = m.waves[m.waves.length - 1].t - m.waves[0].t, stepGaps = gaps(m.waves);
  metrics['8 งานค้างสามชิ้น'] = { wavesSent: sent, wavesPlayed: m.waves.length, chainsMs: Math.round(span), normalSpeedWouldBeMs: total * 520, fastestStepMs: Math.round(Math.min(...stepGaps)), warpCells: m.fx ? m.fx.warpCells : 'n/a' };
  assert.equal(sent.length, 3, 'server ส่งสามลูกโซ่: ' + JSON.stringify(sent));
  assert.equal(m.waves.length, total, `หน้าเล่น ${m.waves.length} wave จากที่ server ส่ง ${total}`);
  assert.ok(span < total * 520 * 0.8, `เร่งความเร็วเมื่องานค้าง: ใช้ ${Math.round(span)}ms (ความเร็วปกติ ${total * 520}ms)`);
  assert.equal(m.sig, sigOf(g.S()), 'กระดานสุดท้ายตรงกับ server');
  if (m.fx) assert.equal(m.fx.warpCells, 0);
  noErrors(g); g.P.close();
});

// ── โหมด Firebase (ไม่มี server): โฮสต์รัน game-server ในหน้าเว็บ ข้อมูลวิ่งผ่านฐานข้อมูลจำลองที่หน่วง 60–200ms ──
// วัดทั้งสองฝั่ง — แขกได้ทุกอย่างผ่าน Firebase: ลูกโซ่ต้องครบ และหน้าผู้ชนะต้องขึ้นหลังลูกโซ่จบ เหมือนโหมด socket.io
// ลายเซ็นของกระดานที่ "วาดอยู่จริง" (นับลูกบอลใน DOM) — รูปแบบเดียวกับ sigOf
const DOM_SIG = `window.__dom = () => STATE.cells.map((row, r) => row.map((ce, c) => { const el = FX.cell(r, c), n = el ? el.querySelectorAll('.orb').length : 0; return n + ':' + (n ? PLAYER_COLORS.indexOf(el._pc) : -1); }).join(',')).join('/');`;

test('9 Rewind ออนไลน์: กระดานย้อนกลับทีละจังหวะจากสภาพก่อนย้อน และจบตรงกับ server', { skip: SKIP }, async () => {
  const g = await game();
  // ตาของ B: ช่อง 3 ลูกของ B ที่ (2,2) ติดช่องของ A สี่ด้าน → B เติมให้ระเบิด ยึดช่องของ A (action ที่ A จะย้อน)
  await g.board(set => { set(2, 2, 3, 1); set(2, 3, 3, 0); set(1, 2, 2, 0); set(3, 2, 1, 0); set(2, 1, 2, 0); set(4, 5, 1, 0); set(5, 6, 2, 1); }, { current: 1 });
  const before = sigOf(g.S());
  g.B.emit('place', { r: 2, c: 2 });
  await until(() => g.S().current === 0 && g.S().turnCount === 3, 5000, 'B เดินแล้ว');
  await g.settle({ quietMs: 900 });
  const after = sigOf(g.S());
  const changed = before.split(/[,/]/).filter((v, i) => v !== after.split(/[,/]/)[i]).length;
  assert.ok(changed >= 5, `action ของ B ต้องเปลี่ยนหลายช่อง (ได้ ${changed})`);
  await g.hand(['r8']);
  await g.P.ev(`(() => { ${DOM_SIG}
    const R = window.__rw = { frames: [], on: true, start: 0, end: 0 };
    const grab = () => { if (!R.on) return; R.frames.push([performance.now(), __dom()]); requestAnimationFrame(grab); }; requestAnimationFrame(grab);
    const _s = window.spawnCardVfx;
    window.spawnCardVfx = function (id) { const t = performance.now(), pr = _s.apply(this, arguments); if (id === 'r8') { R.start = t; pr.then(() => { R.end = performance.now(); }); } return pr; };
  })()`);
  await g.cardNow();
  await until(() => g.P.ev(`!!__rw.end`), 8000, 'เอฟเฟกต์ Rewind จบ');
  await g.settle({ quietMs: 500 });
  const m = await g.P.ev(`(() => { __rw.on = false; return { start: __rw.start, end: __rw.end, frames: __rw.frames, dom: __dom(), sig: __sig(), left: document.querySelectorAll('.cell[data-fx]').length }; })()`);
  const during = m.frames.filter(f => f[0] >= m.start && f[0] <= m.end).map(f => f[1]);
  const distinct = [...new Set(during)], ms = Math.round(m.end - m.start), want = logic.rewindVfxMs(changed);
  metrics['9 Rewind ออนไลน์'] = { cellsChanged: changed, effectMs: ms, sharedTimingMs: want, framesSampled: during.length, distinctBoardPictures: distinct.length };
  assert.equal(sigOf(g.S()), before, 'server ย้อนกระดานกลับไปก่อน action ของ B');
  assert.equal(m.sig, before, 'state ของหน้าตรงกับ server');
  assert.equal(m.dom, before, 'กระดานที่วาดอยู่ตรงกับ server');
  assert.equal(m.left, 0, 'ไม่มีสถานะเอฟเฟกต์ค้างบนช่อง');
  assert.ok(during.length > 20, `ต้องมีเฟรมระหว่างเอฟเฟกต์ (ได้ ${during.length})`);
  assert.equal(during[0], after, 'เฟรมแรกของเอฟเฟกต์ยังเป็นกระดานก่อนย้อน');
  assert.ok(distinct.length >= 4, `กระดานต้องย้อนทีละจังหวะ (ได้ ${distinct.length} ภาพ)`);
  const B4 = before.split(/[,/]/), AF = after.split(/[,/]/);
  assert.ok(during.every(f => f.split(/[,/]/).every((v, i) => v === B4[i] || v === AF[i])), 'ทุกช่องในทุกเฟรมต้องเป็นค่าก่อนย้อนหรือหลังย้อนเท่านั้น');
  assert.equal(during[during.length - 1], before, 'เฟรมสุดท้ายของเอฟเฟกต์คือกระดานที่ย้อนแล้ว');
  assert.ok(Math.abs(ms - want) <= 150, `เอฟเฟกต์ยาว ${ms}ms (เวลาที่ server ใช้ต่อเวลาตา: ${want}ms)`);
  assert.equal(g.S().current, 1, 'ใช้การ์ดแล้วเปลี่ยนตา');
  noErrors(g); g.P.close();
});

test('10 Reflect ออนไลน์: ทุกช่องของผู้ใช้ได้แผ่นกระจกพร้อมกัน เอฟเฟกต์สั้นคงที่ แล้วโล่ขึ้นครบ', { skip: SKIP }, async () => {
  const g = await game();
  const own = [[0, 0], [0, 1], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [5, 6], [4, 6]];
  await g.board(set => { own.forEach(([r, c], i) => set(r, c, 1 + i % 3, 0)); set(0, 7, 2, 1); set(1, 7, 1, 1); });
  await g.hand(['r6']);
  await g.P.ev(`(() => { const R = window.__mir = { tokens: 0, start: 0, end: 0 }; const _s = window.spawnCardVfx;
    window.spawnCardVfx = function (id) { const t = performance.now(), pr = _s.apply(this, arguments); if (id === 'r6') { R.start = t; R.tokens = document.querySelectorAll('.cell[data-fx*="mi"]').length; pr.then(() => { R.end = performance.now(); }); } return pr; };
  })()`);
  await g.cardNow();
  await until(() => g.P.ev(`!!__mir.end`), 6000, 'เอฟเฟกต์ Reflect จบ');
  await until(() => g.P.ev(`STATE.current === 1 && !document.querySelector('.cell[data-fx]')`), 5000, 'หน้าซิงก์ state หลังเอฟเฟกต์'); // Reflect ไม่เปลี่ยนจำนวนลูก: รอจากตาที่เปลี่ยนแทน
  const m = await g.P.ev(`({ tokens: __mir.tokens, ms: Math.round(__mir.end - __mir.start), shielded: document.querySelectorAll('.cell.shielded').length, left: document.querySelectorAll('.cell[data-fx]').length })`);
  metrics['10 Reflect ออนไลน์'] = { ownCells: own.length, cellsWithMirror: m.tokens, effectMs: m.ms };
  assert.equal(m.tokens, own.length, 'ทุกช่องของผู้ใช้ได้แผ่นกระจกตั้งแต่เฟรมแรก');
  assert.ok(m.ms >= 500 && m.ms <= 760, `เอฟเฟกต์ยาว ${m.ms}ms (ไม่ขึ้นกับจำนวนช่อง)`);
  assert.equal(g.S().shielded.flat().filter(x => x > 0).length, own.length, 'server ตั้งโล่ครบทุกช่อง');
  assert.equal(m.shielded, own.length, 'หน้าแสดงโล่ครบหลังเอฟเฟกต์');
  assert.equal(m.left, 0, 'ไม่มีสถานะเอฟเฟกต์ค้างบนช่อง');
  assert.equal(g.S().current, 1, 'ใช้การ์ดแล้วเปลี่ยนตา');
  noErrors(g); g.P.close();
});

test('11 การ์ดทุกใบในโหมดออนไลน์: เอฟเฟกต์เล่นจบตามเวลาในตาราง กระดานบนจอตรงกับ server ไม่มีอะไรค้าง', { skip: SKIP, timeout: 900000 }, async () => {
  const g = await game({ rows: 8, cols: 8, players: 3 });
  await g.P.ev(`(() => { ${DOM_SIG}
    const C = window.__cv = { last: null, second: [] };
    const _s = window.spawnCardVfx;
    window.spawnCardVfx = function (id) {
      if (id === 'e1b') { C.second.push({ at: performance.now(), wavesBefore: window.__m.waves.length }); return _s.apply(this, arguments); } // Meteor ลูกที่สอง: ไม่ใช่การ์ดใบใหม่
      const rec = { id, start: performance.now(), end: 0 }; C.last = rec; const pr = _s.apply(this, arguments); pr.then(() => { rec.end = performance.now(); }); return pr; };
  })()`);
  // A (หน้าเว็บ) ซ้ายบน · B ขวา · C ล่าง — สามกลุ่มไม่ติดกัน
  const layout = set => {
    [[1, 1, 2], [1, 2, 1], [2, 1, 3], [2, 2, 2], [2, 3, 1], [3, 2, 2]].forEach(([r, c, n]) => set(r, c, n, 0));
    [[1, 6, 2], [2, 6, 1], [3, 6, 2], [2, 5, 3]].forEach(([r, c, n]) => set(r, c, n, 1));
    [[6, 1, 2], [6, 2, 1], [6, 3, 2], [5, 2, 1]].forEach(([r, c, n]) => set(r, c, n, 2));
  };
  const ids = logic.CARD_DEFS.filter(d => !d.offlineOnly).map(d => d.id);
  const rows = [], bad = [];
  for (const id of ids) {
    const def = logic.CARD_DEFS.find(d => d.id === id), s = g.S();
    // ล้างสิ่งที่การ์ดใบก่อนทิ้งไว้ (เอฟเฟกต์ค้าง, โควตา, ผลแพ้ชนะ)
    Object.assign(s, { voidCells: {}, voidSnapshot: {}, voidOwner: {}, severed: {}, severedOwner: {}, pinned: {}, pinnedOwner: {}, pinnedBy: {}, catalyzed: {}, timeBombs: [], eclipse: 0, _snapshot: null, winner: -1 });
    s.frozen = [0, 0, 0]; s.legendaryUsedBy = [0, 0, 0]; s.mythicalUsedBy = [false, false, false]; s.keyActive = [0, 0, 0];
    s.shielded.forEach(r => r.fill(0)); s.shieldOwner.forEach(r => r.fill(-1));
    g.room().phase = 'playing';
    await g.board(layout);
    let t = null;
    if (id === 'l5') { // Rebirth: A ตายแล้ว ถือการ์ดอยู่
      for (const row of s.cells) for (const ce of row) if (ce.owner === 0) { ce.count = 0; ce.owner = -1; }
      s.alive = [1, 2]; s.moved = [false, true, true]; await g.sync(); t = { r: 1, c: 1 };
    } else if (id === 'r8') { // Rewind: ต้องมี action ล่าสุดให้ย้อน
      logic.takeSnapshot(s); s.cells[2][3].count = 3; s.cells[3][3].count = 2; s.cells[3][3].owner = 1; await g.sync();
    }
    await g.hand([id]);
    if (!t && (def.needTarget || def.twoTarget)) {
      const st = g.S();
      outer: for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (def.twoTarget) {
          if (!logic.validateTargets(st, def, 0, { r, c }, { partial: true }).ok || !(st.cells[r][c].count > 0)) continue;
          for (let r2 = 0; r2 < 8; r2++) for (let c2 = 0; c2 < 8; c2++) if (!(r2 === r && c2 === c) && logic.validateTargets(st, def, 0, { r, c, r2, c2 }).ok) { t = { r, c, r2, c2 }; break outer; }
        } else if (logic.validateTargets(st, def, 0, { r, c }).ok && (!def.targetSelf || (st.cells[r][c].owner === 0 && st.cells[r][c].count === 2))) { t = { r, c }; break outer; }
      }
      assert.ok(t, `${id}: หาเป้าหมายที่ถูกกติกาไม่ได้ในกระดานทดสอบ`);
    }
    await g.P.ev(`window.__cv.last = null; window.__cv.second = []; window.__m.reset()`);
    if (t && t.r2 !== undefined) await g.act(`(() => { if (STATE.current !== 0 || targetingCard) return; selectedHandCard = { playerIdx: 0, cardIdx: 0, cardId: '${id}' }; targetData = {}; window._onlineCellClick(${t.r}, ${t.c}); window._onlineCellClick(${t.r2}, ${t.c2}); })()`);
    else if (t) await g.cardAt(id, t.r, t.c);
    else if (def.anyTarget && id === 'e4') await g.cardAt(id, 0, 2);
    else await g.cardNow();
    await until(() => g.P.ev(`!!(window.__cv.last && window.__cv.last.id === '${id}' && window.__cv.last.end)`), 9000, `${id}: เอฟเฟกต์จบ`);
    const srvTurn = g.S().turnCount;
    await until(() => g.P.ev(`STATE.turnCount === ${srvTurn} && !document.querySelector('.cell[data-fx]') && !(window._onlineFx && window._onlineFx().cur)`).catch(() => false), 12000, `${id}: หน้าซิงก์กับ server`, 100);
    await sleep(200);
    const m = await g.P.ev(`({ ms: Math.round(__cv.last.end - __cv.last.start), dom: __dom(), sig: __sig(), left: document.querySelectorAll('.cell[data-fx]').length, sprites: document.querySelectorAll('.fx-sprite').length,
      styled: [...document.querySelectorAll('.cell')].filter(e => e.style.opacity).length, clip: [...document.querySelectorAll('#fx-clip i')].filter(e => getComputedStyle(e).opacity !== '0').length })`);
    const want = id === 'r8' ? null : logic.cardVfxMs(id, {}), srv = sigOf(g.S()), why = [];
    if (m.sig !== srv) why.push('state ของหน้า ≠ server');
    // Eclipse ซ่อนจำนวนลูกของศัตรูโดยตั้งใจ · ช่องที่มีเกิน 4 ลูกวาดไม่ครบทุกลูก
    if (id !== 'sr2' && !/\b([5-9]|\d\d):/.test(srv) && m.dom !== srv) why.push('กระดานที่วาด ≠ server');
    if (want !== null && !['r2', 'r6'].includes(id) && Math.abs(m.ms - want) > 150) why.push(`เอฟเฟกต์ ${m.ms}ms ตาราง ${want}ms`);
    if (m.left || m.sprites || m.styled || m.clip) why.push(`ค้าง: data-fx ${m.left}, sprite ${m.sprites}, style ${m.styled}, overlay ${m.clip}`);
    if (id === 'e1') { // ระเบิดสองรอบ = อุกกาบาตสองลูก
      const e = await g.P.ev(`({ second: window.__cv.second, waves: window.__m.waves.length })`);
      if (e.second.length !== 1) why.push(`อุกกาบาตลูกที่สองเล่น ${e.second.length} ครั้ง (ต้อง 1)`);
      else if (!(e.second[0].wavesBefore >= 1 && e.second[0].wavesBefore < e.waves)) why.push(`ลูกที่สองต้องตกระหว่างลูกโซ่สองรอบ (ก่อนหน้า ${e.second[0].wavesBefore} wave จากทั้งหมด ${e.waves})`);
      metrics['11 Meteor ออนไลน์'] = { wavesBeforeSecondStrike: e.second[0] && e.second[0].wavesBefore, wavesTotal: e.waves };
    }
    rows.push(`${id}:${m.ms}`);
    if (why.length) bad.push(`${id} ${def.name}: ${why.join(' · ')}`);
  }
  metrics['11 การ์ดทุกใบออนไลน์ (ms)'] = rows.join(' ');
  assert.deepEqual(bad, [], 'การ์ดที่มีปัญหา');
  noErrors(g); g.P.close();
});

test('7 โหมด Firebase (หน่วง 60–200ms): ชนะด้วยการ์ด — ทั้งโฮสต์และแขกเห็นลูกโซ่ครบก่อนหน้าผู้ชนะ', { skip: SKIP }, async () => {
  const memdb = fs.readFileSync(path.join(__dirname, 'support', 'memdb.js'), 'utf8');
  const chan = 'cr-fx-' + Date.now();
  // headless Chrome ถือว่าแท็บที่ไม่ได้อยู่หน้าสุด "ถูกซ่อน" (เกมจะไม่เล่นแอนิเมชัน ซึ่งถูกต้อง) — เคสนี้ต้องการให้ทั้งสองหน้ามองเห็นได้พร้อมกันเหมือนเปิดสองหน้าต่าง
  const inject = memdb + `
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.CR_FORCE_FIREBASE = true;
    window.CR_DB_ADAPTER_FACTORY = () => {
      const db = new CRMemDB.MemDB({ channel: '${chan}', delay: () => 60 + Math.random() * 140 });
      const a = CRMemDB.memoryAdapter(db, 'u' + Math.random().toString(36).slice(2, 10));
      addEventListener('pagehide', () => a.drop()); window.__fba = a; return a;
    };`;
  const url = `http://localhost:${port}/`;
  const A = await openPage(url, inject), G = await openPage(url, inject);
  await A.ev(INSTRUMENT); await G.ev(INSTRUMENT);
  await A.ev(`document.getElementById('btn-online').click()`);
  await until(() => A.ev(`document.getElementById('online-screen').classList.contains('active')`), 5000, 'หน้าออนไลน์ (โฮสต์)');
  await A.ev(`document.getElementById('online-name').value = 'Host'`);
  await sleep(600);
  await A.ev(`document.getElementById('btn-create-room').click()`);
  const code = await until(async () => {
    const c = await A.ev(`document.getElementById('room-screen').classList.contains('active') ? document.getElementById('room-code-big').textContent.trim() : ''`);
    return /^\d{4}$/.test(c) ? c : null;
  }, 12000, 'โฮสต์สร้างห้องผ่าน Firebase', 100);
  await G.ev(`document.getElementById('btn-online').click()`);
  await sleep(800);
  await G.ev(`(() => { document.getElementById('online-name').value = 'Guest'; document.getElementById('btn-join-room').click(); document.getElementById('join-code-input').value = '${code}'; document.getElementById('btn-confirm-join').click(); })()`);
  await until(() => G.ev(`document.getElementById('room-screen').classList.contains('active')`), 12000, 'แขกเข้าห้อง');
  await until(() => A.ev(`document.querySelectorAll('#room-members-list .lm-row:not(.empty)').length === 2`), 8000, 'โฮสต์เห็นแขก');
  await A.ev(`document.getElementById('btn-start-online').click()`);
  for (const P of [A, G]) await until(() => P.ev(`!!(window._getOnlineMode() && STATE.cells)`), 10000, 'เกมเริ่ม');

  // ยัดกระดาน + มือการ์ดเข้า game-server ที่รันอยู่ในหน้าโฮสต์ แล้วบังคับ broadcast (rejoin ของโฮสต์เอง)
  const hostSig = () => A.ev(`(async () => { const rt = await __fba._rt, room = [...rt.game.rooms.values()][0]; return room.state.cells.map(r => r.map(c => c.count + ':' + (c.count ? c.owner : -1)).join(',')).join('/'); })()`);
  await A.ev(`(async () => {
    const rt = await __fba._rt, room = [...rt.game.rooms.values()][0], s = room.state;
    for (const row of s.cells) for (const c of row) { c.count = 0; c.owner = -1; }
    s.cells[0][0].count = 3; s.cells[0][0].owner = 0;
    for (let c = 1; c < 8; c++) { s.cells[0][c].count = 3; s.cells[0][c].owner = 1; }
    s.moved = [false, true]; s.current = 0; s.turnCount = 2; s.alive = [0, 1];
    s.hands[0] = [{ ...CARD_DEFS.find(d => d.id === 'u1') }];
    const sess = JSON.parse(sessionStorage.getItem('cr.session'));
    rt.io.sockets.sockets.get(room.host)._dispatch('rejoin_room', [{ code: sess.code, token: sess.token, takeover: true }, () => {}]);
  })()`);
  const want = await hostSig();
  for (const P of [A, G]) await until(async () => (await P.ev(`__sig()`)) === want, 8000, 'ทั้งสองหน้าซิงก์กระดาน');
  await until(() => A.ev(`(STATE.hands[0] || []).some(d => d.id === 'u1')`), 4000, 'โฮสต์ได้มือการ์ด');
  await sleep(400);
  await A.ev(`__m.reset()`); await G.ev(`__m.reset()`);
  await until(async () => {
    await A.ev(`(() => { if (STATE.current !== 0) return; selectedHandCard = { playerIdx: 0, cardIdx: 0, cardId: 'u1' }; targetData = {}; window._onlineCellClick(0, 0); })()`);
    await sleep(200);
    return A.ev(`(async () => { const rt = await __fba._rt; return [...rt.game.rooms.values()][0].phase === 'finished'; })()`);
  }, 8000, 'โฮสต์ใช้การ์ดชนะ', 200);
  const final = await hostSig();
  const out = {};
  for (const [name, P] of [['host', A], ['guest', G]]) {
    await until(() => P.ev(`(() => { const w = __m.waves, last = w.length ? w[w.length - 1].t : 0; return __sig() === ${JSON.stringify(final)} && performance.now() - last > 1300 && __m.winnerAt != null; })()`), 25000, name + ': เอฟเฟกต์นิ่ง มีหน้าผู้ชนะ', 100);
    const m = await P.ev(`({ waves: __m.waves, winnerAt: __m.winnerAt, fx: window._onlineFx ? window._onlineFx() : null })`);
    const gap = median(gaps(m.waves)), last = m.waves.length ? m.waves[m.waves.length - 1].t : 0;
    out[name] = { wavesPlayed: m.waves.length, msPerWave: Math.round(gap), winnerAfterLastWaveStart: Math.round(m.winnerAt - last), warpCells: m.fx ? m.fx.warpCells : 'n/a' };
  }
  metrics['7 โหมด Firebase ชนะด้วยการ์ด'] = out;
  for (const name of ['host', 'guest']) {
    assert.equal(out[name].wavesPlayed, 8, name + ': เล่นลูกโซ่ครบ 8 wave');
    assert.ok(out[name].winnerAfterLastWaveStart >= out[name].msPerWave * 0.9, `${name}: หน้าผู้ชนะขึ้น ${out[name].winnerAfterLastWaveStart}ms หลัง wave สุดท้ายเริ่ม`);
  }
  assert.deepEqual(G.logs.filter(l => !/favicon|vibrate/.test(l)), [], 'ไม่มี error ใน console ของแขก');
  A.close(); G.close();
});
