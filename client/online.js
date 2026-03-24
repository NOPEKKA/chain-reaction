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
      skipBtn.style.display = 'none';
      progRow.textContent = '✅ เลือกแล้ว — รอผู้เล่นอื่น...';
      SFX.pickCard && SFX.pickCard();
    };
    el.addEventListener('click', doPickCard);
    el.addEventListener('touchend', (e) => { e.preventDefault(); doPickCard(); });
    row.appendChild(el);
  });
  ov.appendChild(row);

  // Reroll button (max 2 per game)
  const rerollBtn = document.createElement('button');
  rerollBtn.className = 'skip-pick-btn';
  const rerollLeft = 2 - _rerollsUsed;
  rerollBtn.textContent = `🔀 สุ่มใหม่ (เหลือ ${rerollLeft} ครั้ง)`;
  if (_rerollsUsed >= 2) {
    rerollBtn.disabled = true;
    rerollBtn.style.opacity = '0.4';
  }
  rerollBtn.addEventListener('click', () => {
    if (chosen || _rerollsUsed >= 2) return;
    _rerollsUsed++;
    clearAllTimers();
    // ปิด overlay เก่า รอ server ส่ง group_pick_start ใหม่
    closeGroupPickOverlay();
    socket.emit('group_pick_reroll', {}, (res) => {
      if (!res?.ok) {
        // reroll ไม่ได้ - ข้ามเลย
        chosen = true;
        socket.emit('group_pick_skip', {}, () => {});
      }
    });
  });
  ov.appendChild(rerollBtn);

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
const WAVE_DELAY = 450; // ms ต่อ wave
let _pendingExplosionWaves = 0;
let _rerollsUsed = 0;
let _cardVfxPlaying = false;

