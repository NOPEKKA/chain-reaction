const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const {
  createInitialState, applyPlace, applyCard,
  processExplosionsSync, processExplosionsWithWaves, checkEliminations, checkWin,
  nextTurn, tickTimeBombs, draw3UniqueCards,
  PLAYER_NAMES, HAND_LIMIT,
} = require('../shared/gameLogic');

// Global error handler - prevent Railway restart
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
  // ไม่ crash server
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

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

function getRoomBySocket(sid) {
  const code = socketRoom.get(sid);
  return code ? rooms.get(code) : null;
}

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
      timeLimit: 30,
    } : null,
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

// ── Group card pick: ทุกคนเลือกพร้อมกัน ──
function startGroupPick(room) {
  const state = room.state;
  const TIMEOUT = 30000;

  // หาคนที่ eligible (มือไม่เต็ม)
  const eligible = room.members
    .filter(m => m.connected && state.alive.includes(m.slot) && state.hands[m.slot].length < HAND_LIMIT)
    .map(m => m.slot);

  if (!eligible.length) {
    // ไม่มีใครได้การ์ด → เล่นต่อ
    state.phase = 'playing';
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
  };
  state.phase = 'group_pick';

  broadcastRoom(room);

  // ส่งการ์ดให้แต่ละคน - delay เล็กน้อยเพื่อให้ client process room_update และ wave animation ก่อน
  const waveCount = (state._allWaves || []).length;
  const waveDelay = waveCount > 0 ? waveCount * 520 + 500 : 300;
  setTimeout(() => {
    eligible.forEach(slot => {
      const m = room.members.find(m => m.slot === slot && m.connected);
      if (m) {
        io.to(m.socketId).emit('group_pick_start', {
          cards:    choices[slot],
          handSize: state.hands[slot].length,
          timeLimit: TIMEOUT / 1000,
        });
      }
    });
  }, waveDelay);

  // timeout → finalize
  room.groupPick.timeout = setTimeout(() => {
    if (room.groupPick) finalizeGroupPick(room);
  }, TIMEOUT);
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
    broadcastRoom(room);
    sendAllHands(room);
  }
}

function cleanupMember(sockId, room) {
  const member = room.members.find(m => m.socketId === sockId);
  if (!member) return;
  member.connected = false;
  socketRoom.delete(sockId);

  const anyLeft = room.members.some(m => m.connected);
  if (!anyLeft) { rooms.delete(room.code); return; }

  if (room.host === sockId) {
    const next = room.members.find(m => m.connected);
    if (next) { room.host = next.socketId; io.to(next.socketId).emit('you_are_host'); }
  }

  if (room.phase === 'lobby') {
    room.members = room.members.filter(m => m.socketId !== sockId);
    room.members.forEach((m, i) => m.slot = i);
  }

  // ถ้าอยู่ใน group_pick และคนที่หลุดเป็น eligible → auto skip
  if (room.groupPick && room.groupPick.eligible.includes(member.slot)) {
    room.groupPick.responses[member.slot] = null;
    const allDone = room.groupPick.eligible.every(s => room.groupPick.responses[s] !== undefined);
    if (allDone) finalizeGroupPick(room);
  }

  broadcastRoom(room);
}

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

  socket.on('create_room', ({ name, cfg }, cb) => {
    const old = getRoomBySocket(socket.id);
    if (old) cleanupMember(socket.id, old);

    let code;
    do { code = genCode(); } while (rooms.has(code));

    const room = {
      code, host: socket.id,
      cfg: {
        players: 2, mapSize: cfg?.mapSize||8,
        mapCols: cfg?.mapCols||cfg?.mapSize||8,
        cardInterval: cfg?.cardInterval??2, bots: [],
        disabledCards: [],
      },
      members: [{ socketId: socket.id, name: name||'ผู้เล่น', slot: 0, connected: true }],
      state: null, phase: 'lobby', groupPick: null,
    };
    rooms.set(code, room);
    socketRoom.set(socket.id, code);
    socket.join(code);
    cb?.({ ok: true, code, slot: 0 });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, name }, cb) => {
    const room = rooms.get(code?.toString());
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้องรหัสนี้' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, msg: 'เกมเริ่มแล้ว' });

    const existing = room.members.find(m => m.name === name && !m.connected);
    if (existing) {
      existing.socketId = socket.id; existing.connected = true;
      socketRoom.set(socket.id, room.code); socket.join(room.code);
      cb?.({ ok: true, code: room.code, slot: existing.slot });
      broadcastRoom(room); return;
    }
    if (room.members.length >= 6) return cb?.({ ok: false, msg: 'ห้องเต็ม' });

    const slot = room.members.length;
    room.members.push({ socketId: socket.id, name: name||`P${slot+1}`, slot, connected: true });
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true, code: room.code, slot });
    broadcastRoom(room);
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

    room.cfg.players = room.members.length;
    console.log(`[start_game] cfg:`, JSON.stringify(room.cfg));
    room.state = createInitialState(room.cfg);
    if (room.cfg.disabledCards?.length) {
      room.state.disabledCards = room.cfg.disabledCards;
    }
    console.log(`[start_game] state rows=${room.state.rows} cols=${room.state.cols}`);
    room.phase = 'playing'; room.groupPick = null;
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

  socket.on('place_timeout', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.phase !== 'playing') return cb?.({ ok: true }); // phase changed, ignore
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member || room.state.current !== member.slot) return cb?.({ ok: false });
    room.state.moved[member.slot] = true;
    cb?.({ ok: true });
    processTurnEnd(room);
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

    const allDone = room.groupPick.eligible.every(s => s in room.groupPick.responses);
    if (allDone) finalizeGroupPick(room);
  });

  socket.on('restart_game', (cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    if (room.groupPick) { clearTimeout(room.groupPick.timeout); room.groupPick = null; }
    const scores = room.state?.scores || [];
    room.cfg.players = room.members.length;
    room.state = createInitialState(room.cfg);
    if (scores.length) room.state.scores = scores;
    room.phase = 'playing';
    cb?.({ ok: true });
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

    const allPickDone = room.groupPick.eligible.every(s => s in room.groupPick.responses);
    if (allPickDone) finalizeGroupPick(room);
  });

  // ── ข้ามการ์ด group pick ──



  socket.on('leave_room', () => {
    const room = getRoomBySocket(socket.id);
    if (room) cleanupMember(socket.id, room);
  });

  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (room) cleanupMember(socket.id, room);
    socketRoom.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🚀 Chain Reaction at http://localhost:${PORT}\n`));
