const express = require('express');
const http    = require('http');
const crypto  = require('crypto');
const { Server } = require('socket.io');
const path    = require('path');

const {
  createInitialState, applyPlace, applyCard,
  processExplosionsSync, processExplosionsWithWaves, checkEliminations, checkWin,
  nextTurn, tickTimeBombs, draw3UniqueCards,
  PLAYER_NAMES, HAND_LIMIT,
} = require('../shared/gameLogic');

// Global error handler - prevent Railway restart
// (เฉพาะตอนรันเป็น server จริง — ตอนถูก require จากชุดทดสอบ ปล่อยให้ error โผล่ตามปกติ)
if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
    // ไม่ crash server
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
  });
}

// ── เวลา (ปรับผ่าน env ได้ — ชุดทดสอบใช้ค่าสั้นๆ) ──
const envMs = (name, def) => { const v = parseInt(process.env[name], 10); return Number.isFinite(v) && v >= 0 ? v : def; };
const TURN_MS           = envMs('TURN_MS', 30000);             // เวลาต่อตา
const GRACE_MS          = envMs('DISCONNECT_GRACE_MS', 20000); // ผู้เล่นปัจจุบันหลุด: รอให้กลับมาก่อนข้ามตา (นับจากตอนหลุด)
const SKIP_DELAY_MS     = envMs('SKIP_DELAY_MS', 800);         // หลุดต่อเนื่องหลายตา: ข้ามแทบทันที (เว้นให้ client วาดทัน)
const REJOIN_MIN_MS     = envMs('REJOIN_MIN_MS', 10000);       // กลับมาตอนเป็นตาตัวเอง: ได้เวลาอย่างน้อยเท่านี้
const PICK_MS           = envMs('PICK_MS', 30000);             // เวลาเลือกการ์ด
const LOBBY_GRACE_MS    = envMs('LOBBY_GRACE_MS', 15000);      // หลุดใน lobby: เก็บที่นั่งไว้ให้ครู่หนึ่ง
const ROOM_TTL_EMPTY_MS = envMs('ROOM_TTL_EMPTY_MS', 10 * 60 * 1000); // ห้องที่ไม่มีใครเชื่อมต่ออยู่เลย
const ROOM_SWEEP_MS     = envMs('ROOM_SWEEP_MS', 30000);
const WAVE_MS     = 520;  // client เล่นระเบิด wave ละ 520ms
const CARD_VFX_MS = 2000; // เผื่อเวลา VFX ของการ์ดฝั่ง client

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout: 60000, pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, '../client')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

const rooms     = new Map();
const socketRoom= new Map();

function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
const newToken = () => crypto.randomBytes(16).toString('hex');

function getRoomBySocket(sid) {
  const code = socketRoom.get(sid);
  return code ? rooms.get(code) : null;
}
const memberBySocket = (room, sid) => room.members.find(m => m.socketId === sid);
const anyConnected   = room => room.members.some(m => m.connected);
const isPlaying      = room => !!room.state && room.phase === 'playing' && room.state.phase === 'playing';

function broadcastRoom(room) {
  if (!room) return;
  io.to(room.code).emit('room_update', {
    code:    room.code,
    phase:   room.phase,
    members: room.members.map(m => ({
      name: m.name, slot: m.slot, connected: m.connected,
      isHost: m.socketId === room.host,
    })),
    cfg:   room.cfg,
    state: room.state ? sanitizeState(room.state) : null,
    groupPickStatus: room.groupPick ? {
      picked:  room.groupPick.picked,
      total:   room.groupPick.eligible.length,
      timeLimit: PICK_MS / 1000,
    } : null,
    // นาฬิกาของตานี้อยู่ที่ server: client แค่แสดงเวลาที่เหลือ
    turnMs: TURN_MS,
    turnEndsIn: room.turnDeadline ? Math.max(0, room.turnDeadline - Date.now()) : null,
  });
}

function sanitizeState(state) {
  const s = JSON.parse(JSON.stringify(state));
  s.disabledCards = state.disabledCards || [];
  s.lastCardId = state._lastCardId || null;
  s.lastCardVfxData = state._lastCardVfxData || null;
  // Clear after sending
  if (state._lastCardId) { delete state._lastCardId; delete state._lastCardVfxData; }
  s.handsCount = s.hands.map(h => h.length);
  delete s.hands;
  // ส่ง all waves data พร้อม state
  // จำกัด waves ไม่เกิน 20 waves เพื่อป้องกัน message ใหญ่เกิน
  const allWaves = state._allWaves || null;
  s.explosionWaves = allWaves ? allWaves.slice(0, 20) : null;
  s.explosions = state._lastExplosions || null;
  return s;
}

