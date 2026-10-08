// ══ ONLINE CLIENT ══
(function() {

let socket = null;
let mySlot = -1;
let myName = '';
let isHost = false;
let currentRoom = null;
let onlineMode = false;
let myHand = [];
let roomCfg = { mapSize: 8, mapCols: 8, cardInterval: 2 };
let turnTimerInterval = null;
let cardTimerInterval = null;
const TURN_LIMIT = 30;
const CARD_LIMIT = 30;

// ══ ที่นั่งในห้อง (playerToken) ══
// server ออก token ตอน create/join — เก็บไว้เพื่อกลับเข้าที่นั่งเดิมเมื่อหลุด/รีเฟรช
//  · sessionStorage = ของแท็บนี้ (รีเฟรชแล้วยังอยู่) → ยึดที่นั่งคืนได้ทันที
//  · localStorage   = สำรองไว้ 10 นาที สำหรับ "ปิดแท็บแล้วเปิดใหม่" → เข้าได้เฉพาะเมื่อที่นั่งว่าง (ไม่แย่งจากอีกแท็บที่ยังเล่นอยู่)
let session = null;      // { code, token } ของห้องที่กำลังอยู่
let _enterGame = false;  // rejoin สำเร็จตอนยังไม่ได้อยู่หน้าเกม (เช่น รีเฟรช) → room_update ถัดไปพาเข้าเกม
const SS_KEY = 'cr.session', LS_KEY = 'cr.lastSession';
function saveSession(s) {
  session = { code: s.code, token: s.token };
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(session)); } catch (e) {}
  try { localStorage.setItem(LS_KEY, JSON.stringify({ code: s.code, token: s.token, at: Date.now() })); } catch (e) {}
}
function clearSession() {
  const tok = session && session.token;
  session = null;
  try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
  try { const l = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (!l || !tok || l.token === tok) localStorage.removeItem(LS_KEY); } catch (e) {}
}
function storedSession() {
  try { const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); if (s && s.code && s.token) return { code: s.code, token: s.token, takeover: true }; } catch (e) {}
  try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s && s.code && s.token && Date.now() - (s.at || 0) < 10 * 60 * 1000) return { code: s.code, token: s.token, takeover: false }; } catch (e) {}
  return null;
}

// แถบ "หลุดการเชื่อมต่อ" — ค้างไว้จนกว่าจะกลับเข้าห้องได้ (คนละเรื่องกับ "ห้องไม่อยู่แล้ว" ที่เป็น overlay เต็มจอ)
function setNetBanner(on) {
  let el = document.getElementById('net-banner');
  if (!on) { if (el) el.style.display = 'none'; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'net-banner';
    el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:1100;background:rgba(40,16,16,.94);color:#fff;border:1px solid rgba(255,140,120,.6);border-radius:999px;padding:8px 18px;font-family:"Fredoka One","Mitr",cursive;font-size:.9rem;box-shadow:0 8px 24px rgba(0,0,0,.4);white-space:nowrap;';
    el.textContent = '⚠️ หลุดการเชื่อมต่อ — กำลังเชื่อมใหม่…';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
}

const PLAYER_COLORS_O = ['#e05c5c','#5bc4e0','#6dba6d','#e0a84a','#cc55ee','#ee8844'];

// ══ TIMER (ตัวเลขนับถอยหลัง) ══
function createTimerEl() {
  let el = document.getElementById('online-timer-el');
  if (!el) {
    el = document.createElement('div');
    el.id = 'online-timer-el';
    el.style.cssText = [
      'position:fixed;top:8px;left:50%;transform:translateX(-50%)',
      'font-family:"Fredoka One","Mitr",cursive;font-size:1.4rem;font-weight:900',
      'color:#fff;text-shadow:0 0 12px rgba(0,0,0,0.6)',
      'background:rgba(0,0,0,0.55);border-radius:999px',
      'padding:4px 18px;z-index:998;pointer-events:none',
      'backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.15)',
      'display:none;transition:color .3s',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function startCountdown(seconds, color, onEnd) {
  clearAllTimers();
  const el = createTimerEl();
  el.style.display = 'block';
  el.style.color = color || '#fff';
  let left = seconds;
  el.textContent = left;

  turnTimerInterval = setInterval(() => {
    left--;
    el.textContent = left;
    if (left <= 5 && left > 0) SFX.tick(left);
    if (left <= 5) el.style.color = '#ff6644';
    else el.style.color = color || '#fff';
    if (left <= 0) {
      clearAllTimers();
      onEnd?.();
    }
  }, 1000);
}

function clearAllTimers() {
  clearInterval(turnTimerInterval);
  clearInterval(cardTimerInterval);
  turnTimerInterval = null; cardTimerInterval = null;
  const el = document.getElementById('online-timer-el');
  if (el) el.style.display = 'none';
}

// ══ GROUP PICK OVERLAY ══
function showGroupPickOverlay(cards, handSize, timeLimit, mySlotName) {
  // สร้าง overlay ถ้ายังไม่มี
  let ov = document.getElementById('group-pick-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'group-pick-overlay';
    ov.style.cssText = [
      'display:none;position:fixed;inset:0',
      'background:rgba(0,0,0,0.72);backdrop-filter:blur(10px)',
      'z-index:600;flex-direction:column;align-items:center;justify-content:center;gap:16px',
    ].join(';');
    document.body.appendChild(ov);
  }
  ov.innerHTML = '';
  ov.style.display = 'flex';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'text-align:center;';
  hdr.innerHTML = `
    <div style="font-family:'Fredoka One','Mitr',cursive;font-size:1.5rem;color:#fff;">🎴 เลือกการ์ด</div>
    <div style="font-size:.82rem;color:rgba(255,255,255,0.6);margin-top:4px;">มือ ${handSize}/4 ใบ</div>
  `;
  ov.appendChild(hdr);

  // Progress + timer
  const progRow = document.createElement('div');
  progRow.id = 'gp-prog-row';
  progRow.style.cssText = 'font-family:"Fredoka One","Mitr",cursive;font-size:.9rem;color:rgba(255,255,255,0.6);text-align:center;';
  progRow.textContent = 'รอผู้เล่นอื่น...';
  ov.appendChild(progRow);
  const bar = document.createElement('div');
  bar.className = 'gp-bar'; bar.id = 'gp-bar';
  bar.innerHTML = '<i></i>';
  bar.firstChild.style.animationDuration = timeLimit + 's';
  ov.appendChild(bar);
  setTimeout(() => { if (bar.isConnected) bar.classList.add('low'); }, Math.max(0, timeLimit - 5) * 1000);

  // Cards row
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;';

  const RARITY_COLORS = {common:'r-common',uncommon:'r-uncommon',rare:'r-rare',super_rare:'r-super-rare',epic:'r-epic',legendary:'r-legendary',mythical:'r-mythical'};
  const RARITY_LABEL  = {common:'Common',uncommon:'Uncommon',rare:'Rare',super_rare:'Super Rare',epic:'Epic',legendary:'✨ Legendary',mythical:'🌌 Mythical'};

  let chosen = false;

  cards.forEach((def, idx) => {
    const el = document.createElement('div');
    el.className = 'pick-card';
    el.dataset.rarity = def.rarity;
    el.style.animationDelay = (idx * 0.07) + 's';
    el.innerHTML = `
      <div class="pc-emoji">${def.emoji}</div>
      <div class="pc-name">${def.name}</div>
      <div class="pc-rarity ${RARITY_COLORS[def.rarity]}">${RARITY_LABEL[def.rarity]}</div>
      <div class="pc-desc">${def.desc}</div>
    `;
    const doPickCard = () => {
      if (chosen) return;
      chosen = true;
      clearAllTimers();
      socket.emit('group_pick_response', { cardId: def.id }, (res) => {
        // ไม่ต้องทำอะไร - server จะ broadcast room_update เมื่อ finalize
      });
      SFX.pickCard && SFX.pickCard();
      // แสดงว่าเลือกแล้ว รอคนอื่น
      row.querySelectorAll('.pick-card').forEach(c => {
        c.style.opacity = c === el ? '1' : '0.35';
        c.style.pointerEvents = 'none';
      });
      el.style.border = '3px solid rgba(255,255,255,0.8)';
      el.style.boxShadow = '0 0 20px rgba(255,255,255,0.3)';
      progRow.textContent = '✅ เลือกแล้ว — รอผู้เล่นอื่น...';
      bar.firstChild.style.animationPlayState = 'paused'; bar.style.opacity = '.4';
      SFX.pickCard && SFX.pickCard();
    };
    el.addEventListener('click', doPickCard);
    el.addEventListener('touchend', (e) => { e.preventDefault(); doPickCard(); });
    row.appendChild(el);
  });
  ov.appendChild(row);
  FX.revealCards(row);
  SFX.reveal(cards.map(c => c.rarity));



  // เริ่ม countdown
  startCountdown(timeLimit, '#5bc4e0', () => {
    if (!chosen) {
      chosen = true;
      socket.emit('group_pick_skip', {}, () => {});
      progRow.textContent = '⏰ หมดเวลา — รอผู้เล่นอื่น...';
      setTimeout(() => closeGroupPickOverlay(), 8000);
    }
  });
}

function closeGroupPickOverlay() {
  const ov = document.getElementById('group-pick-overlay');
  if (ov) ov.style.display = 'none';
  clearAllTimers();
  // reset window callbacks
  window._onlinePickCard = null;
  window._onlineSkipCard = null;
}

// ══ คิวเอฟเฟกต์ ══
// ทุก room_update ของเกม = งานหนึ่งชิ้น เล่นทีละชิ้นตามลำดับที่ได้รับ ไม่มีชิ้นไหนถูกข้าม:
//   VFX การ์ด → ลูกโซ่ทุก wave → รออนุภาคนิ่ง → ซิงก์ state ของ "งานนั้น" (ไม่ใช่ state ล่าสุด)
//   → จบเกม: หน้าผู้ชนะ · ไม่งั้น: ประกาศตาใหม่ → งานถัดไป
// หน้าเลือกการ์ด (group_pick_start) เข้าคิวเดียวกัน จึงขึ้นหลังเอฟเฟกต์ของตาที่มาก่อนเสมอ โดยไม่ต้องคำนวณเวลารอเอง
// งานแต่ละชิ้นมีข้อมูลครบในตัว (state.last = การ์ด/การวาง/การโดน Freeze ของตานั้น) — ไม่พึ่งลำดับของ card_vfx / place_vfx / game_over
// เวลาทั้งหมดมาจาก shared/gameLogic.js (window.CRLogic) ชุดเดียวกับที่ server ใช้ต่อเวลานาฬิกาตา
const { cardVfxMs, waveStepMs, animMs } = window.CRLogic;
const { WAVE_FAST_MS, WAVE_MIN_MS, CARD_GAP_MS, SETTLE_MS } = window.CRLogic.FX_TIMING;
const FX_IDLE_MAX_MS = 2500; // รออนุภาคนิ่งนานสุดเท่านี้

const FXQ = { jobs: [], cur: null, epoch: 0, stats: { jobs: 0, waves: 0, warpCells: 0, forced: 0 } };
let _winnerKey = null;   // เกมที่เปิดหน้าผู้ชนะไปแล้ว — กันขึ้นซ้ำ
let _gameOver = null;    // payload ล่าสุดของ game_over (ชื่อผู้ชนะที่ server ส่ง)
let _resyncNext = false; // เพิ่ง rejoin: update ถัดไปให้ล้างคิวแล้วซิงก์ตรงๆ

// เอฟเฟกต์ของตาก่อนหน้ายังเล่นไม่จบ → ยังไม่รับ input (watchdog ของแต่ละงานกันค้างแทน deadline แบบเดิม)
const isSettling = () => !!FXQ.cur || FXQ.jobs.length > 0;
const fxUpdatesQueued = () => FXQ.jobs.reduce((n, j) => n + (j.type === 'update' ? 1 : 0), 0);

function fxEnqueue(job) { FXQ.jobs.push(job); fxPump(); }
// ล้างคิวทิ้งทั้งหมด (rejoin / ออกจากห้อง / ห้องปิด) — งานที่กำลังเล่นอยู่จะเลิกเองเมื่อเห็นว่า epoch เปลี่ยน
function fxReset() {
  FXQ.epoch++;
  const cur = FXQ.cur;
  FXQ.jobs.length = 0; FXQ.cur = null;
  if (cur) fxRush(cur);
}
async function fxPump() {
  if (FXQ.cur) return;
  const ep = FXQ.epoch;
  while (FXQ.jobs.length) {
    const job = FXQ.jobs.shift();
    FXQ.cur = job;
    try { await fxRun(job, ep); }
    catch (e) { console.error('[fx] งานพัง — ซิงก์ตรงแล้วไปต่อ', e); if (ep === FXQ.epoch && job.room && onlineMode) fxFinal(job); }
    if (ep !== FXQ.epoch) return; // คิวถูกล้างระหว่างเล่น: รอบใหม่เริ่มไปแล้วโดย fxEnqueue ตัวถัดไป
    FXQ.cur = null; FXQ.stats.jobs++;
  }
}

// รอแบบ "ปลุกได้": watchdog / การล้างคิว ปลุกให้งานเดินต่อทันทีโดยไม่ต้องรอ timer
function fxRush(job) { job.rush = true; if (job._wake) job._wake(); }
function fxWait(ms, job) {
  if (job.rush || ms <= 0) return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (job._wake === done) job._wake = null; res(); }
    job._wake = done;
  });
}
const fxUntil = (t, job) => fxWait(t - performance.now(), job); // เทียบเวลาจริง: timer ที่ถูกยืดจะไม่ทำให้ขั้นถัดไปเลื่อนตาม
function fxIdle(job, max) {
  if (job.rush) return Promise.resolve();
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; if (job._wake === fin) job._wake = null; res(); };
    job._wake = fin;
    FX.whenIdle(fin, max);
  });
}

