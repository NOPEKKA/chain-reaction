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
async function openPage(url) {
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
async function game({ rows = 6, cols = 8, cardInterval = 0 } = {}) {
  const P = await openPage(`http://localhost:${port}/`);
  await P.ev(INSTRUMENT);
  await P.ev(`document.getElementById('btn-online').click()`);
  await until(() => P.ev(`document.getElementById('online-screen').classList.contains('active')`), 5000, 'หน้าออนไลน์');
  await P.ev(`document.getElementById('online-name').value = 'Alice'`);
  const code = await until(async () => {
    await P.ev(`document.getElementById('room-screen').classList.contains('active') || document.getElementById('btn-create-room').click()`);
    const c = await P.ev(`document.getElementById('room-screen').classList.contains('active') ? document.getElementById('room-code-big').textContent.trim() : ''`);
    return /^\d{4}$/.test(c) ? c : null;
  }, 8000, 'สร้างห้อง', 400);
  const B = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  socks.push(B);
  B.updates = []; B.on('room_update', r => B.updates.push(r));
  await new Promise((res, rej) => { B.once('connect', res); B.once('connect_error', rej); });
  const j = await emit(B, 'join_room', { code, name: 'Bob' });
  assert.equal(j.ok, true, j.msg); B.token = j.token;
  const room = () => srv.rooms.get(code);
  Object.assign(room().cfg, { mapSize: rows, mapCols: cols, cardInterval });
  await until(() => room().members.length === 2, 2000, 'B เข้าห้อง');
  await P.ev(`document.getElementById('btn-start-online').click()`);
  await until(() => P.ev(`!!(window._getOnlineMode() && STATE.cells && STATE.size === ${rows} && STATE.cols === ${cols})`), 6000, 'เกมเริ่มในหน้า');
  const g = { P, B, code, room, S: () => room().state };
  // ยัดกระดาน: fn(set) โดย set(r, c, count, owner)
  // moved[i] = "เดินไปแล้วในรอบล่าสุด": คนที่ถึงตา = false (ยังเดินได้) · คนอื่น = true (ไม่มีช่องเหลือ = ตกรอบ) เว้นแต่บอกเป็นอย่างอื่น
  g.board = async (fn, { current = 0, turnCount = 2, moved = [0, 1].map(i => i !== current) } = {}) => {
    const s = g.S();
    for (const row of s.cells) for (const c of row) { c.count = 0; c.owner = -1; }
    fn((r, c, n, o) => { s.cells[r][c].count = n; s.cells[r][c].owner = o; });
    s.moved = moved.slice(); s.current = current; s.turnCount = turnCount; s.alive = [0, 1]; s.phase = 'playing';
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
  // รอจนไม่มี wave ใหม่ quietMs (และเงื่อนไขเสริมเป็นจริง) แล้วคืนค่าที่วัดได้
  g.settle = async ({ quietMs = 1300, need = 'true', ms = 25000 } = {}) => {
    await until(() => P.ev(`(() => { const w = __m.waves, last = w.length ? w[w.length - 1].t : 0; return (performance.now() - last > ${quietMs}) && (${need}); })()`), ms, 'เอฟเฟกต์นิ่ง', 100);
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