function sendPrivateHand(room, slot) {
  if (!room?.state) return;
  const m = room.members.find(m => m.slot === slot && m.connected);
  if (m) io.to(m.socketId).emit('your_hand', { slot, hand: room.state.hands[slot] || [] });
}

function sendAllHands(room) {
  room?.members?.forEach(m => { if (m.connected) sendPrivateHand(room, m.slot); });
}

// ══ นาฬิกาของตา (อยู่ที่ server) ══
// ของเดิมนับเวลาใน client เท่านั้น — ถ้าผู้เล่นปัจจุบันหลุดหรือปิดแท็บ เกมค้างถาวร
const turnKey = room => `${room.gameId || 0}:${room.state.turnCount}:${room.state.current}`;

// เวลาที่ client ใช้เล่นแอนิเมชันของ update นี้ (ระเบิดทีละ wave + VFX การ์ด) — บวกเพิ่มให้ตาถัดไป จะได้ไม่เสียเวลาคิดไปกับการดูเอฟเฟกต์
function animMsOf(state) {
  const waves = state._allWaves ? Math.min(state._allWaves.length, 20) : 0;
  const card  = state._lastCardId ? CARD_VFX_MS : 0;
  return waves * WAVE_MS + card + (waves || card ? 300 : 0);
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = 0;
}

// opts.extraMs = เวลาแอนิเมชันที่บวกเพิ่ม · opts.cap = ห้ามเลยเวลานี้ (ใช้ตอนผู้เล่นหลุดกลางตา: ย่นได้ ยืดไม่ได้)
// opts.rejoin = ผู้เล่นปัจจุบันเพิ่งกลับเข้ามา
function armTurnTimer(room, opts = {}) {
  const cap = opts.cap || 0;
  const prevLeft = room.turnDeadline ? room.turnDeadline - Date.now() : 0;
  clearTurnTimer(room);
  if (!isPlaying(room)) return;
  // ไม่มีใครเชื่อมต่ออยู่เลย: หยุดนาฬิกา (ไม่งั้นจะวนข้ามตาเปล่าๆ ไปเรื่อย) — เดินต่อเมื่อมีคน rejoin
  if (!anyConnected(room)) return;
  const m = room.members.find(x => x.slot === room.state.current);
  let ms;
  if (m && m.connected) {
    ms = opts.rejoin ? Math.min(TURN_MS, Math.max(prevLeft, REJOIN_MIN_MS)) : TURN_MS + (opts.extraMs || 0);
  } else if (!m || m.missedTurns > 0) {
    ms = SKIP_DELAY_MS + (opts.extraMs || 0);              // หลุดต่อเนื่อง: ข้ามเลย ไม่รอ
  } else {
    ms = Math.max(SKIP_DELAY_MS, GRACE_MS - (Date.now() - (m.leftAt || Date.now()))) + (opts.extraMs || 0); // หลุดครั้งแรก: grace นับจากตอนหลุด
  }
  if (cap) ms = Math.min(ms, Math.max(0, cap - Date.now()));
  room.turnDeadline = Date.now() + ms;
  const key = turnKey(room);
  room.turnTimer = setTimeout(() => onTurnTimeout(room, key), ms);
}

// หมดเวลา = ทำเหมือน place_timeout เดิม: เสียตานี้ไปโดยไม่ได้เดิน
function onTurnTimeout(room, key) {
  room.turnTimer = null;
  if (rooms.get(room.code) !== room) return;
  if (!isPlaying(room) || turnKey(room) !== key) return; // ตาเปลี่ยนไปแล้ว
  const state = room.state;
  const slot  = state.current;
  const m     = room.members.find(x => x.slot === slot);
  const away  = !m || !m.connected;
  if (m && away) m.missedTurns = (m.missedTurns || 0) + 1;
  state.moved[slot] = true;
  io.to(room.code).emit('turn_skipped', { playerIdx: slot, reason: away ? 'disconnected' : 'timeout' });
  processTurnEnd(room);
}