// เวลาที่งานนี้ควรใช้ (ms) — ใช้ตั้ง watchdog
function fxEstimate(job) {
  if (job.type !== 'update' || job.instant) return 300;
  const st = job.room.state, card = st.last && st.last.card;
  return animMs((st.explosionWaves || []).length, card && card.cardId, card && card.vfxData) + FX_IDLE_MAX_MS;
}
// งานค้างเยอะ (≥ 3 ชิ้นรวมชิ้นที่เล่นอยู่ หรือที่รออยู่รวมกันเกิน ~6 วินาที) → เร่ง
function fxBehind() {
  const waiting = FXQ.jobs.filter(j => j.type === 'update');
  if (waiting.length >= 2) return true;
  return waiting.reduce((ms, j) => ms + fxEstimate(j) - FX_IDLE_MAX_MS, 0) > 6000;
}

async function fxRun(job, ep) {
  const alive = () => ep === FXQ.epoch && onlineMode;
  if (job.type === 'pick') { if (alive()) fxPick(job); return; }
  const room = job.room, st = room.state, last = st.last || {};
  const waves = st.explosionWaves || [];
  const est = fxEstimate(job);
  const dog = setTimeout(() => {
    if (FXQ.cur !== job || ep !== FXQ.epoch) return;
    console.warn('[fx] งานค้างเกินเวลาที่ประมาณไว้ (' + est + 'ms) — ซิงก์แล้วเดินต่อ');
    FXQ.stats.forced++; fxRush(job);
  }, est * 1.5 + 1000);
  try {
    // ออกจากช่วงเลือกการ์ดแล้ว: ปิดหน้าเลือกการ์ด + ตัวนับเวลาเก่า ก่อนเริ่มเล่นเอฟเฟกต์ของตานี้
    if (room.phase !== 'group_pick') {
      const gp = document.getElementById('group-pick-overlay');
      if (gp && gp.style.display === 'flex') closeGroupPickOverlay();
      clearAllTimers();
    }
    if (room.phase !== 'finished') hideWinner();
    // แท็บถูกซ่อน / มือถือล็อกจอ: ไม่เล่นแอนิเมชัน (timer ถูกเบราว์เซอร์ยืด คิวจะค้าง) — ซิงก์งานนี้ตรงๆ แล้วไปต่อ
    if (document.hidden) job.instant = true;
    if (!job.instant) {
      if (last.frozen) fxFrozen(last.frozen);
      if (last.place) fxPlace(last.place);
      if (last.card) { await fxCard(last.card, job); if (!alive()) return; }
      if (waves.length) { await fxWaves(job, waves, alive); if (!alive()) return; }
      await fxIdle(job, FX_IDLE_MAX_MS); if (!alive()) return;
    }
    fxFinal(job);
    if (room.phase === 'finished') {
      if (!job.instant) { await fxWait(SETTLE_MS, job); if (!alive()) return; }
      showWinner(room, job.instant);
    } else if (!fxUpdatesQueued()) {
      announceTurn(room); // มีงานรออยู่อีก = ตานี้ผ่านไปแล้ว ให้งานสุดท้ายเป็นคนประกาศ
    }
  } finally { clearTimeout(dog); }
}