async function playExplosionWaves(waves, stateData) {
  const rows = stateData.rows || stateData.size || 8;
  const cols = stateData.cols || rows;

  const playWave = (waveExplosions) => {
    return new Promise(resolve => {
      const chainLen = waveExplosions.length;
      if (chainLen >= 4) SFX.bigChain && SFX.bigChain();
      else SFX.explode && SFX.explode(chainLen);

      waveExplosions.forEach(({ r, c, owner }) => {
        const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
        if (el) {
          el.classList.add('bursting');
          setTimeout(() => el.classList.remove('bursting'), WAVE_DELAY - 40);
        }
        if (window.spawnRipple) spawnRipple(r, c, owner);

        const nbs = [];
        if (r > 0) nbs.push([r-1, c]);
        if (r < rows-1) nbs.push([r+1, c]);
        if (c > 0) nbs.push([r, c-1]);
        if (c < cols-1) nbs.push([r, c+1]);
        if (window.spawnFlyingOrbs) spawnFlyingOrbs(r, c, owner, nbs);

        // flash neighbors ทันที
        nbs.forEach(([nr, nc]) => {
          const nel = document.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]`);
          if (nel) {
            nel.classList.add('explosion-flash');
            setTimeout(() => nel.classList.remove('explosion-flash'), 180);
          }
        });
      });

      setTimeout(resolve, WAVE_DELAY);
    });
  };

  // เล่นทีละ wave
  _pendingExplosionWaves = waves.length;
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
  // แสดง overlay ให้กลับเมนู
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
  ov.innerHTML = `
    <div style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:#fff;text-align:center;">⚠️ Server ถูก restart<br><span style="font-size:.9rem;color:rgba(255,255,255,0.6);font-family:Nunito,sans-serif;">ห้องหายไปแล้ว</span></div>
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

function notifyMyTurn() {
  const turnKey = STATE.turnCount || 0;
  if (_lastNotifiedTurn === turnKey) return;
  _lastNotifiedTurn = turnKey;

  const color = ['#e05c5c','#5bc4e0','#6dba6d','#e0a84a','#cc55ee','#ee8844'][mySlot] || '#fff';

  // 1. เสียง 2 โน้ตขึ้นสูง
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[523,0],[784,0.12]].forEach(([freq,delay]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'sine'; o.frequency.value = freq;
      const t = ac.currentTime + delay;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t+0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t+0.35);
      o.start(t); o.stop(t+0.4);
    });
  } catch(e) {}

  // 2. สั่น (มือถือ) — double pulse
  if (navigator.vibrate) navigator.vibrate([60, 30, 100]);

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

function initSocket() {
  if (socket && socket.connected) return;
  socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 });

  socket.on('connect', () => console.log('[online] connected:', socket.id));
  socket.on('disconnect', (reason) => {
    if (onlineMode && reason !== 'io client disconnect') {
      // ไม่แสดง toast ถ้ากำลังเลือกการ์ดอยู่ (กัน false alarm ช่วง 30s)
      const inGroupPick = document.getElementById('group-pick-overlay')?.style.display === 'flex';
      if (!inGroupPick) {
        clearAllTimers();
        showToast('⚠️ หลุดการเชื่อมต่อ กำลังเชื่อมใหม่...');
      }
    }
  });

  socket.on('room_update', (room) => {
    currentRoom = room;

    if ((room.phase === 'playing' || room.phase === 'group_pick' || room.phase === 'finished') && room.state) {
      const wasInRoom = document.getElementById('room-screen').classList.contains('active');
      if (wasInRoom) {
        document.getElementById('room-screen').classList.remove('active');
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
        onlineMode = true;
        STATE._dead = false;
        _pendingExplosionWaves = 0;
        _rerollsUsed = 0;
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

        const waves = room.state.explosionWaves;
        const doRender = () => {
          if (waves && waves.length > 0) {
            const finalState = room.state;
            playExplosionWaves(waves, finalState).then(() => {
              syncStateFromServer(finalState);
              renderGrid(true);
              renderHandBar();
              renderScoreboard();
              updateTurnLabel();
            });
          } else {
            syncStateFromServer(room.state);
            renderGrid(true);
            renderHandBar();
            renderScoreboard();
            updateTurnLabel();
          }
        };

        // รอ card animation เสร็จก่อน (ถ้ามี)
        if (_cardVfxPlaying) {
          setTimeout(doRender, 600);
        } else {
          doRender();
        }

        if (room.phase === 'playing' && room.state.current === mySlot) {
          startCountdown(TURN_LIMIT, '#5bc4e0', () => {
            socket.emit('place_timeout', {}, () => {});
          });
          // แจ้งเตือนว่าถึงตาเราแล้ว
          notifyMyTurn();
        } else if (room.phase !== 'group_pick') {
          clearAllTimers();
          // เสียงเปลี่ยนเทิร์นสำหรับตาคนอื่น (เบามาก)
          SFX.turnChange && SFX.turnChange();
        }

        // ถ้าออกจาก group_pick แล้วกลับมา playing
        if (room.phase === 'playing') {
          closeGroupPickOverlay();
        }
      }
    } else if (room.phase === 'lobby') {
      // อัปเดตชื่อในห้องรอด้วย
      if (window.PLAYER_NAMES && room.members) {
        room.members.forEach(m => {
          if (m.name) window.PLAYER_NAMES[m.slot] = m.name;
        });
      }
      renderRoomScreen(room);
    }
  });

  // ── Group pick ──
  socket.on('group_pick_start', ({ cards, handSize, timeLimit, isReroll }) => {
    if (!onlineMode) return;
    clearAllTimers();
    const animDelay = _pendingExplosionWaves > 0 ? _pendingExplosionWaves * WAVE_DELAY + 100 : 0;
    setTimeout(() => {
      SFX.select && SFX.select();
      if (isReroll) {
        // ปิด overlay เก่าก่อนแล้วเปิดใหม่
        closeGroupPickOverlay();
        setTimeout(() => showGroupPickOverlay(cards, handSize, timeLimit || CARD_LIMIT, myName), 50);
      } else {
        showGroupPickOverlay(cards, handSize, timeLimit || CARD_LIMIT, myName);
      }
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
    const cardDef = (window.CARD_DEFS || []).find(d => d.id === cardId);
    if (cardDef) {
      SFX.card && SFX.card(cardDef.rarity);
      SFX.cardCat && SFX.cardCat(cardDef.cat);
      SFX.cardSpecial && SFX.cardSpecial(cardId);
    }
    if (window.spawnCardVfx) {
      spawnCardVfx(cardId, targets || {}, playerIdx, vfxData || {})
        .catch(() => {})
        .finally(() => { _cardVfxPlaying = false; });
    } else {
      _cardVfxPlaying = false;
    }
  });

  socket.on('place_vfx', ({ r, c, playerIdx, isFirstPlace }) => {
    if (!onlineMode) return;
    if (isFirstPlace) SFX.firstPlace && SFX.firstPlace();
    else SFX.place && SFX.place();
    // delay เล็กน้อยรอ renderGrid เสร็จก่อน
    setTimeout(() => {
      const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      if (el) { el.classList.add('orb-placed'); setTimeout(() => el.classList.remove('orb-placed'), 400); }
    }, 60);
  });

  // explosion_vfx handled inline in room_update

  // ── Game over ──
  socket.on('game_over', ({ winner, winnerName, scores }) => {
    if (!onlineMode) return;
    clearAllTimers();
    closeGroupPickOverlay();
    if (STATE) STATE.scores = scores;
    document.getElementById('winner-title').textContent = `${winnerName} ชนะ! 🎉`;
    document.getElementById('winner-title').style.color = PLAYER_COLORS_O[winner] || '#fff';
    const scoreStr = scores.map((s, i) => `P${i+1}:${s}`).join('  ');
    document.getElementById('winner-sub').textContent = `คะแนน: ${scoreStr}`;
    document.getElementById('winner-overlay').classList.add('show');
    SFX.win && SFX.win();
  });

  socket.on('you_are_host', () => {
    isHost = true;
    showToast('👑 คุณเป็น host แล้ว');
    if (currentRoom) renderRoomScreen(currentRoom);
  });
}

function syncStateFromServer(serverState) {
  if (!serverState) return;
  cfg.mapSize = serverState.rows || serverState.size || 8;
  cfg.mapCols = serverState.cols || cfg.mapSize;
  cfg.players = serverState.players;

  STATE.size    = serverState.rows || serverState.size;
  STATE.cols    = serverState.cols || STATE.size;
  STATE.players = serverState.players;
  STATE.current = serverState.current;
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
  if (STATE.current !== mySlot) { showToast('⏳ ยังไม่ถึงตาคุณ'); return true; }

  if (selectedHandCard) {
    const { playerIdx, cardIdx } = selectedHandCard;
    const cardDef = STATE.hands[playerIdx]?.[cardIdx];
    if (cardDef) {
      if (cardDef.twoTarget && !targetData.r1Done) {
        targetData = { r1: r, c1: c, r1Done: true, playerIdx, cardIdx, cardDef };
        document.getElementById('target-text').textContent = `✅ ช่อง 1 แล้ว — เลือกช่องที่ 2`;
        renderGridHighlight();
        return true;
      }
      if (cardDef.twoTarget && targetData.r1Done) {
        if (r === targetData.r1 && c === targetData.c1) { showToast('เลือกช่องคนละช่อง'); return true; }
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
  if (pi !== mySlot) { showToast('❌ ไม่ใช่การ์ดของคุณ'); return true; }
  if (STATE.current !== mySlot) { showToast('⏳ ยังไม่ถึงตาของคุณ'); return true; }
  if (!cardDef.needTarget && !cardDef.anyTarget && !cardDef.rebirthOnly) {
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
    div.innerHTML = `
      <div style="width:13px;height:13px;border-radius:50%;background:${PLAYER_COLORS_O[m.slot]};flex-shrink:0;box-shadow:0 0 6px ${PLAYER_COLORS_O[m.slot]};"></div>
      <span style="font-family:'Fredoka One',cursive;color:${m.connected ? '#fff' : 'rgba(255,255,255,0.3)'};font-size:.95rem;flex:1;">${m.name}${m.slot === mySlot ? ' (คุณ)' : ''}</span>
      ${m.isHost ? '<span style="font-size:.62rem;background:rgba(255,200,0,0.18);color:#ffd700;border-radius:6px;padding:2px 8px;border:1px solid rgba(255,200,0,0.3);">👑 Host</span>' : ''}
      ${!m.connected ? '<span style="font-size:.62rem;color:rgba(255,255,255,0.3);">หลุด</span>' : ''}
    `;
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

function setupRoomPills() {
  document.getElementById('room-map-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#room-map-pills .pill, #room-map-rect-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      roomCfg.mapSize = parseInt(p.dataset.val);
      roomCfg.mapCols = parseInt(p.dataset.val);
      socket.emit('update_cfg', { cfg: roomCfg });
    });
  });
  document.getElementById('room-map-rect-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#room-map-pills .pill, #room-map-rect-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      roomCfg.mapSize = parseInt(p.dataset.rows);
      roomCfg.mapCols = parseInt(p.dataset.cols);
      socket.emit('update_cfg', { cfg: roomCfg });
    });
  });
  document.getElementById('room-card-pills')?.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      document.getElementById('room-card-pills').querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      roomCfg.cardInterval = parseInt(p.dataset.val);
      socket.emit('update_cfg', { cfg: roomCfg });
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
    document.getElementById('online-screen').classList.remove('active');
    showScreen('room-screen');
    setupRoomPills();
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
    document.getElementById('online-screen').classList.remove('active');
    showScreen('room-screen');
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
  onlineMode = false; mySlot = -1; isHost = false; myHand = [];
  STATE._dead = true;
  document.getElementById('game-screen').style.display = 'none';
  document.getElementById('winner-overlay').classList.remove('show');
  showScreen('main-menu');
}, true);

// renderHandBar handled in index.html directly

window._onlineCellClick    = onlineCellClick;
window._getRoomMembers     = () => currentRoom?.members || [];
window._onlineActivateCard = onlineActivateCard;
window._getOnlineMode      = () => onlineMode;
window._getMySlot          = () => mySlot;

})();