// ── Group card pick: ทุกคนเลือกพร้อมกัน ──
function startGroupPick(room) {
  const state = room.state;
  clearTurnTimer(room);

  // หาคนที่ eligible (มือไม่เต็ม)
  const eligible = room.members
    .filter(m => m.connected && state.alive.includes(m.slot) && state.hands[m.slot].length < HAND_LIMIT)
    .map(m => m.slot);

  if (!eligible.length) {
    // ไม่มีใครได้การ์ด → เล่นต่อ
    state.phase = 'playing';
    armTurnTimer(room, { extraMs: animMsOf(state) });
    broadcastRoom(room);
    sendAllHands(room);
    return;
  }

  const choices = {};
  eligible.forEach(slot => {
    choices[slot] = draw3UniqueCards(state.keyActive, state.disabledCards || []);
  });

  room.groupPick = {
    choices,
    eligible,
    responses: {},
    picked:    [],
    timeout:   null,
    endsAt:    0,
  };
  state.phase = 'group_pick';
  state._allWaves = null; // clear waves หลัง broadcast ไปแล้ว
  state._lastExplosions = null;

  broadcastRoom(room);

  // ส่งการ์ดให้แต่ละคน - delay เล็กน้อยเพื่อให้ client process room_update และ wave animation ก่อน
  const waveCount = (state._allWaves || []).length;
  const waveDelay = waveCount > 0 ? waveCount * 520 + 500 : 300;
  room.groupPick.endsAt = Date.now() + waveDelay + PICK_MS;
  const gp = room.groupPick;
  setTimeout(() => {
    if (room.groupPick !== gp) return;
    eligible.forEach(slot => sendPickChoices(room, slot));
  }, waveDelay);

  // timeout → finalize
  room.groupPick.timeout = setTimeout(() => {
    if (room.groupPick === gp) finalizeGroupPick(room);
  }, waveDelay + PICK_MS);
}

// ส่งตัวเลือกการ์ดให้ผู้เล่นคนหนึ่ง (ตอนเริ่ม และตอน rejoin กลางการเลือก)
function sendPickChoices(room, slot) {
  const gp = room.groupPick;
  if (!gp || !gp.eligible.includes(slot) || slot in gp.responses) return;
  const m = room.members.find(m => m.slot === slot && m.connected);
  if (!m) return;
  io.to(m.socketId).emit('group_pick_start', {
    cards:    gp.choices[slot],
    handSize: room.state.hands[slot].length,
    timeLimit: Math.max(1, Math.round(Math.min(PICK_MS, gp.endsAt - Date.now()) / 1000)),
  });
}

// ทุกคนที่ "ยังอยู่" ตอบครบแล้วหรือยัง — คนที่หลุดไม่ต้องรอ (แต่ถ้ากลับมาทันก็ยังเลือกได้)
function pickDone(room) {
  const gp = room.groupPick;
  return gp.eligible.every(s => s in gp.responses || !room.members.some(m => m.slot === s && m.connected));
}

function finalizeGroupPick(room) {
  if (!room?.groupPick) return;
  clearTimeout(room.groupPick.timeout);
  const state = room.state;
  const { choices, eligible, responses } = room.groupPick;

  eligible.forEach(slot => {
    const cardId = responses[slot];
    if (cardId) {
      const card = choices[slot]?.find(c => c.id === cardId);
      if (card && state.hands[slot].length < HAND_LIMIT) {
        state.hands[slot].push({ ...card });
      }
    }
    // null/undefined = ไม่ได้การ์ด
  });

  room.groupPick = null;
  state.phase = 'playing';
  state._allWaves = null; // ไม่ replay waves หลังเลือกการ์ด
  state._lastExplosions = null;
  armTurnTimer(room);
  broadcastRoom(room);
  sendAllHands(room);
}

// ── ตรวจว่าครบรอบยัง (ทุกคนที่ยังเล่นอยู่เล่นครบ interval รอบ) ──
function shouldTriggerGroupPick(room) {
  const state = room.state;
  if (!state || state.cardInterval <= 0) return false;
  // หลัง nextTurn, turnCount เพิ่มแล้ว
  // trigger เมื่อ turnCount หารด้วย (players * cardInterval) ลงตัว
  // ใช้ players ตั้งต้น ไม่ใช่ alive เพราะ alive เปลี่ยนเมื่อผู้เล่นถูกกำจัด
  return state.turnCount > 0 &&
    (state.turnCount % (state.players * state.cardInterval)) === 0;
}