// ซิงก์ state ของงานนี้ลงกระดาน (ทุกงานจบด้วยขั้นนี้เสมอ ไม่ว่าจะเล่นเอฟเฟกต์ครบหรือถูกเร่ง)
function fxFinal(job) {
  const st = job.room.state;
  if (job.played && STATE.cells) { // ภาพหลัง wave สุดท้ายควรเท่ากับผลลัพธ์จริงอยู่แล้ว — นับไว้ให้เทสต์จับการ "วาร์ป"
    let diff = 0;
    for (let r = 0; r < st.cells.length; r++) for (let c = 0; c < st.cells[r].length; c++) {
      const a = STATE.cells[r] && STATE.cells[r][c], b = st.cells[r][c];
      if (!a || a.count !== b.count || (b.count > 0 && a.owner !== b.owner)) diff++;
    }
    FXQ.stats.warpCells += diff;
  }
  syncStateFromServer(st);
  renderGrid(true);
  renderHandBar();
  renderScoreboard();
  updateTurnLabel();
}

function fxFrozen({ playerIdx }) {
  SFX.frozen && SFX.frozen();
  const pName = (window.PLAYER_NAMES && window.PLAYER_NAMES[playerIdx]) || `P${playerIdx + 1}`;
  showToast(playerIdx === mySlot ? '❄️ คุณโดน Freeze! action ไม่มีผลในเทิร์นนี้' : `❄️ ${pName} โดน Freeze! action ไม่มีผล`);
  const sc = document.getElementById(`sc-${playerIdx}`);
  if (!sc) return;
  sc.style.transition = 'all .2s';
  sc.style.background = 'rgba(100,200,255,0.4)';
  sc.style.boxShadow = '0 0 20px #88eeff';
  const rect = sc.getBoundingClientRect();
  const ice = document.createElement('div');
  ice.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top}px;font-size:2.5rem;pointer-events:none;z-index:1200;transform:translate(-50%,-50%);animation:cellEmojiPop 1s ease-out forwards;`;
  ice.textContent = '❄️';
  document.body.appendChild(ice);
  setTimeout(() => { sc.style.background = ''; sc.style.boxShadow = ''; ice.remove(); }, 1500);
}

function fxPlace({ r, c, playerIdx, isFirstPlace }) {
  if (isFirstPlace) SFX.firstPlace(playerIdx); else SFX.place(playerIdx);
  const cell = STATE.cells && STATE.cells[r] && STATE.cells[r][c];
  if (cell) { cell.count += isFirstPlace ? 3 : 1; cell.owner = playerIdx; updateCellDisplay(r, c); }
  setTimeout(() => { if (onlineMode) FX.place(r, c, playerIdx, isFirstPlace); }, 60);
}

async function fxCard({ cardId, targets, playerIdx, vfxData }, job) {
  const def = (window.CARD_DEFS || []).find(d => d.id === cardId);
  if (def) {
    SFX.card && SFX.card(def.rarity);
    SFX.cardCat && SFX.cardCat(def.cat);
    SFX.cardSpecial && SFX.cardSpecial(cardId);
    FX.cardCast(def, playerIdx);
  }
  if (fxBehind() || !window.spawnCardVfx) { await fxWait(350, job); return; } // งานค้างเยอะ: ย่อเหลือแค่ประกาศการ์ด
  const ms = cardVfxMs(cardId, vfxData);
  FX.hold(ms);
  FX.track(spawnCardVfx(cardId, targets || {}, playerIdx, vfxData || {}).catch(() => {}));
  await fxWait(ms + CARD_GAP_MS, job);
}

// เล่นลูกโซ่ทีละ wave: ระเบิด (45% ของช่วง) → กระดานเปลี่ยน + ลูกลงช่อง (55%)
// ภาพทุกขั้นมาจาก server: เริ่มที่ fxBase (กระดานก่อน wave แรก) แล้ววาดค่าที่แต่ละ wave บอก — client ไม่คำนวณกฎระเบิดเอง
function fxSet(list) { // [r, c, count, owner, ...]
  for (let i = 0; i + 3 < list.length; i += 4) {
    const cell = STATE.cells[list[i]] && STATE.cells[list[i]][list[i + 1]];
    if (cell) { cell.count = list[i + 2]; cell.owner = list[i + 3]; }
  }
}
async function fxWaves(job, waves, alive) {
  const st = job.room.state, base = st.fxBase;
  if (base) {
    let i = 0;
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++, i += 2) {
      const cell = STATE.cells[r] && STATE.cells[r][c];
      if (cell) { cell.count = base[i]; cell.owner = base[i + 1]; }
    }
    renderGrid(false);
  }
  const n = waves.length, perWave = waveStepMs(n);
  const group = perWave >= WAVE_MIN_MS ? 1 : Math.ceil(WAVE_MIN_MS / perWave); // ลูกโซ่ยาวมาก: รวมหลาย wave เป็นขั้นภาพเดียว
  FX.chainReset();
  let cursor = performance.now();
  for (let w = 0; w < n; w += group) {
    const part = waves.slice(w, w + group);
    const step = fxBehind() ? Math.min(WAVE_FAST_MS, perWave * part.length) : perWave * part.length;
    const explosions = [];
    part.forEach(wave => { for (let i = 0; i + 2 < wave.e.length; i += 3) explosions.push({ r: wave.e[i], c: wave.e[i + 1], owner: wave.e[i + 2] }); });
    await fxUntil(cursor, job); if (!alive()) return;
    if (part[0].b) { fxSet(part[0].b); if (!job.rush) renderGrid(false); } // เปลี่ยนก่อนระเบิด (เช่น Time Bomb เติมช่อง)
    if (!job.rush) { FX.wave(explosions, FX.chainStep()); FXQ.stats.waves += part.length; }
    job.played = true;
    cursor += step * .45;
    await fxUntil(cursor, job); if (!alive()) return;
    part.forEach((wave, k) => { if (k && wave.b) fxSet(wave.b); fxSet(wave.d); });
    if (!job.rush) { renderGrid(false); FX.land(explosions); }
    cursor += step * .55;
  }
  await fxUntil(cursor, job);
  if (st.wavesTruncated) job.played = false; // server เลิกบันทึกกลางทาง: ภาพจบไม่เท่าผลลัพธ์ เป็นเรื่องที่รู้อยู่ — ไม่นับเป็นการวาร์ป
}

function fxPick(job) {
  const left = Math.max(3, Math.round((job.timeLimit || CARD_LIMIT) - (Date.now() - job.at) / 1000)); // หักเวลาที่รอในคิวไปแล้ว
  SFX.select && SFX.select();
  closeGroupPickOverlay();
  showGroupPickOverlay(job.cards, job.handSize, left, myName);
}

function hideWinner() {
  const wo = document.getElementById('winner-overlay');
  if (wo.classList.contains('show')) wo.classList.remove('show');
}
// เปิดหน้าผู้ชนะ: ครั้งเดียวต่อเกม (game_over ซ้ำ / กลับเข้าห้องตอนจบแล้ว ไม่เปิดรอบสอง) · เสียงและพลุเริ่มพร้อมกันที่นี่
function showWinner(room, silent) {
  const st = room.state, w = st.winner;
  if (!(w >= 0)) return;
  const key = room.code + ':' + (room.gameId || 0);
  const wo = document.getElementById('winner-overlay');
  if (_winnerKey === key && wo.classList.contains('show')) return;
  const already = _winnerKey === key;
  _winnerKey = key;
  clearAllTimers(); closeGroupPickOverlay();
  const m = (room.members || []).find(x => x.slot === w);
  const name = (_gameOver && _gameOver.winner === w && _gameOver.winnerName) || (m && m.name) || getPlayerName(w);
  document.getElementById('winner-title').textContent = `${name} ชนะ! 🎉`;
  document.getElementById('winner-title').style.color = PLAYER_COLORS_O[w] || '#fff';
  document.getElementById('winner-sub').textContent = 'คะแนน: ' + (st.scores || []).map((s, i) => `P${i + 1}:${s}`).join('  ');
  wo.classList.add('show');
  if (!silent && !already) SFX.win && SFX.win();
}

// ซ่อนแท็บกลางคัน: เร่งงานที่เล่นอยู่ให้จบ (งานถัดไปจะซิงก์ตรงเองเพราะ document.hidden)
// กลับมามองเห็น: ล้างอนุภาคค้าง ซิงก์ไปที่ state ล่าสุด แล้วนับเวลาตาใหม่จากเวลาที่เหลือจริง
document.addEventListener('visibilitychange', () => {
  if (!onlineMode) return;
  if (document.hidden) { if (FXQ.cur) fxRush(FXQ.cur); return; }
  FX.clear();
  if (isSettling() || !currentRoom || !currentRoom.state) return; // มีงานเข้ามาพอดี: คิวจัดการเอง
  fxFinal({ room: currentRoom });
  if (currentRoom.phase !== 'finished') announceTurn(currentRoom);
});

window._onlineFx = () => ({ queued: FXQ.jobs.length, running: !!FXQ.cur, jobsDone: FXQ.stats.jobs, wavesPlayed: FXQ.stats.waves, warpCells: FXQ.stats.warpCells, forced: FXQ.stats.forced });

// ══ Handle server reset (Railway restart) ══
function handleServerReset() {
  fxReset();
  clearAllTimers();
  closeGroupPickOverlay();
  clearSession();
  setNetBanner(false);
  if (document.getElementById('server-reset-ov')) return;
  // ห้องหายจริงๆ (server ถูก restart หรือห้องหมดอายุ) — ต่างจากแค่หลุดการเชื่อมต่อ ซึ่งกลับเข้าห้องเดิมได้เอง
  const ov = document.createElement('div');
  ov.id = 'server-reset-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
  ov.innerHTML = `
    <div style="font-family:'Fredoka One','Mitr',cursive;font-size:1.4rem;color:#fff;text-align:center;">⚠️ ห้องนี้ไม่อยู่แล้ว<br><span style="font-size:.9rem;color:rgba(255,255,255,0.6);font-family:Nunito,sans-serif;">Server ถูก restart หรือห้องหมดอายุ</span></div>
    <button id="server-reset-btn" style="background:#fff;border:none;border-radius:999px;padding:12px 32px;font-family:'Fredoka One','Mitr',cursive;font-size:1.1rem;color:#2a1a4e;cursor:pointer;">กลับหน้าหลัก</button>
  `;
  document.body.appendChild(ov);
  document.getElementById('server-reset-btn').addEventListener('click', () => {
    ov.remove();
    onlineMode = false; mySlot = -1; isHost = false; myHand = [];
    if (STATE) STATE._dead = true;
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('winner-overlay').classList.remove('show');
    showScreen('main-menu');
  });
}

// ══ แจ้งเตือนถึงตาเรา ══
let _lastNotifiedTurn = -1;
let _lastOtherTurn = '';

// turnKey มาจาก state ของ server (ของเดิมอ่าน STATE.turnCount ที่ไม่เคยถูก sync จึงแจ้งเตือนได้แค่ครั้งแรกของ session)
function notifyMyTurn(turnKey) {
  if (_lastNotifiedTurn === turnKey) return;
  _lastNotifiedTurn = turnKey;

  const color = ['#e05c5c','#5bc4e0','#6dba6d','#e0a84a','#cc55ee','#ee8844'][mySlot] || '#fff';

  // 1. เสียง "ตาเรา" — ใช้ engine เสียงกลางของเกม (ของเดิม new AudioContext ทุกครั้งที่ถึงตา)
  SFX.myTurn(mySlot);

  // 2. สั่น (มือถือ) — double pulse
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([60, 30, 100]);

  // 3. กระดานกระพริบแรงๆ 2 รอบ
  const gWrap = document.getElementById('grid-wrap');
  if (gWrap) {
    let count = 0;
    const flash = () => {
      gWrap.style.transition = 'box-shadow 0.08s';
      gWrap.style.boxShadow = `0 0 0 5px ${color}, 0 0 50px ${color}cc, 0 0 100px ${color}66`;
      setTimeout(() => {
        gWrap.style.boxShadow = `0 8px 32px rgba(0,0,0,0.2), 0 0 0 3px ${color}, 0 0 24px ${color}66`;
        if (++count < 2) setTimeout(flash, 250);
      }, 180);
    };
    flash();
  }

  // 4. popup กลางจอใหญ่ชัดเจน
  let popup = document.getElementById('my-turn-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'my-turn-popup';
    document.body.appendChild(popup);
  }
  popup.style.cssText = [
    'position:fixed;top:44%;left:50%;transform:translate(-50%,-50%)',
    'font-family:"Fredoka One","Mitr",cursive;font-size:2.4rem;font-weight:900',
    `color:${color};pointer-events:none;z-index:950`,
    `text-shadow:0 0 40px ${color}, 0 0 80px ${color}88, 0 4px 0 rgba(0,0,0,0.4)`,
    'opacity:0;',
  ].join(';');
  popup.textContent = '🎯 ตาคุณแล้ว!';
  popup.style.animation = 'none';
  popup.offsetWidth;
  popup.style.animation = 'myTurnPop 1.4s cubic-bezier(.34,1.56,.64,1) forwards';

  // 5. flash หน้าจอเล็กน้อย
  const flash = document.createElement('div');
  flash.style.cssText = `position:fixed;inset:0;background:${color}18;pointer-events:none;z-index:940;animation:myTurnFlash 0.5s ease-out forwards;`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
}

(function() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes myTurnPop {
      0%   { opacity:0; transform:translate(-50%,-50%) scale(0.3); filter:blur(10px); }
      25%  { opacity:1; filter:blur(0); transform:translate(-50%,-50%) scale(1.2); }
      55%  { transform:translate(-50%,-50%) scale(0.95); }
      75%  { opacity:1; transform:translate(-50%,-50%) scale(1.05); }
      100% { opacity:0; transform:translate(-50%,-68%) scale(0.85); }
    }
    @keyframes myTurnFlash {
      0%   { opacity:1; }
      100% { opacity:0; }
    }
  `;
  document.head.appendChild(style);
})();

