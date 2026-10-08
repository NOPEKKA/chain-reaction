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
    el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:1100;background:rgba(40,16,16,.94);color:#fff;border:1px solid rgba(255,140,120,.6);border-radius:999px;padding:8px 18px;font-family:"Fredoka One",cursive;font-size:.9rem;box-shadow:0 8px 24px rgba(0,0,0,.4);white-space:nowrap;';
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
      'font-family:"Fredoka One",cursive;font-size:1.4rem;font-weight:900',
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
    <div style="font-family:'Fredoka One',cursive;font-size:1.5rem;color:#fff;">🎴 เลือกการ์ด</div>
    <div style="font-size:.82rem;color:rgba(255,255,255,0.6);margin-top:4px;">มือ ${handSize}/4 ใบ</div>
  `;
  ov.appendChild(hdr);

  // Progress + timer
  const progRow = document.createElement('div');
  progRow.id = 'gp-prog-row';
  progRow.style.cssText = 'font-family:"Fredoka One",cursive;font-size:.9rem;color:rgba(255,255,255,0.6);text-align:center;';
  progRow.textContent = 'รอผู้เล่นอื่น...';
  ov.appendChild(progRow);

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

// ══ SOCKET ══
// ══ Play explosion waves ทีละ wave ══
const WAVE_DELAY = 520; // ms ต่อ wave (เท่ากับ STEP_DELAY ใน offline)
let _pendingExplosionWaves = 0;
let _cardVfxPlaying = false;
let _vfxFinishTime = 0;
let _animFinishTime = 0; // เวลาที่ animation ทั้งหมดจะจบ
let _waveAnimating = false; // กำลังเล่น wave animation อยู่

// เล่น explosion ทีละ wave พร้อม apply cells ทีละขั้น (เหมือน offline explodeWave)
async function playExplosionWavesIncremental(waves, finalState) {
  const rows = STATE.size || finalState.rows || 8;
  const cols = STATE.cols || finalState.cols || rows;
  const STEP = 520; // เหมือน STEP_DELAY offline
  FX.chainReset();

  for (const wave of waves) {
    const explosions = wave.explosions || [];
    if (!explosions.length) continue;

    // Phase 1: burst + ripple + flying orbs + เสียง ทันที — ใช้ FX ชุดเดียวกับ offline (แรงขึ้นตามลำดับ wave)
    FX.wave(explosions, FX.chainStep());

    // Phase 2 (45%): apply cells ของ wave นี้ + renderGrid + flash
    await new Promise(resolve => {
      setTimeout(() => {
        // Apply wave นี้ให้ STATE.cells
        explosions.forEach(({ r, c, owner }) => {
          if (!STATE.cells[r] || !STATE.cells[r][c]) return;
          const cell = STATE.cells[r][c];
          const cap = cell.cap || 4;
          cell.count -= cap;
          if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
          // บวกให้ neighbors
          const nbs = [];
          if (r > 0) nbs.push([r-1, c]);
          if (r < rows-1) nbs.push([r+1, c]);
          if (c > 0) nbs.push([r, c-1]);
          if (c < cols-1) nbs.push([r, c+1]);
          nbs.forEach(([nr, nc]) => {
            if (STATE.cells[nr] && STATE.cells[nr][nc]) {
              STATE.cells[nr][nc].count++;
              STATE.cells[nr][nc].owner = owner;
            }
          });
        });

        // Render หลัง apply
        renderGrid(false);

        // Flash neighbors
        FX.land(explosions);

        // Phase 3 (55%): resolve
        setTimeout(resolve, STEP * 0.55);
      }, STEP * 0.45);
    });
  }
}

async function playExplosionWaves(waves, stateData) {
  // ใช้ STATE โดยตรงเพราะ sync แล้ว
  const rows = STATE.size || stateData.rows || stateData.size || 8;
  const cols = STATE.cols || stateData.cols || rows;

  const playWave = (waveExplosions) => {
    return new Promise(resolve => {
      // Phase 1: burst + ripple + flying orbs (ทันที)
      FX.wave(waveExplosions, FX.chainStep());

      // Phase 2 (45%): renderGrid + flash neighbors
      setTimeout(() => {
        if (typeof renderGrid === 'function') renderGrid(false);
        FX.land(waveExplosions);
        // Phase 3 (55%): resolve
        setTimeout(resolve, WAVE_DELAY * 0.55);
      }, WAVE_DELAY * 0.45);
    });
  };

  // เล่นทีละ wave
  _pendingExplosionWaves = waves.length;
  FX.chainReset();
  for (const wave of waves) {
    await playWave(wave.explosions);
    _pendingExplosionWaves--;
  }
  _pendingExplosionWaves = 0;
}

// ══ Handle server reset (Railway restart) ══
function handleServerReset() {
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
    <div style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:#fff;text-align:center;">⚠️ ห้องนี้ไม่อยู่แล้ว<br><span style="font-size:.9rem;color:rgba(255,255,255,0.6);font-family:Nunito,sans-serif;">Server ถูก restart หรือห้องหมดอายุ</span></div>
    <button id="server-reset-btn" style="background:#fff;border:none;border-radius:999px;padding:12px 32px;font-family:'Fredoka One',cursive;font-size:1.1rem;color:#2a1a4e;cursor:pointer;">กลับหน้าหลัก</button>
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
    'font-family:"Fredoka One",cursive;font-size:2.4rem;font-weight:900',
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
// ภาพของ update ล่าสุด (VFX การ์ด → ระเบิดทีละ wave → อนุภาคที่ค้าง) ต้องเล่นจบก่อน
// แล้วค่อยประกาศตาใหม่ (เสียง / popup / ตัวนับเวลา) และรับ input ของเรา
let _settling = false, _settleSeq = 0, _settleDeadline = 0;
const isSettling = () => _settling && Date.now() < _settleDeadline; // deadline = กันค้างถ้ามีอะไรพังกลางทาง
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
function settleThenAnnounce() {
  const token = ++_settleSeq;
  FX.whenIdle(() => {
    if (token !== _settleSeq || _waveAnimating) return; // มี update ใหม่กว่า หรือ wave ยังเล่นอยู่ — ตัวนั้นจะประกาศเอง
    _settling = false;
    announceTurn(currentRoom);
  });
}

// กลับเข้าที่นั่งเดิมด้วย token (เรียกทุกครั้งที่ socket ต่อติด ถ้ามีที่นั่งค้างอยู่)
function tryRejoin(s) {
  const silent = !session; // ลองตอนเปิดหน้า (ยังไม่ได้อยู่ในห้อง): ไม่ได้ก็เงียบๆ
  socket.emit('rejoin_room', { code: s.code, token: s.token, takeover: s.takeover !== false }, res => {
    if (res && res.ok) {
      saveSession({ code: res.code, token: res.token });
      mySlot = res.slot; isHost = !!res.isHost;
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

function initSocket() {
  // socket เดียวตลอด (ของเดิมสร้างใหม่ทุกครั้งที่ยังต่อไม่ติด → handler ซ้อนกัน)
  if (socket) { if (!socket.connected) socket.connect(); return; }
  socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 });

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
    clearAllTimers(); closeGroupPickOverlay(); setNetBanner(false);
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
  socket.on('room_closed', () => {
    clearAllTimers(); closeGroupPickOverlay(); clearSession(); setNetBanner(false);
    onlineMode = false; mySlot = -1; isHost = false; currentRoom = null; myHand = [];
    document.getElementById('game-screen').style.display = 'none';
    showScreen('main-menu');
    showToast('⌛ ห้องถูกปิดเพราะไม่มีความเคลื่อนไหว');
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
      _enterGame = false;
      if (wasInRoom) {
        showScreen('room-screen'); // ซ่อนเมนู/หน้าอื่นให้หมดก่อน (กรณีกลับเข้ามาจากหน้าเมนู)
        document.getElementById('room-screen').classList.remove('active');
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
        onlineMode = true;
        STATE._dead = false;
        _pendingExplosionWaves = 0;
        _waveAnimating = false;
        _vfxFinishTime = 0;
        _animFinishTime = 0;
        // Force render เมื่อเกมเริ่ม (ไม่ว่า _waveAnimating จะเป็นยังไง)
        syncStateFromServer(room.state);
        renderGrid(true);
        renderHandBar();
        renderScoreboard();
        updateTurnLabel();
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

        // ออกจากช่วงเลือกการ์ดแล้ว: ปิดหน้าเลือกการ์ด "ก่อน" เริ่มนับเวลา
        // (ของเดิมเรียกทีหลัง → clearAllTimers ในนั้นฆ่าตัวนับเวลาของตาเราทิ้งทุกครั้ง ตัวนับเวลาจึงไม่เคยขึ้น)
        if (room.phase !== 'group_pick') {
          const gp = document.getElementById('group-pick-overlay');
          if (gp && gp.style.display === 'flex') closeGroupPickOverlay();
          clearAllTimers();
        }
        const waves = room.state.explosionWaves;
        _settling = true;
        _settleDeadline = Date.now() + (waves ? waves.length * 520 : 0) + 6000;

        if (wasInRoom) {
          // กลับเข้ามาตอนเกมจบไปแล้ว: game_over ไม่ถูกส่งซ้ำ → เปิดหน้าผู้ชนะจาก state
          if (room.phase === 'finished' && room.state.winner >= 0 && !document.getElementById('winner-overlay').classList.contains('show')) {
            document.getElementById('winner-title').textContent = `${getPlayerName(room.state.winner)} ชนะ! 🎉`;
            document.getElementById('winner-title').style.color = PLAYER_COLORS_O[room.state.winner] || '#fff';
            document.getElementById('winner-sub').textContent = 'คะแนน: ' + (room.state.scores || []).map((s, i) => `P${i + 1}:${s}`).join('  ');
            document.getElementById('winner-overlay').classList.add('show');
          }
          settleThenAnnounce(); return; // render แล้ว ไม่ต้องทำซ้ำ
        }

        const finalRender = () => {
          if (_waveAnimating) return; // wave ชุดก่อนยังเล่นอยู่ — ตอนจบมันจะ sync ด้วย state ล่าสุดเอง
          syncStateFromServer(room.state);
          renderGrid(true); // render ทันทีไม่มี wave
          renderHandBar();
          renderScoreboard();
          updateTurnLabel();
          settleThenAnnounce();
        };

        const doRender = () => {
          if (waves && waves.length > 0 && !_waveAnimating) {
            const totalWaves = waves.length;
            _animFinishTime = Date.now() + totalWaves * 520 + 200;
            _pendingExplosionWaves = totalWaves;
            _waveAnimating = true;

            // การ์ดที่ดูดบอลทั้งหมดก่อน (m1,l1,l2): sync cells ก่อนเล่น waves
            // เพื่อให้เห็น state ที่ถูกต้อง (หลัง absorb แต่ก่อน explosion)
            const absorbCards = ['m1','l1','l2'];
            const lastCard = room.state.lastCardId;
            if (lastCard && absorbCards.includes(lastCard)) {
              // sync เฉพาะ cells ไม่ sync ทั้งหมด (เพื่อให้ wave apply ได้)
              // แต่ pre-wave cells จาก waves[0] ก็ไม่มี → ใช้ final state แทน
              // เพราะ m1 explosion มักแค่ 1-2 waves จาก center เท่านั้น
              syncStateFromServer(room.state);
              renderGrid(false);
            }

            playExplosionWavesIncremental(waves, room.state).catch(e => console.error('[waves]', e)).then(() => {
              _pendingExplosionWaves = 0;
              _animFinishTime = 0;
              _waveAnimating = false;
              if (!onlineMode) return;
              // ระหว่างเล่น wave อาจมี update ใหม่กว่าเข้ามา → จบด้วย state ล่าสุดเสมอ (ของเดิมจบด้วย state ของ update ที่เริ่มเล่น)
              syncStateFromServer((currentRoom && currentRoom.state) || room.state);
              renderGrid(true);
              renderHandBar();
              renderScoreboard();
              updateTurnLabel();
              settleThenAnnounce();
            });
          } else {
            finalRender();
          }
        };

        // รอ card VFX เสร็จก่อน (เหมือน offline waitMs = vfxFinishTime - now + 200)
        // รอ card VFX เสร็จก่อน
        let waitMs = Math.max(0, _vfxFinishTime - Date.now() + 200);
        if (waitMs < 50 && room.state.lastCardId) {
          // room_update มาก่อน card_vfx - คำนวณ wait จาก vfxDur table
          const _vfxDurTable = {
            c1:600,c2:1400,c3:1100,c4:1400,c5:700,c6:900,c7:500,c8:700,c9:1300,
            c10:500,c11:700,c13:800,c14:1300,
            u1:400,u2:700,u3:700,u4:700,u5:500,u6:1100,u7:600,u8:700,u9:600,u10:1100,
            r1:700,r2:900,r3:900,r4:1500,r5:1300,r6:700,r7:700,r8:1400,
            sr1:600,sr2:900,sr3:500,
            ep3:1000,ep4:600,ep5:1400,ep6:1200,e1:500,e2:800,e3:500,e4:800,
            l1:1400,l2:1800,l3:1800,l4:1400,l5:1300,m1:1800,m2:1500,
          };
          const _cid = room.state.lastCardId;
          const _vd = room.state.lastCardVfxData || {};
          const _base = _vd.dur || _vd.novaDur || _vfxDurTable[_cid] || 500;
          const _extra = _cid === 'l3' ? (_vd.maxDist || 0) * 55 + 900 : 0;
          waitMs = _base + _extra + 200;
        }
        if (waitMs > 50) {
          setTimeout(doRender, waitMs);
        } else {
          doRender();
        }

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
  socket.on('group_pick_start', ({ cards, handSize, timeLimit, isReroll }) => {
    if (!onlineMode) return;
    clearAllTimers();
    // รอ animation ระเบิดและ card VFX เสร็จก่อนแสดงการ์ด
    const waveWait = Math.max(0, _animFinishTime - Date.now());
    const cardWait = Math.max(0, _vfxFinishTime - Date.now() + 200);
    const animDelay = Math.max(waveWait, cardWait, 100);
    setTimeout(() => {
      SFX.select && SFX.select();
      closeGroupPickOverlay();
      showGroupPickOverlay(cards, handSize, timeLimit || CARD_LIMIT, myName);
    }, animDelay);
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
  socket.on('card_vfx', ({ cardId, targets, playerIdx, vfxData }) => {
    if (!onlineMode) return;
    _cardVfxPlaying = true;
    // Cards that modify orbs need extra wait (match offline vfxFinishTime)
    const ORB_CARDS = ['c14','u10','c2','c3','c9','u6','r4','ep5','c4','l3','ep6'];
    const vfxDur = {
      c1:600,c2:1400,c3:1100,c4:1400,c5:700,c6:900,c7:500,c8:700,c9:1300,c10:500,c11:700,c13:800,c14:1300,
      u1:400,u2:700,u3:700,u4:700,u5:500,u6:1100,u7:600,u8:700,u9:600,u10:1100,
      r1:700,r2:900,r3:900,r4:1500,r5:1300,r6:700,r7:700,r8:1400,
      sr1:600,sr2:900,sr3:500,
      ep3:1000,ep4:600,ep5:1400,ep6:1200,e1:500,e2:800,e3:500,e4:800,
      l1:1400,l2:1800,l3:1800,l4:1400,l5:1300,
      m1:1800,m2:1500,
    };
    const cardDef = (window.CARD_DEFS || []).find(d => d.id === cardId);
    if (cardDef) {
      SFX.card && SFX.card(cardDef.rarity);
      SFX.cardCat && SFX.cardCat(cardDef.cat);
      SFX.cardSpecial && SFX.cardSpecial(cardId);
      FX.cardCast(cardDef, playerIdx);
    }
    if (window.spawnCardVfx) {
      // คำนวณ vfxFinishTime ก่อน เหมือน offline
      const baseDur = (vfxData && (vfxData.dur || vfxData.novaDur)) || vfxDur[cardId] || 500;
      const extraDur = cardId === 'l3' ? ((vfxData && vfxData.maxDist) || 0) * 55 + 900 : 0;
      _vfxFinishTime = Date.now() + baseDur + extraDur;
      FX.hold(baseDur + extraDur);
      FX.track(spawnCardVfx(cardId, targets || {}, playerIdx, vfxData || {})
        .catch(() => {})
        .finally(() => { _cardVfxPlaying = false; }));
    } else {
      _cardVfxPlaying = false;
      _vfxFinishTime = 0;
    }
  });

  // ── Frozen cancel notification ──
  socket.on('frozen_cancel', ({ playerIdx, action, cardId }) => {
    if (!onlineMode) return;
    SFX.frozen && SFX.frozen();
    const pName = (window.PLAYER_NAMES && window.PLAYER_NAMES[playerIdx]) || `P${playerIdx+1}`;
    showToast(`❄️ ${pName} โดน Freeze! action ไม่มีผล`);
    // Flash score card สีฟ้า
    const sc = document.getElementById(`sc-${playerIdx}`);
    if (sc) {
      sc.style.transition = 'all .2s';
      sc.style.background = 'rgba(100,200,255,0.4)';
      sc.style.boxShadow = '0 0 20px #88eeff';
      // แสดง ❄️ ลอยบน score card
      const rect = sc.getBoundingClientRect();
      const ice = document.createElement('div');
      ice.style.cssText = `position:fixed;left:${rect.left+rect.width/2}px;top:${rect.top}px;font-size:2.5rem;pointer-events:none;z-index:1200;transform:translate(-50%,-50%);animation:cellEmojiPop 1s ease-out forwards;`;
      ice.textContent = '❄️';
      document.body.appendChild(ice);
      setTimeout(() => { sc.style.background=''; sc.style.boxShadow=''; ice.remove(); }, 1500);
    }
    // ถ้าเราเป็นคนโดน Freeze - แสดง overlay แจ้งเตือน
    if (playerIdx === mySlot) {
      showToast('❄️ คุณโดน Freeze! action ไม่มีผลในเทิร์นนี้');
    }
  });

  socket.on('place_vfx', ({ r, c, playerIdx, isFirstPlace }) => {
    if (!onlineMode) return;
    if (isFirstPlace) SFX.firstPlace(playerIdx);
    else SFX.place(playerIdx);
    // แสดงบอลที่เพิ่งวางทันที (state จริงจะ sync ทับจาก room_update เสมอ) แล้วเล่นเอฟเฟกต์วางบอล
    const placed = STATE.cells && STATE.cells[r] && STATE.cells[r][c];
    if (placed && !_waveAnimating) {
      placed.count += isFirstPlace ? 3 : 1;
      placed.owner = playerIdx;
      updateCellDisplay(r, c);
    }
    // delay เล็กน้อยรอ renderGrid เสร็จก่อน
    setTimeout(() => FX.place(r, c, playerIdx, isFirstPlace), 60);
  });

  // explosion_vfx handled inline in room_update

  // ── Game over ──
  socket.on('game_over', ({ winner, winnerName, scores }) => {
    if (!onlineMode) return;
    clearAllTimers();
    closeGroupPickOverlay();
    if (STATE) STATE.scores = scores;

    const showWinner = () => {
      document.getElementById('winner-title').textContent = `${winnerName} ชนะ! 🎉`;
      document.getElementById('winner-title').style.color = PLAYER_COLORS_O[winner] || '#fff';
      const scoreStr = scores.map((s, i) => `P${i+1}:${s}`).join('  ');
      document.getElementById('winner-sub').textContent = `คะแนน: ${scoreStr}`;
      document.getElementById('winner-overlay').classList.add('show');
      SFX.win && SFX.win();
    };

    // รอ VFX และ wave animation เสร็จก่อนขึ้น winner screen
    const vfxWait = Math.max(0, _vfxFinishTime - Date.now());
    const waveWait = Math.max(0, _animFinishTime - Date.now());
    const totalWait = Math.max(vfxWait, waveWait);
    if (totalWait > 50) {
      setTimeout(showWinner, totalWait + 300);
    } else {
      showWinner();
    }
  });

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
  STATE.cells   = serverState.cells;
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
        targetData = { r1: r, c1: c, r1Done: true, playerIdx, cardIdx: realIdx, cardDef };
        document.getElementById('target-text').textContent = `✅ ช่อง 1 แล้ว — เลือกช่องที่ 2`;
        renderGridHighlight();
        return true;
      }
      if (cardDef.twoTarget && targetData.r1Done) {
        if (r === targetData.r1 && c === targetData.c1) { showToast('เลือกช่องคนละช่อง'); return true; }
        // c5 Spin: ช่องที่ 2 ต้องอยู่ติดกับช่องที่ 1
        if (cardDef.id === 'c5') {
          const size = STATE.size, cols = STATE.cols || STATE.size;
          const r1 = targetData.r1, c1 = targetData.c1;
          const isNb = (Math.abs(r-r1)===1&&c===c1) || (Math.abs(c-c1)===1&&r===r1);
          if (!isNb) { showToast('❌ ต้องเลือกช่องที่ติดกัน'); return true; }
        }
        selectedHandCard = null;
        document.getElementById('target-banner').classList.remove('show');
        clearAllTimers();
        socket.emit('use_card', { cardId: cardDef.id, targets: { r: targetData.r1, c: targetData.c1, r2: r, c2: c } }, res => {
          if (!res?.ok) {
        if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
        else showToast(res?.msg || 'ใช้การ์ดไม่ได้');
      }
        });
        targetData = {}; renderGridHighlight();
        return true;
      }
      selectedHandCard = null;
      document.getElementById('target-banner').classList.remove('show');
      clearAllTimers();
      socket.emit('use_card', { cardId: cardDef.id, targets: { r, c } }, res => {
        if (!res?.ok) {
        if (res?.msg === 'ไม่พบห้อง' || res?.msg === 'ไม่พบผู้เล่น') handleServerReset();
        else showToast(res?.msg || 'ใช้การ์ดไม่ได้');
      }
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
      }
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
    'font-family:"Fredoka One",cursive',
    `font-size:.78rem;color:${color}`,
    'white-space:nowrap;flex-shrink:0;align-self:center',
    'text-shadow:0 0 8px ' + color + '66',
  ].join(';');
  nameTag.textContent = myName || `P${mySlot + 1}`;
  cardsRow.appendChild(nameTag);

  if (hand.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:rgba(255,255,255,0.4);font-size:.82rem;font-family:"Fredoka One",cursive;padding:8px 0;';
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

  const list = document.getElementById('room-members-list');
  list.innerHTML = '';
  room.members.forEach(m => {
    const div = document.createElement('div');
    div.style.cssText = `display:flex;align-items:center;gap:10px;padding:9px 14px;background:${m.connected ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)'};border-radius:12px;border:1px solid rgba(255,255,255,${m.connected ? '0.15' : '0.05'});`;
    const mk = (tag, css, text) => { const e = document.createElement(tag); e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; };
    div.appendChild(mk('div', `width:13px;height:13px;border-radius:50%;background:${PLAYER_COLORS_O[m.slot]};flex-shrink:0;box-shadow:0 0 6px ${PLAYER_COLORS_O[m.slot]};`));
    // ชื่อมาจากผู้เล่นคนอื่น → textContent เท่านั้น (ของเดิมใส่ลง innerHTML ตรงๆ: ชื่อ <img onerror=…> รันสคริปต์ในเครื่องคนอื่นได้)
    div.appendChild(mk('span', `font-family:'Fredoka One',cursive;color:${m.connected ? '#fff' : 'rgba(255,255,255,0.3)'};font-size:.95rem;flex:1;`, m.name + (m.slot === mySlot ? ' (คุณ)' : '')));
    if (m.isHost) div.appendChild(mk('span', 'font-size:.62rem;background:rgba(255,200,0,0.18);color:#ffd700;border-radius:6px;padding:2px 8px;border:1px solid rgba(255,200,0,0.3);', '👑 Host'));
    if (!m.connected) div.appendChild(mk('span', 'font-size:.62rem;color:rgba(255,255,255,0.3);', 'หลุด'));
    list.appendChild(div);
  });

  const hostPanel = document.getElementById('host-cfg-panel');
  const startBtn  = document.getElementById('btn-start-online');
  const waitMsg   = document.getElementById('waiting-msg');
  if (isHost) {
    hostPanel.style.display = 'block';
    startBtn.style.display  = 'flex';
    waitMsg.style.display   = 'none';
  } else {
    hostPanel.style.display = 'none';
    startBtn.style.display  = 'none';
    waitMsg.style.display   = 'block';
  }
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
  initSocket();
  // reset any stuck state from local game
  if (typeof animating !== 'undefined') animating = false;
  const blocker = document.getElementById('blocker');
  if (blocker) blocker.classList.remove('on');
  showScreen('online-screen');
  SFX.select && SFX.select();
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  myName = document.getElementById('online-name').value.trim() || 'ผู้เล่น';
  if (!socket?.connected) { showToast('กำลังเชื่อมต่อ...'); initSocket(); setTimeout(() => document.getElementById('btn-create-room').click(), 1500); return; }
  socket.emit('create_room', { name: myName, cfg: roomCfg }, res => {
    if (!res?.ok) return showToast(res?.msg || 'เกิดข้อผิดพลาด');
    mySlot = res.slot; isHost = true; myHand = [];
    if (res.token) saveSession({ code: res.code, token: res.token });
    document.getElementById('online-screen').classList.remove('active');
    enterLobby();
  });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const row = document.getElementById('join-code-row');
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
});

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

document.getElementById('room-code-big').addEventListener('click', () => {
  const code = document.getElementById('room-code-big').textContent;
  navigator.clipboard?.writeText(code).then(() => showToast('📋 คัดลอกรหัสแล้ว!'));
});

document.getElementById('btn-start-online').addEventListener('click', () => {
  if (!isHost) return showToast('ไม่ใช่ host');
  socket.emit('start_game', res => { if (!res?.ok) showToast(res?.msg || 'เริ่มเกมไม่ได้'); });
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  clearAllTimers(); closeGroupPickOverlay();
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
  clearAllTimers(); closeGroupPickOverlay();
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
if (typeof io !== 'undefined' && storedSession()) initSocket();

window._onlineCellClick    = onlineCellClick;
window.openCardFilter      = openCardFilter;
window.closeCardFilter     = closeCardFilter;
window.setAllCards         = setAllCards;
window._getRoomMembers     = () => currentRoom?.members || [];
window._onlineActivateCard = onlineActivateCard;
window._getOnlineMode      = () => onlineMode;
window._getMySlot          = () => mySlot;

})();