// รวบรวมช่องที่จะระเบิดก่อน processExplosionsSync
function collectExplosions(state) {
  const { rows, cols, cells } = state;
  const toExplode = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      const key = `${r},${c}`;
      const isVoid    = (state.voidCells[key] || 0) > 0;
      const isSevered = (state.severed[key] || 0) > 0;
      const isPinned  = (state.pinned[key] || 0) > 0;
      if (!isVoid && !isSevered && !isPinned && cell.count >= cell.cap && state.shielded[r][c] <= 0) {
        toExplode.push({ r, c, owner: cell.owner });
      }
    }
  }
  return toExplode;
}

function processTurnEnd(room) {
  if (!room?.state) return;
  const state = room.state;

  const waves = processExplosionsWithWaves(state);
  if (tickTimeBombs(state)) {
    const bombWaves = processExplosionsWithWaves(state);
    waves.push(...bombWaves);
  }
  state._lastExplosions = waves.length > 0 ? waves[0].explosions : null;
  state._allWaves = waves.length > 0 ? waves : null;
  const aliveB4 = [...state.alive];
  checkEliminations(state);
  if (aliveB4.length !== state.alive.length) {
    console.log(`[elim] alive before: ${aliveB4}, after: ${state.alive}`);
    // Log cells for eliminated players
    aliveB4.filter(i => !state.alive.includes(i)).forEach(i => {
      let cellCount = 0;
      state.cells.forEach(row => row.forEach(c => { if(c.owner===i) cellCount++; }));
      console.log(`[elim] P${i} eliminated, cells remaining: ${cellCount}, moved: ${state.moved[i]}`);
    });
  }

  if (checkWin(state)) {
    room.phase = 'finished';
    clearTurnTimer(room);
    broadcastRoom(room);
    sendAllHands(room);
    io.to(room.code).emit('game_over', {
      winner: state.winner,
      winnerName: PLAYER_NAMES[state.winner],
      scores: state.scores,
    });
    return;
  }

  nextTurn(state);

  if (shouldTriggerGroupPick(room)) {
    startGroupPick(room);
  } else {
    state.phase = 'playing';
    armTurnTimer(room, { extraMs: animMsOf(state) });
    broadcastRoom(room);
    sendAllHands(room);
  }
}

// ══ สมาชิกห้อง ══
function deleteRoom(room) {
  clearTurnTimer(room);
  if (room.groupPick) { clearTimeout(room.groupPick.timeout); room.groupPick = null; }
  room.members.forEach(m => { clearTimeout(m.lobbyTimer); socketRoom.delete(m.socketId); });
  if (rooms.get(room.code) === room) rooms.delete(room.code);
}

// host ต้องเป็นคนที่เชื่อมต่ออยู่เสมอ
function ensureHost(room) {
  if (room.members.some(m => m.connected && m.socketId === room.host)) return;
  const next = room.members.find(m => m.connected);
  if (next) { room.host = next.socketId; io.to(next.socketId).emit('you_are_host'); }
}

// เอาออกจากห้องจริงๆ (ใช้ใน lobby เท่านั้น — กลางเกมที่นั่งต้องคงอยู่) แล้วเลื่อน slot ให้ต่อเนื่อง
function dropFromLobby(room, member) {
  clearTimeout(member.lobbyTimer);
  room.members = room.members.filter(m => m !== member);
  room.members.forEach((m, i) => m.slot = i);
}