// ══ ตาใหม่เริ่มหลังเอฟเฟกต์จบ ══
// คิวเอฟเฟกต์ (fxRun) เรียกเมื่อเอฟเฟกต์ของ update ล่าสุดเล่นจบและกระดานซิงก์แล้ว: เสียง / popup / ตัวนับเวลา
function announceTurn(room) {
  if (!onlineMode || !room || !room.state || room.phase !== 'playing') return;
  if (room.state.current === mySlot) {
    // นาฬิกาอยู่ที่ server: แสดงเวลาที่เหลือจริง (หักเวลาที่ใช้เล่นเอฟเฟกต์ไปแล้ว) — หมดเวลาแล้วส่ง place_timeout เป็นแค่ hint
    const left = room.turnEndsIn != null ? Math.ceil((room._at + room.turnEndsIn - Date.now()) / 1000) : TURN_LIMIT;
    startCountdown(Math.max(1, left), '#5bc4e0', () => { socket.emit('place_timeout', {}, () => {}); });
    notifyMyTurn(room.code + ':' + (room.state.turnCount || 0));
  } else {
    // เสียงเปลี่ยนเทิร์นสำหรับตาคนอื่น (เบา, โน้ตประจำตัวของคนนั้น) — ครั้งเดียวต่อเทิร์น
    const otherKey = room.code + ':' + (room.state.turnCount || 0) + ':' + room.state.current;
    if (_lastOtherTurn !== otherKey) { _lastOtherTurn = otherKey; SFX.turnChange(room.state.current); }
  }
}
// กลับเข้าที่นั่งเดิมด้วย token (เรียกทุกครั้งที่ socket ต่อติด ถ้ามีที่นั่งค้างอยู่)
function tryRejoin(s) {
  const silent = !session; // ลองตอนเปิดหน้า (ยังไม่ได้อยู่ในห้อง): ไม่ได้ก็เงียบๆ
  socket.emit('rejoin_room', { code: s.code, token: s.token, takeover: s.takeover !== false }, res => {
    if (res && res.ok) {
      saveSession({ code: res.code, token: res.token });
      mySlot = res.slot; isHost = !!res.isHost;
      _resyncNext = true; // update ที่ตามมาคือ state ล่าสุดทั้งก้อน: ล้างคิวแล้วซิงก์ตรงๆ
      setNetBanner(false);
      if (res.phase === 'lobby') { onlineMode = false; enterLobby(); }
      else if (!(onlineMode && document.getElementById('game-screen').style.display === 'flex')) _enterGame = true;
      showToast(silent ? `↩️ กลับเข้าห้อง ${res.code}` : '✅ เชื่อมต่อแล้ว — กลับเข้าห้องเดิม');
      return;
    }
    if (res && res.busy && silent) return; // ที่นั่งนั้นมีแท็บอื่นเล่นอยู่ — ไม่ยุ่ง
    // ห้อง/ที่นั่งไม่อยู่แล้วจริงๆ
    const wasIn = !!session;
    clearSession(); setNetBanner(false);
    if (wasIn) handleServerReset();
  });
}
let _pillsReady = false;
function enterLobby() {
  document.getElementById('game-screen').style.display = 'none';
  showScreen('room-screen');
  if (!_pillsReady) { _pillsReady = true; setupRoomPills(); }
  renderCardFilter();
}

// มี backend ให้ต่อไหม: socket.io (server ของเกม) หรือ Firebase (ตั้งค่าไว้ใน fb-config.js)
function hasBackend() {
  return typeof io === 'function' || (typeof window.CRFirebaseAvailable === 'function' && window.CRFirebaseAvailable());
}

function initSocket() {
  // socket เดียวตลอด (ของเดิมสร้างใหม่ทุกครั้งที่ยังต่อไม่ติด → handler ซ้อนกัน)
  if (socket) { if (!socket.connected) socket.connect(); return; }
  // มี socket.io (เปิดเกมจาก server ของเกม) ใช้ตัวนั้น · ไม่มี (เช่น GitHub Pages) ใช้โหมด Firebase จาก fb-transport.js
  socket = (typeof io === 'function' && !window.CR_FORCE_FIREBASE)
    ? io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 })
    : window.CRFirebaseIO({ autoConnect: true });

  socket.on('connect', () => {
    console.log('[online] connected:', socket.id);
    const s = session ? { ...session, takeover: true } : storedSession();
    if (s) tryRejoin(s); else setNetBanner(false);
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect' || !session) return;
    // หลุดการเชื่อมต่อ: ที่นั่งยังอยู่ที่ server — socket.io จะต่อใหม่เอง แล้ว 'connect' ข้างบนจะพากลับเข้าห้อง
    clearAllTimers();
    setNetBanner(true);
  });
  // เปิดเกมนี้ (ที่นั่งเดียวกัน) ในแท็บอื่น
  socket.on('session_replaced', () => {
    session = null; try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
    fxReset(); clearAllTimers(); closeGroupPickOverlay(); setNetBanner(false);
    onlineMode = false; mySlot = -1; isHost = false; myHand = [];
    if (STATE) STATE._dead = true;
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('winner-overlay').classList.remove('show');
    showScreen('main-menu');
    showToast('ที่นั่งนี้ถูกเปิดในแท็บอื่นแล้ว');
  });
  socket.on('turn_skipped', ({ playerIdx, reason }) => {
    if (!onlineMode) return;
    const who = playerIdx === mySlot ? 'คุณ' : getPlayerName(playerIdx);
    showToast(reason === 'forfeit' ? `🔮 ${who} ไม่ได้ใช้ Rebirth ทันเวลา — เสียสิทธิ์คืนชีพ`
      : reason === 'disconnected' ? `⏭️ ${who} หลุดการเชื่อมต่อ — ข้ามตา` : `⏰ ${who} หมดเวลา — ข้ามตา`);
  });
  // server ปิดห้องรอที่ไม่มีความเคลื่อนไหวนานเกินไป
  socket.on('room_closed', (info) => {
    fxReset(); clearAllTimers(); closeGroupPickOverlay(); clearSession(); setNetBanner(false);
    onlineMode = false; mySlot = -1; isHost = false; currentRoom = null; myHand = [];
    document.getElementById('game-screen').style.display = 'none';
    showScreen('main-menu');
    showToast(info && info.reason === 'host_left' ? '🚪 โฮสต์ออกจากเกมแล้ว ห้องนี้ถูกปิด' : '⌛ ห้องถูกปิดเพราะไม่มีความเคลื่อนไหว');
  });

  socket.on('room_update', (room) => {
    room._at = Date.now(); // เวลาที่ได้รับ — ใช้คำนวณเวลาที่เหลือของตา (turnEndsIn)
    currentRoom = room;
    // slot และสถานะ host ของเรา: เชื่อ server ทุกครั้ง (ของเดิมจำจากตอน join แล้วคลาดเมื่อมีคนออกจาก lobby)
    if (room.you) { mySlot = room.you.slot; isHost = !!room.you.isHost; }
    const me = room.members && room.members.find(m => m.slot === mySlot);
    if (me && me.name) myName = me.name;

    if ((room.phase === 'playing' || room.phase === 'group_pick' || room.phase === 'finished') && room.state) {
      // เข้าหน้าเกม: มาจากห้องรอ หรือเพิ่ง rejoin กลับมา (รีเฟรช/เปิดแท็บใหม่)
      const wasInRoom = document.getElementById('room-screen').classList.contains('active') || _enterGame;
      const resync = wasInRoom || _resyncNext; // เข้าเกม / เพิ่ง rejoin: ไม่เล่นเอฟเฟกต์ย้อนหลัง
      _enterGame = false; _resyncNext = false;
      if (wasInRoom) {
        showScreen('room-screen'); // ซ่อนเมนู/หน้าอื่นให้หมดก่อน (กรณีกลับเข้ามาจากหน้าเมนู)
        document.getElementById('room-screen').classList.remove('active');
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
        onlineMode = true;
        STATE._dead = false;
      }
      if (onlineMode) {
        // reset animating ทุกครั้ง
        animating = false;
        document.getElementById('blocker').classList.remove('on');

        // อัปเดตชื่อผู้เล่นจาก room members
        if (window.PLAYER_NAMES && room.members) {
          room.members.forEach(m => {
            if (m.name) window.PLAYER_NAMES[m.slot] = m.name;
          });
        }

        // ปกติ: ต่อคิวเอฟเฟกต์ (เล่นตามลำดับ ไม่ข้าม) · เข้าเกม / rejoin: ล้างคิวแล้วซิงก์ตรงไปที่ state นี้
        if (resync) fxReset();
        fxEnqueue({ type: 'update', room, instant: resync });
      }
    } else if (room.phase === 'lobby') {
      // อัปเดตชื่อในห้องรอด้วย
      if (window.PLAYER_NAMES && room.members) {
        room.members.forEach(m => {
          if (m.name) window.PLAYER_NAMES[m.slot] = m.name;
        });
      }
      // Sync roomCfg from server to keep local state accurate
      if (room.cfg) {
        roomCfg.mapSize = room.cfg.mapSize || 8;
        roomCfg.mapCols = room.cfg.mapCols || room.cfg.mapSize || 8;
        roomCfg.cardInterval = room.cfg.cardInterval ?? 2;
        // Sync disabled cards (for non-host to see)
        if (isHost && room.cfg.disabledCards) {
          disabledCards = new Set(room.cfg.disabledCards);
          renderCardFilter();
        }
      }
      renderRoomScreen(room);
    }
  });

  // ── Group pick ──
  // เข้าคิวเดียวกับ room_update: หน้าเลือกการ์ดจึงขึ้นหลังเอฟเฟกต์ของตาที่มาก่อนเล่นจบเสมอ
  socket.on('group_pick_start', ({ cards, handSize, timeLimit }) => {
    if (!onlineMode) return;
    fxEnqueue({ type: 'pick', cards, handSize, timeLimit, at: Date.now() });
  });

  socket.on('group_pick_progress', ({ done, total }) => {
    const prog = document.getElementById('gp-prog-row');
    if (prog) {
      const already = prog.textContent.includes('✅') || prog.textContent.includes('⏭️') || prog.textContent.includes('⏰');
      if (!already) prog.textContent = `รอผู้เล่นอื่น... (${done}/${total})`;
      else prog.textContent = prog.textContent.replace(/\(.*\)/, '') + ` (${done}/${total})`;
    }
  });

  // ── Hand ──
  socket.on('your_hand', ({ slot, hand }) => {
    if (slot === mySlot) {
      myHand = hand;
      if (onlineMode && STATE.hands) {
        STATE.hands[mySlot] = hand;
        renderHandBar();
        renderScoreboard();
      }
    }
  });

  // ── VFX ──
  // card_vfx / place_vfx / frozen_cancel: server ยังส่งตามเดิม แต่ข้อมูลเดียวกันมากับ room_update แล้ว (state.last)
  // คิวเอฟเฟกต์เล่นจากตรงนั้น จึงไม่ขึ้นกับว่า event ไหนมาถึงก่อน (โหมด Firebase อาจหน่วง)

  // ── Game over ──
  // เก็บไว้เฉยๆ: หน้าผู้ชนะเปิดโดยงานในคิวที่มี phase = finished หลังลูกโซ่ครบทุก wave + อนุภาคนิ่งแล้วเท่านั้น
  socket.on('game_over', (payload) => { _gameOver = payload; });

  socket.on('you_are_host', () => {
    isHost = true;
    showToast('👑 คุณเป็น host แล้ว');
    if (currentRoom) renderRoomScreen(currentRoom);
  });
}