// left = ผู้เล่นกดออกเอง · ไม่ใช่ = หลุดการเชื่อมต่อ (ที่นั่ง + token ยังอยู่ กลับเข้าได้ด้วย rejoin_room)
function cleanupMember(sockId, room, { left = false } = {}) {
  const member = memberBySocket(room, sockId);
  if (!member) return;
  member.connected = false;
  member.leftAt = Date.now();
  socketRoom.delete(sockId);
  io.sockets.sockets.get(sockId)?.leave(room.code);

  if (room.phase === 'lobby') {
    if (left) {
      dropFromLobby(room, member);
    } else {
      clearTimeout(member.lobbyTimer);
      member.lobbyTimer = setTimeout(() => {
        if (rooms.get(room.code) !== room || room.phase !== 'lobby' || member.connected || !room.members.includes(member)) return;
        dropFromLobby(room, member);
        if (!room.members.length) return deleteRoom(room);
        ensureHost(room);
        broadcastRoom(room);
      }, LOBBY_GRACE_MS);
    }
  } else if (left) {
    member.token = null;      // ออกเองกลางเกม = สละที่นั่ง
    member.missedTurns = 1;   // ตาของเขาถูกข้ามทันที ไม่ต้องรอ grace
  }

  if (!room.members.length) return deleteRoom(room);

  if (!anyConnected(room)) {
    // ทุกคนหลุดพร้อมกัน: เก็บห้องไว้ให้กลับเข้า (sweeper ลบเมื่อครบ ROOM_TTL_EMPTY_MS) · ของเดิมลบห้องทันที
    room.emptySince = Date.now();
    clearTurnTimer(room);
    return;
  }

  ensureHost(room);

  // อยู่ระหว่างเลือกการ์ด: ไม่ต้องรอคนที่หลุด
  if (room.groupPick && pickDone(room)) finalizeGroupPick(room);
  // เป็นตาของคนที่หลุด: ย่นเวลาเหลือ grace (ย่นได้ ยืดไม่ได้)
  else if (isPlaying(room) && room.state.current === member.slot) armTurnTimer(room, { cap: room.turnDeadline });

  broadcastRoom(room);
}

// ลบห้องที่ไม่มีใครอยู่จนครบกำหนด
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!anyConnected(room) && now - (room.emptySince || now) >= ROOM_TTL_EMPTY_MS) deleteRoom(room);
  }
}, ROOM_SWEEP_MS);
sweeper.unref();