function syncStateFromServer(serverState) {
  if (!serverState) return;
  // Reset any visual fades from card VFX
  document.querySelectorAll('.cell[style*="opacity"]').forEach(el => {
    el.style.transition = '';
    el.style.opacity = '';
  });
  cfg.mapSize = serverState.rows || serverState.size || 8;
  cfg.mapCols = serverState.cols || cfg.mapSize;
  cfg.players = serverState.players;

  STATE.size    = serverState.rows || serverState.size;
  STATE.rows    = STATE.size; // alias
  STATE.cols    = serverState.cols || STATE.size;
  STATE.players = serverState.players;
  STATE.current = serverState.current;
  STATE.turnCount = serverState.turnCount || 0;
  STATE.alive   = serverState.alive;
  STATE.moved   = serverState.moved;
  STATE.scores  = serverState.scores;
  // สำเนา: เอฟเฟกต์ (wave / VFX การ์ด) แก้ STATE.cells ระหว่างเล่น — ต้องไม่ไปแก้ state ที่ server ส่งมาซึ่งยังรอซิงก์อยู่ในคิว
  STATE.cells   = serverState.cells.map(row => row.map(cell => ({ ...cell })));
  STATE.shielded    = serverState.shielded;
  STATE.shieldOwner = serverState.shieldOwner;
  STATE.timeBombs   = serverState.timeBombs || [];
  STATE.frozen      = serverState.frozen || [];
  STATE.eclipse     = serverState.eclipse || 0;
  STATE.voidCells   = serverState.voidCells || {};
  STATE.severed     = serverState.severed || {};
  STATE.pinned      = serverState.pinned || {};
  STATE.phase       = serverState.phase || 'playing';
  STATE.winner      = serverState.winner ?? -1;
  STATE.legendaryUsedBy = serverState.legendaryUsedBy || [];
  STATE.mythicalUsedBy  = serverState.mythicalUsedBy || [];
  STATE._cellSize = null; STATE._gridSize = null;

  if (!STATE.hands || STATE.hands.length !== STATE.players) {
    STATE.hands = Array.from({ length: STATE.players }, () => []);
  }
  STATE.hands[mySlot] = myHand;
}

// ผลของการ์ดที่ส่งให้เราคนเดียว (ไม่ได้ broadcast) — ตอนนี้มี Scout: รายชื่อการ์ดในมือของผู้เล่นที่สุ่มได้
function cardResult(res) {
  if (!res || !res.scout) return;
  const who = getPlayerName(res.scout.player);
  const cards = (res.scout.cards || []).map(c => `${c.emoji || ''} ${c.name}`.trim());
  showToast(`🔍 ${who}: ${cards.length ? cards.join(' · ') : 'ไม่มีการ์ดในมือ'}`);
}

// ── Cell click (online) ──
function onlineCellClick(r, c) {
  if (!onlineMode || !socket) return false;
  if (!socket.connected) { showToast('⚠️ กำลังเชื่อมต่อใหม่…'); return true; } // socket.io จะ buffer คำสั่งไว้ส่งทีหลัง — ไม่เอา
  if (STATE.current !== mySlot) { showToast('⏳ ยังไม่ถึงตาคุณ'); return true; }
  if (currentRoom && currentRoom.phase === 'group_pick') { showToast('🎴 กำลังเลือกการ์ดอยู่'); return true; }
  if (isSettling()) return true; // เอฟเฟกต์ของตาก่อนหน้ายังเล่นไม่จบ

  if (selectedHandCard) {
    const { playerIdx, cardIdx } = selectedHandCard;
    // find by id (reliable) หรือ index เป็น fallback
    let cardDef = (selectedHandCard.cardId
      ? STATE.hands[playerIdx]?.find(d => d.id === selectedHandCard.cardId)
      : null) || STATE.hands[playerIdx]?.[cardIdx];
    // อัปเดต cardIdx ให้ตรงกับ index จริงปัจจุบัน
    const realIdx = cardDef ? STATE.hands[playerIdx].indexOf(cardDef) : cardIdx;
    if (cardDef) {
      if (cardDef.twoTarget && !targetData.r1Done) {
        const v1 = window.CRLogic.validateTargets(STATE, cardDef, mySlot, { r, c }, { partial: true });
        if (!v1.ok) { showToast('❌ ' + v1.msg); return true; }
        targetData = { r1: r, c1: c, r1Done: true, playerIdx, cardIdx: realIdx, cardDef };
        document.getElementById('target-text').textContent = `✅ ช่อง 1 แล้ว — เลือกช่องที่ 2`;
        renderGridHighlight();
        return true;
      }
      if (cardDef.twoTarget && targetData.r1Done) {
        const v2 = window.CRLogic.validateTargets(STATE, cardDef, mySlot, { r: targetData.r1, c: targetData.c1, r2: r, c2: c });
        if (!v2.ok) { showToast('❌ ' + v2.msg); return true; }
        selectedHandCard = null;
        document.getElementById('target-banner').classList.remove('show');
        clearAllTimers();
        socket.emit('use_card', { cardId: cardDef.id, targets: { r: targetData.r1, c: targetData.c1, r2: r, c2: c } }, res => {
          if (!res?.ok) {
        if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
        else showToast(res?.msg || 'ใช้การ์ดไม่ได้');
      } else cardResult(res);
        });
        targetData = {}; renderGridHighlight();
        return true;
      }
      const v = window.CRLogic.validateTargets(STATE, cardDef, mySlot, { r, c });
      if (!v.ok) { showToast('❌ ' + v.msg); return true; }
      selectedHandCard = null;
      document.getElementById('target-banner').classList.remove('show');
      clearAllTimers();
      socket.emit('use_card', { cardId: cardDef.id, targets: { r, c } }, res => {
        if (!res?.ok) {
        if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
        else showToast(res?.msg || 'ใช้การ์ดไม่ได้');
      } else cardResult(res);
      });
      renderGridHighlight();
      return true;
    }
  }

  if (STATE.moved[mySlot]) { showToast('❌ ใช้ action ไปแล้ว'); return true; }
  clearAllTimers();
  socket.emit('place', { r, c }, res => {
    if (!res?.ok) {
      if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
      else showToast(res?.msg || 'วางไม่ได้');
    }
  });
  return true;
}

function onlineActivateCard(pi, ci, cardDef) {
  if (!onlineMode || !socket) return false;
  if (!socket.connected) { showToast('⚠️ กำลังเชื่อมต่อใหม่…'); return true; }
  if (pi !== mySlot) { showToast('❌ ไม่ใช่การ์ดของคุณ'); return true; }
  if (STATE.current !== mySlot) { showToast('⏳ ยังไม่ถึงตาของคุณ'); return true; }
  if (currentRoom && currentRoom.phase === 'group_pick') { showToast('🎴 กำลังเลือกการ์ดอยู่'); return true; }
  if (isSettling()) return true;
  // anyTarget และ !needTarget → ใช้ทันที ไม่ต้องรอ click
  if ((!cardDef.needTarget || cardDef.anyTarget) && cardDef.id !== 'e4') {
    selectedHandCard = null;
    clearAllTimers();
    socket.emit('use_card', { cardId: cardDef.id, targets: {} }, res => {
      if (!res?.ok) {
        if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
        else showToast(res?.msg || 'ใช้การ์ดไม่ได้');
      } else cardResult(res);
    });
    return true;
  }
  return false;
}

// ── Render hand bar (show player name on cards) ──
function onlineRenderHandBar() {
  if (!onlineMode) return false;
  const bar = document.getElementById('hand-bar');
  if (!bar) return false;
  bar.innerHTML = '';
  const hand = myHand || [];
  const isMyTurn = STATE.current === mySlot;

  const cardsRow = document.createElement('div');
  cardsRow.id = 'hand-bar-cards';

  // แสดงชื่อผู้เล่น
  const nameTag = document.createElement('div');
  const color = PLAYER_COLORS_O[mySlot] || '#fff';
  nameTag.style.cssText = [
    `background:${color}22;border:2px solid ${color}88`,
    'border-radius:999px;padding:3px 14px',
    'font-family:"Fredoka One","Mitr",cursive',
    `font-size:.78rem;color:${color}`,
    'white-space:nowrap;flex-shrink:0;align-self:center',
    'text-shadow:0 0 8px ' + color + '66',
  ].join(';');
  nameTag.textContent = myName || `P${mySlot + 1}`;
  cardsRow.appendChild(nameTag);

  if (hand.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:rgba(255,255,255,0.4);font-size:.82rem;font-family:"Fredoka One","Mitr",cursive;padding:8px 0;';
    empty.textContent = '🎴 ไม่มีการ์ดในมือ';
    cardsRow.appendChild(empty);
    bar.appendChild(cardsRow);
    return true;
  }

  const RARITY_COLORS = {common:'r-common',uncommon:'r-uncommon',rare:'r-rare',super_rare:'r-super-rare',epic:'r-epic',legendary:'r-legendary',mythical:'r-mythical'};
  const RARITY_LABEL  = {common:'Common',uncommon:'Uncommon',rare:'Rare',super_rare:'Super Rare',epic:'Epic',legendary:'✨ Legendary',mythical:'🌌 Mythical'};

  hand.forEach((cardDef, ci) => {
    const isSel = selectedHandCard?.playerIdx === mySlot && selectedHandCard?.cardIdx === ci;
    const el = document.createElement('div');
    el.className = 'hand-card' + (isSel ? ' selected-card' : '');
    el.style.animationDelay = (ci * 0.07) + 's';
    const hint = cardDef.anyTarget || cardDef.rebirthOnly ? '👆 กดช่องบนกระดาน' : cardDef.needTarget ? '👆 กดช่องบนกระดาน' : '▶ กดอีกครั้งเพื่อใช้';
    el.innerHTML = `
      <span class="card-emoji">${cardDef.emoji}</span>
      <span class="card-name">${cardDef.name}</span>
      <span class="card-rarity-badge ${RARITY_COLORS[cardDef.rarity]}">${RARITY_LABEL[cardDef.rarity]}</span>
      <span class="card-desc">${cardDef.desc}</span>
      <div class="use-hint">${hint}</div>
    `;
    if (isMyTurn) {
      el.addEventListener('click', e => {
        if (e.target.closest('.use-hint')) return;
        onHandCardClick(mySlot, ci, cardDef);
      });
      el.querySelector('.use-hint').addEventListener('click', e => {
        e.stopPropagation();
        onHandCardClick(mySlot, ci, cardDef);
        if (!cardDef.needTarget && !cardDef.anyTarget && !cardDef.rebirthOnly) {
          activateCard(mySlot, ci, cardDef);
        }
      });
    } else {
      el.style.opacity = '0.55';
      el.style.cursor = 'default';
    }
    cardsRow.appendChild(el);
  });
  bar.appendChild(cardsRow);
  return true;
}

// ── Room screen ──
function renderRoomScreen(room) {
  if (!room) return;
  document.getElementById('room-code-display').textContent = room.code;
  document.getElementById('room-code-big').textContent = room.code;

  // รายชื่อผู้เล่น — สร้างด้วย DOM + textContent เท่านั้น (ชื่อมาจากผู้เล่นคนอื่น ห้ามประกอบเป็น HTML)
  const list = document.getElementById('room-members-list');
  list.innerHTML = '';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  room.members.forEach((m, i) => {
    const row = mk('div', 'lm-row' + (m.connected ? '' : ' off'));
    row.style.animationDelay = (i * 0.05) + 's';
    const orb = mk('div', 'lm-orb'); orb.style.setProperty('--c', PLAYER_COLORS_O[m.slot] || '#fff');
    row.appendChild(orb);
    row.appendChild(mk('span', 'lm-name', m.name));
    if (m.slot === mySlot) row.appendChild(mk('span', 'lm-chip you', 'คุณ'));
    if (m.isHost) row.appendChild(mk('span', 'lm-chip host', '👑 Host'));
    row.appendChild(mk('span', 'lm-stat', m.connected ? 'ออนไลน์' : 'หลุด…'));
    list.appendChild(row);
  });
  if (room.members.length < 6) list.appendChild(mk('div', 'lm-row empty', room.members.length < 2 ? 'รอเพื่อนเข้าห้อง…' : 'ยังเข้าได้อีก ' + (6 - room.members.length) + ' คน'));
  const count = document.getElementById('room-count');
  if (count) count.textContent = room.members.length + '/6';

  // สรุปการตั้งค่า (ทุกคนเห็น — ของเดิมคนที่ไม่ใช่ host ไม่รู้เลยว่าจะเล่นแมพอะไร)
  const cfg2 = room.cfg || {};
  const rows = cfg2.mapSize || 8, cols = cfg2.mapCols || rows, iv = cfg2.cardInterval ?? 2;
  const total = (window.CARD_DEFS || (typeof CARD_DEFS !== 'undefined' ? CARD_DEFS : [])).length, off = (cfg2.disabledCards || []).length;
  const sum = document.getElementById('room-summary');
  if (sum) sum.textContent = `แมพ ${rows}×${cols} · ` + (iv > 0 ? `ได้การ์ดทุก ${iv} เทิร์น` : 'ไม่ใช้การ์ด') + (iv > 0 && off ? ` · เปิดการ์ด ${total - off}/${total} ใบ` : '');
  // ปุ่มตัวเลือกของ host ตรงกับค่าจริงของห้องเสมอ (เช่น หลังรีเฟรชแล้วกลับเข้าห้อง)
  document.querySelectorAll('#room-map-pills .pill').forEach(p => p.classList.toggle('active', rows === cols && +p.dataset.val === rows));
  document.querySelectorAll('#room-map-rect-pills .pill').forEach(p => p.classList.toggle('active', rows !== cols && +p.dataset.rows === rows && +p.dataset.cols === cols));
  document.querySelectorAll('#room-card-pills .pill').forEach(p => p.classList.toggle('active', +p.dataset.val === iv));

  const hostPanel = document.getElementById('host-cfg-panel');
  const startBtn  = document.getElementById('btn-start-online');
  const waitMsg   = document.getElementById('waiting-msg');
  const hint      = document.getElementById('start-hint');
  const ready     = room.members.filter(m => m.connected).length >= 2;
  if (isHost) {
    hostPanel.style.display = 'block';
    startBtn.style.display  = 'flex';
    startBtn.disabled       = !ready;
    waitMsg.style.display   = 'none';
    if (hint) hint.textContent = ready ? '' : 'ต้องมีผู้เล่นอย่างน้อย 2 คนจึงจะเริ่มได้';
  } else {
    hostPanel.style.display = 'none';
    startBtn.style.display  = 'none';
    waitMsg.style.display   = 'block';
    if (hint) hint.textContent = '';
  }
}

// คัดลอกรหัสห้อง — clipboard API ใช้ไม่ได้ใน http ธรรมดา/บางเบราว์เซอร์ จึงมีทางสำรอง
function copyRoomCode() {
  const code = document.getElementById('room-code-big').textContent.trim();
  const done = (ok) => {
    const b = document.getElementById('btn-copy-code'), l = document.getElementById('copy-label');
    if (!ok) { showToast('คัดลอกไม่ได้ — จดรหัส ' + code); return; }
    if (b && l) { b.classList.add('done'); l.textContent = 'คัดลอกแล้ว ✓'; clearTimeout(copyRoomCode._t); copyRoomCode._t = setTimeout(() => { b.classList.remove('done'); l.textContent = 'คัดลอกรหัส'; }, 1600); }
  };
  const fallback = () => {
    try {
      const t = document.createElement('textarea'); t.value = code; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); done(ok);
    } catch (e) { done(false); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => done(true), fallback);
  else fallback();
}

// ── Card Filter ──
const RARITY_ORDER = ['common','uncommon','rare','super_rare','epic','legendary','mythical'];
const RARITY_LABELS = {
  common:'⬜ Common', uncommon:'🟦 Uncommon', rare:'🟩 Rare',
  super_rare:'🟧 Super Rare', epic:'🟥 Epic', legendary:'🟨 Legendary', mythical:'🌟 Mythical'
};

let disabledCards = new Set();

function openCardFilter() {
  renderCardFilter();
  document.getElementById('card-filter-overlay').style.display = 'flex';
}

function closeCardFilter() {
  document.getElementById('card-filter-overlay').style.display = 'none';
}