// ══ Socket.IO ══
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);
  // Wrap all socket events to prevent crashes
  const origOn = socket.on.bind(socket);
  socket.on = (event, handler) => {
    origOn(event, (...args) => {
      try { handler(...args); }
      catch(err) {
        console.error(`[SOCKET ERROR] event=${event}`, err.message, err.stack);
        // Try to send error back via callback
        const cb = args[args.length-1];
        if (typeof cb === 'function') {
          try { cb({ ok: false, msg: 'Server error: ' + err.message }); } catch(e) {}
        }
      }
    });
  };

  // ออกจากห้องเดิม (ถ้ามี) ก่อนสร้าง/เข้าห้องใหม่
  const leaveCurrent = () => { const old = getRoomBySocket(socket.id); if (old) cleanupMember(socket.id, old, { left: true }); };

  socket.on('create_room', ({ name, cfg }, cb) => {
    leaveCurrent();

    let code;
    do { code = genCode(); } while (rooms.has(code));

    const token = newToken();
    const room = {
      code, host: socket.id,
      cfg: {
        players: 2, mapSize: cfg?.mapSize||8,
        mapCols: cfg?.mapCols||cfg?.mapSize||8,
        cardInterval: cfg?.cardInterval??2, bots: [],
        disabledCards: [],
      },
      members: [{ socketId: socket.id, name: name||'ผู้เล่น', slot: 0, connected: true, token, leftAt: 0, missedTurns: 0 }],
      state: null, phase: 'lobby', groupPick: null,
      gameId: 0, turnTimer: null, turnDeadline: 0, emptySince: 0,
    };
    rooms.set(code, room);
    socketRoom.set(socket.id, code);
    socket.join(code);
    cb?.({ ok: true, code, slot: 0, token });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, name }, cb) => {
    const room = rooms.get(code?.toString());
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้องรหัสนี้' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, msg: 'เกมเริ่มแล้ว' });
    if (room.members.length >= 6) return cb?.({ ok: false, msg: 'ห้องเต็ม' });
    leaveCurrent();
    if (rooms.get(room.code) !== room) return cb?.({ ok: false, msg: 'ไม่พบห้องรหัสนี้' }); // ห้องเดิมของตัวเองถูกลบไปตอนออก

    const slot = room.members.length;
    const token = newToken();
    room.members.push({ socketId: socket.id, name: name||`P${slot+1}`, slot, connected: true, token, leftAt: 0, missedTurns: 0 });
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    room.emptySince = 0;
    ensureHost(room);
    cb?.({ ok: true, code: room.code, slot, token });
    broadcastRoom(room);
  });

  // กลับเข้าที่นั่งเดิมด้วย token — ได้ทุก phase (lobby / กำลังเล่น / เลือกการ์ด / จบเกม)
  socket.on('rejoin_room', (data, cb) => {
    const { code, token, takeover } = data || {};
    const room = rooms.get(String(code ?? ''));
    if (!room) return cb?.({ ok: false, gone: true, msg: 'ไม่พบห้อง' });
    const member = typeof token === 'string' && token ? room.members.find(m => m.token === token) : null;
    if (!member) return cb?.({ ok: false, gone: true, msg: 'ไม่พบผู้เล่น' });

    if (member.socketId !== socket.id) {
      const old = io.sockets.sockets.get(member.socketId);
      // ที่นั่งนี้ยังมี socket อื่นเล่นอยู่ (เช่น อีกแท็บ): ยึดได้ก็ต่อเมื่อ client ยืนยันว่าเป็นแท็บเดิม
      if (old && member.connected && !takeover) return cb?.({ ok: false, busy: true, msg: 'ที่นั่งนี้ยังเชื่อมต่ออยู่' });
      socketRoom.delete(member.socketId);
      if (old) { old.leave(room.code); old.emit('session_replaced'); }
    }
    const prev = getRoomBySocket(socket.id);
    if (prev && prev !== room) cleanupMember(socket.id, prev, { left: true });

    clearTimeout(member.lobbyTimer);
    member.socketId = socket.id;
    member.connected = true;
    member.leftAt = 0;
    member.missedTurns = 0;
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    room.emptySince = 0;
    ensureHost(room);

    // นาฬิกา: เป็นตาของคนที่กลับมา → ได้เวลาใหม่ · นาฬิกาหยุดอยู่เพราะห้องว่าง → เดินต่อ
    if (isPlaying(room)) {
      if (room.state.current === member.slot) armTurnTimer(room, { rejoin: true });
      else if (!room.turnTimer) armTurnTimer(room);
    }

    cb?.({ ok: true, code: room.code, slot: member.slot, token: member.token, isHost: room.host === socket.id, phase: room.phase });
    broadcastRoom(room);
    sendPrivateHand(room, member.slot);
    sendPickChoices(room, member.slot); // กำลังเลือกการ์ดอยู่และยังไม่ได้ตอบ: ส่งตัวเลือกให้ใหม่
  });

  socket.on('update_cfg', ({ cfg }) => {
    const room = getRoomBySocket(socket.id);
    console.log(`[update_cfg] received:`, JSON.stringify(cfg), `host=${room?.host === socket.id} phase=${room?.phase}`);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    Object.assign(room.cfg, cfg);
    console.log(`[update_cfg] room.cfg now:`, JSON.stringify(room.cfg));
    broadcastRoom(room);
  });

  socket.on('start_game', (cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้อง' });
    if (room.host !== socket.id) return cb?.({ ok: false, msg: 'ไม่ใช่ host' });
    const connected = room.members.filter(m => m.connected);
    if (connected.length < 2) return cb?.({ ok: false, msg: 'ต้องมีผู้เล่น 2 คนขึ้นไป' });

    // ที่นั่งของคนที่หลุดอยู่ใน lobby (ยังไม่พ้น grace) ถูกเอาออกก่อน — เกมเริ่มด้วยคนที่อยู่จริงเท่านั้น
    if (room.phase === 'lobby') room.members.filter(m => !m.connected).forEach(m => dropFromLobby(room, m));

    room.cfg.players = room.members.length;
    console.log(`[start_game] cfg:`, JSON.stringify(room.cfg));
    room.gameId = (room.gameId || 0) + 1;
    room.state = createInitialState(room.cfg);
    if (room.cfg.disabledCards?.length) {
      room.state.disabledCards = room.cfg.disabledCards;
    }
    console.log(`[start_game] state rows=${room.state.rows} cols=${room.state.cols}`);
    room.phase = 'playing'; room.groupPick = null;
    room.members.forEach(m => { m.missedTurns = 0; });
    armTurnTimer(room);
    cb?.({ ok: true });
    broadcastRoom(room);
    sendAllHands(room);
  });

  socket.on('place', ({ r, c }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้อง' });
    if (room.phase !== 'playing') return cb?.({ ok: false, msg: 'ยังไม่ถึงเวลาเล่น' });
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member) return cb?.({ ok: false, msg: 'ไม่พบผู้เล่น' });
    const state = room.state;
    if (!state) return cb?.({ ok: false, msg: 'ไม่มี state' });
    if (state.current !== member.slot) return cb?.({ ok: false, msg: 'ยังไม่ใช่ตาของคุณ' });
    if (state.phase !== 'playing') return cb?.({ ok: false, msg: 'รอก่อน' });
    console.log(`[place] slot=${member.slot} r=${r} c=${c} rows=${state.rows} cols=${state.cols}`);
    // Validate bounds explicitly for rect map
    if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) {
      console.log(`[place] OUT OF BOUNDS r=${r} c=${c} rows=${state.rows} cols=${state.cols}`);
      return cb?.({ ok: false, msg: 'ช่องอยู่นอกกระดาน' });
    }
    // ถ้าถูก Freeze: ยอมรับ action แต่ไม่มีผล แล้วข้ามเทิร์น
    if (state.frozen[member.slot] > 0) {
      console.log(`[place] slot=${member.slot} frozen - cancelling`);
      cb?.({ ok: true, isFirstPlace: false });
      io.to(room.code).emit('frozen_cancel', { playerIdx: member.slot, action: 'place' });
      state.moved[member.slot] = true;
      processTurnEnd(room);
      return;
    }
    const result = applyPlace(state, member.slot, r, c);
    if (!result.ok) {
      console.log(`[place] FAILED: ${result.msg}`);
      return cb?.({ ok: false, msg: result.msg });
    }
    console.log(`[place] OK cell=${JSON.stringify(state.cells[r][c])}`);
    cb?.({ ok: true, isFirstPlace: result.isFirstPlace });
    io.to(room.code).emit('place_vfx', { r, c, playerIdx: member.slot, isFirstPlace: result.isFirstPlace });
    processTurnEnd(room);
  });

  // client แจ้งว่าตัวนับเวลาของมันหมดแล้ว — เป็นแค่ hint: server จับเวลาเอง ข้ามตาได้ก็ต่อเมื่อถึงเวลาจริงแล้วเท่านั้น
  // (ของเดิมเชื่อ client ทันที → ส่ง event นี้เมื่อไรก็ข้ามตาได้)
  socket.on('place_timeout', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !isPlaying(room)) return cb?.({ ok: true }); // phase changed, ignore
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member || room.state.current !== member.slot) return cb?.({ ok: false });
    const msLeft = room.turnDeadline - Date.now();
    if (msLeft > 300) return cb?.({ ok: false, msg: 'ยังไม่หมดเวลา', msLeft });
    cb?.({ ok: true });
    onTurnTimeout(room, turnKey(room));
  });

  socket.on('use_card', ({ cardId, targets }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้อง' });
    if (room.phase !== 'playing') return cb?.({ ok: false, msg: `phase ผิด: ${room.phase}` });
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member) return cb?.({ ok: false, msg: 'ไม่พบผู้เล่น' });
    const state = room.state;
    if (!state) return cb?.({ ok: false, msg: 'ไม่มี state' });
    if (state.current !== member.slot) return cb?.({ ok: false, msg: 'ยังไม่ใช่ตาของคุณ' });
    if (state.moved[member.slot]) return cb?.({ ok: false, msg: 'ใช้ action ไปแล้ว' });
    const cardDef = state.hands[member.slot]?.find(d => d.id === cardId);
    if (!cardDef) return cb?.({ ok: false, msg: 'ไม่มีการ์ดนี้ในมือ' });

    // ถ้าถูก Freeze: ยอมรับแต่ไม่ใช้การ์ด (ก่อน applyCard)
    if (state.frozen[member.slot] > 0) {
      cb?.({ ok: true, vfxData: {}, resultText: '' });
      io.to(room.code).emit('frozen_cancel', { playerIdx: member.slot, action: 'card', cardId });
      state.moved[member.slot] = true;
      processTurnEnd(room);
      return;
    }

    let result;
    try { result = applyCard(state, member.slot, cardDef, targets||{}); }
    catch(err) {
      console.error('[applyCard CRASH]', cardId, err.message, err.stack);
      return cb?.({ ok: false, msg: 'การ์ดเกิด error: ' + err.message });
    }
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true, vfxData: result.vfxData, resultText: result.resultText });
    io.to(room.code).emit('card_vfx', { cardId, targets: targets||{}, playerIdx: member.slot, vfxData: result.vfxData||{} });
    // บันทึกการ์ดล่าสุดใน state เพื่อให้ room_update รู้ว่ามี VFX
    state._lastCardId = cardId;
    state._lastCardVfxData = result.vfxData || {};
    processTurnEnd(room);
  });

  // ── Group pick: เลือกการ์ด ──


  // ── Skip: ไม่รับการ์ด ──
  socket.on('group_pick_skip', (_data, cb) => {
    const room = getRoomBySocket(socket.id);
    // ถ้า group pick จบแล้ว ก็ ok เลย
    if (!room || !room.groupPick) return cb?.({ ok: true });
    if (room.phase !== 'group_pick') return cb?.({ ok: true });
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member || !room.groupPick.eligible.includes(member.slot)) return cb?.({ ok: true });

    room.groupPick.responses[member.slot] = null; // null = skip
    cb?.({ ok: true });

    const total2 = room.groupPick.eligible.length;
    const done2 = Object.keys(room.groupPick.responses).length;
    io.to(room.code).emit('group_pick_progress', { done: done2, total: total2 });

    if (pickDone(room)) finalizeGroupPick(room);
  });

  // เริ่มเกมใหม่: เฉพาะผู้เล่นที่ยังเชื่อมต่ออยู่ได้ลงเล่น
  // (ของเดิมนับคนที่หลุดไปด้วย → เกมใหม่วนไปค้างที่ตาของคนที่ไม่มีวันเดิน)
  // ที่นั่ง/slot ของคนที่หลุดยังอยู่ (ไม่เลื่อน slot กลางคัน) — แค่ไม่ได้อยู่ใน alive ของเกมนี้ ถ้ากลับมาทันจะได้ดู และลงเล่นได้ในเกมถัดไป
  socket.on('restart_game', (cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    const active = room.members.filter(m => m.connected).map(m => m.slot).sort((a, b) => a - b);
    if (active.length < 2) return cb?.({ ok: false, msg: 'ต้องมีผู้เล่นที่เชื่อมต่ออยู่ 2 คนขึ้นไป' });
    if (room.groupPick) { clearTimeout(room.groupPick.timeout); room.groupPick = null; }
    const scores = room.state?.scores || [];
    room.cfg.players = room.members.length;
    room.gameId = (room.gameId || 0) + 1;
    room.state = createInitialState(room.cfg);
    if (room.cfg.disabledCards?.length) room.state.disabledCards = room.cfg.disabledCards;
    if (scores.length) room.state.scores = scores;
    room.state.alive = active;
    room.state.current = active[0];
    room.members.forEach(m => { m.missedTurns = 0; });
    room.phase = 'playing';
    armTurnTimer(room);
    cb?.({ ok: true, sittingOut: room.members.filter(m => !m.connected).map(m => m.slot) });
    broadcastRoom(room); sendAllHands(room);
  });

  // ── ตอบรับการเลือกการ์ด group pick ──
  socket.on('group_pick_response', ({ cardId }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.groupPick) return cb?.({ ok: true }); // already finalized
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member) return cb?.({ ok: false });
    const slot = member.slot;
    if (!room.groupPick.eligible.includes(slot)) return cb?.({ ok: false });
    if (room.groupPick.responses[slot] !== undefined) return cb?.({ ok: false, msg: 'เลือกแล้ว' });

    // ตรวจว่า cardId อยู่ใน choices ของคนนั้น
    const validCard = room.groupPick.choices[slot]?.find(c => c.id === cardId);
    if (!validCard) return cb?.({ ok: false, msg: 'การ์ดไม่ถูกต้อง' });

    room.groupPick.responses[slot] = cardId;
    cb?.({ ok: true });

    // แจ้งทุกคนว่ามีคนเลือกแล้ว (ไม่บอกว่าเลือกอะไร)
    const total = room.groupPick.eligible.length;
    const done = Object.keys(room.groupPick.responses).length;
    io.to(room.code).emit('group_pick_progress', { done, total });

    if (pickDone(room)) finalizeGroupPick(room);
  });

  // ── ข้ามการ์ด group pick ──



  socket.on('leave_room', () => {
    const room = getRoomBySocket(socket.id);
    if (room) cleanupMember(socket.id, room, { left: true });
  });

  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (room) cleanupMember(socket.id, room);
    socketRoom.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
// start(0) = port สุ่ม (ชุดทดสอบใช้) · คืน port ที่เปิดจริง
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server.address().port));
  });
}
function stop() {
  clearInterval(sweeper);
  [...rooms.values()].forEach(deleteRoom);
  return new Promise(resolve => io.close(() => resolve()));
}

if (require.main === module) {
  start().then(port => console.log(`\n🚀 Chain Reaction at http://localhost:${port}\n`));
}

module.exports = { app, server, io, rooms, socketRoom, start, stop };