function renderCardFilter() {
  const list = document.getElementById('card-filter-list');
  if (!list) return;

  // ดึง CARD_DEFS จาก gameLogic ที่โหลดใน index.html
  const cards = (typeof CARD_DEFS !== 'undefined' ? CARD_DEFS : null)
    || window.CARD_DEFS || [];

  if (!cards.length) {
    list.innerHTML = '<div style="text-align:center;opacity:.5;padding:20px;">โหลดข้อมูลการ์ดไม่สำเร็จ</div>';
    return;
  }

  const groups = {};
  RARITY_ORDER.forEach(r => groups[r] = []);
  cards.forEach(c => { if (groups[c.rarity]) groups[c.rarity].push(c); });

  list.innerHTML = '';
  RARITY_ORDER.forEach(rarity => {
    const group = groups[rarity];
    if (!group.length) return;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'card-filter-group';

    // Header ของกลุ่ม + toggle ทั้งกลุ่ม
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
    const labelEl = document.createElement('div');
    labelEl.className = 'card-filter-group-label';
    labelEl.textContent = RARITY_LABELS[rarity];
    const allOnBtn = document.createElement('button');
    allOnBtn.textContent = 'เปิดทั้งกลุ่ม';
    allOnBtn.style.cssText = 'font-size:.6rem;padding:2px 8px;border-radius:999px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;';
    allOnBtn.onclick = () => {
      group.forEach(c => disabledCards.delete(c.id));
      renderCardFilter(); updateCardFilterSummary(); emitCardFilter();
    };
    const allOffBtn = document.createElement('button');
    allOffBtn.textContent = 'ปิดทั้งกลุ่ม';
    allOffBtn.style.cssText = 'font-size:.6rem;padding:2px 8px;border-radius:999px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;margin-left:4px;';
    allOffBtn.onclick = () => {
      group.forEach(c => disabledCards.add(c.id));
      renderCardFilter(); updateCardFilterSummary(); emitCardFilter();
    };
    headerDiv.appendChild(labelEl);
    const btnWrap = document.createElement('div');
    btnWrap.appendChild(allOnBtn); btnWrap.appendChild(allOffBtn);
    headerDiv.appendChild(btnWrap);
    groupDiv.appendChild(headerDiv);

    group.forEach(card => {
      const row = document.createElement('label');
      row.className = 'card-filter-row';
      const enabled = !disabledCards.has(card.id);
      row.innerHTML = `
        <input type="checkbox" ${enabled ? 'checked' : ''} data-card="${card.id}">
        <span class="card-filter-emoji">${card.emoji}</span>
        <span class="card-filter-name">${card.name}</span>
        <span class="card-filter-desc">${card.desc}</span>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) disabledCards.delete(card.id);
        else disabledCards.add(card.id);
        updateCardFilterSummary();
        emitCardFilter();
      });
      groupDiv.appendChild(row);
    });

    list.appendChild(groupDiv);
  });
}

function updateCardFilterSummary() {
  const el = document.getElementById('card-filter-summary');
  if (!el) return;
  const total = (window.CARD_DEFS || []).length;
  const disabled = disabledCards.size;
  if (disabled === 0) el.textContent = `การ์ดทั้งหมด (เปิดทั้งหมด)`;
  else if (disabled === total) el.textContent = `ไม่มีการ์ด (ปิดทั้งหมด)`;
  else el.textContent = `เปิด ${total - disabled}/${total} ใบ`;
}

function setAllCards(enable) {
  if (enable) disabledCards.clear();
  else { (window.CARD_DEFS || []).forEach(c => disabledCards.add(c.id)); }
  renderCardFilter();
  updateCardFilterSummary();
  emitCardFilter();
}

function emitCardFilter() {
  socket.emit('update_cfg', { cfg: { disabledCards: [...disabledCards] } });
}

function setupRoomPills() {
  document.getElementById('room-map-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#room-map-pills .pill, #room-map-rect-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const size = parseInt(p.dataset.val);
      roomCfg.mapSize = size;
      roomCfg.mapCols = size;
      socket.emit('update_cfg', { cfg: { mapSize: size, mapCols: size } });
    });
  });
  document.getElementById('room-map-rect-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#room-map-pills .pill, #room-map-rect-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const rows = parseInt(p.dataset.rows);
      const cols = parseInt(p.dataset.cols);
      roomCfg.mapSize = rows;
      roomCfg.mapCols = cols;
      console.log('[rect] selected', rows, 'x', cols);
      socket.emit('update_cfg', { cfg: { mapSize: rows, mapCols: cols } });
    });
  });
  document.getElementById('room-card-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.getElementById('room-card-pills').querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      roomCfg.cardInterval = parseInt(p.dataset.val);
      socket.emit('update_cfg', { cfg: { cardInterval: roomCfg.cardInterval } });
    });
  });
}

// ── Event bindings ──
document.getElementById('btn-online').addEventListener('click', () => {
  if (!hasBackend()) { showToast('🌐 ยังไม่ได้ตั้งค่าออนไลน์ (ต้องรัน npm start หรือใส่ค่า Firebase ใน fb-config.js)'); return; }
  initSocket();
  // reset any stuck state from local game
  if (typeof animating !== 'undefined') animating = false;
  const blocker = document.getElementById('blocker');
  if (blocker) blocker.classList.remove('on');
  showScreen('online-screen');
  SFX.select && SFX.select();
});

let _createRetry = 0;
document.getElementById('btn-create-room').addEventListener('click', () => {
  myName = document.getElementById('online-name').value.trim() || 'ผู้เล่น';
  if (!socket?.connected) {
    // ยังต่อไม่ติด: ลองใหม่เอง — มีตัวจับเวลาได้ทีละตัว และเลิกลองถ้าออกจากหน้านี้ไปแล้ว
    // (ของเดิมกดกี่ครั้งก็ตั้งเวลาซ้อนกันเท่านั้น → create_room ถูกยิงซ้ำทีหลัง ทั้งที่เข้าห้อง/เริ่มเกมไปแล้ว แล้วหลุดออกจากห้องตัวเอง)
    showToast('กำลังเชื่อมต่อ...'); initSocket();
    clearTimeout(_createRetry);
    _createRetry = setTimeout(() => { if (document.getElementById('online-screen').classList.contains('active')) document.getElementById('btn-create-room').click(); }, 1500);
    return;
  }
  clearTimeout(_createRetry);
  socket.emit('create_room', { name: myName, cfg: roomCfg }, res => {
    if (!res?.ok) return showToast(res?.msg || 'เกิดข้อผิดพลาด');
    mySlot = res.slot; isHost = true; myHand = [];
    if (res.token) saveSession({ code: res.code, token: res.token });
    // โหมด Firebase: ห้องรันอยู่ในแท็บของคนสร้าง — บอกให้รู้ตัวตั้งแต่แรก
    if (typeof io !== 'function' || window.CR_FORCE_FIREBASE) showToast('📡 แท็บนี้คือเซิร์ฟเวอร์ของห้อง — อย่าปิดหรือรีเฟรชระหว่างเล่น');
    document.getElementById('online-screen').classList.remove('active');
    enterLobby();
  });
});

// แท็บ สร้างห้อง / เข้าห้อง: index.html (setOnlineTab) เป็นคนสลับ

document.getElementById('btn-confirm-join').addEventListener('click', () => {
  myName = document.getElementById('online-name').value.trim() || 'ผู้เล่น';
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (code.length !== 4) return showToast('ใส่รหัส 4 ตัว');
  if (!socket?.connected) { showToast('กำลังเชื่อมต่อ...'); return; }
  socket.emit('join_room', { code, name: myName }, res => {
    if (!res?.ok) return showToast(res?.msg || 'เข้าไม่ได้');
    mySlot = res.slot; isHost = false; myHand = [];
    if (res.token) saveSession({ code: res.code, token: res.token });
    document.getElementById('online-screen').classList.remove('active');
    enterLobby();
  });
});

document.getElementById('room-code-big').addEventListener('click', copyRoomCode);
document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);

document.getElementById('btn-start-online').addEventListener('click', () => {
  if (!isHost) return showToast('ไม่ใช่ host');
  socket.emit('start_game', res => { if (!res?.ok) showToast(res?.msg || 'เริ่มเกมไม่ได้'); });
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  fxReset(); clearAllTimers(); closeGroupPickOverlay();
  socket?.emit('leave_room');
  clearSession();
  onlineMode = false; mySlot = -1; isHost = false; currentRoom = null; myHand = [];
  STATE._dead = true;
  document.getElementById('game-screen').style.display = 'none';
  showScreen('main-menu');
});

document.getElementById('winner-replay').addEventListener('click', () => {
  if (!onlineMode) return;
  if (!isHost) { showToast('เฉพาะ host เท่านั้น'); return; }
  clearAllTimers(); closeGroupPickOverlay();
  socket.emit('restart_game', res => { if (!res?.ok) showToast(res?.msg || 'รีสตาร์ทไม่ได้'); });
  document.getElementById('winner-overlay').classList.remove('show');
}, true);

document.getElementById('winner-menu').addEventListener('click', () => {
  if (!onlineMode) return;
  fxReset(); clearAllTimers(); closeGroupPickOverlay();
  socket?.emit('leave_room');
  clearSession();
  onlineMode = false; mySlot = -1; isHost = false; myHand = [];
  STATE._dead = true;
  document.getElementById('game-screen').style.display = 'none';
  document.getElementById('winner-overlay').classList.remove('show');
  showScreen('main-menu');
}, true);

// renderHandBar handled in index.html directly

// เปิดหน้ามาแล้วมีที่นั่งค้างอยู่ (รีเฟรช / ปิดแท็บแล้วเปิดใหม่): ต่อ socket แล้วลองกลับเข้าห้องเดิมเอง
if (hasBackend() && storedSession()) initSocket();

window._onlineCellClick    = onlineCellClick;
window.openCardFilter      = openCardFilter;
window.closeCardFilter     = closeCardFilter;
window.setAllCards         = setAllCards;
window._getRoomMembers     = () => currentRoom?.members || [];
window._onlineActivateCard = onlineActivateCard;
window._getOnlineMode      = () => onlineMode;
window._getMySlot          = () => mySlot;

})();
