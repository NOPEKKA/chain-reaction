// ตรรกะห้อง / ตา / การ์ดฝั่ง server ทั้งหมด
// ไม่ผูกกับ express หรือ http: รับ `io` ที่หน้าตาเหมือน socket.io server เข้ามา
//  · บน Node:        server/index.js ส่ง socket.io Server จริงเข้ามา
//  · ในเบราว์เซอร์:   client/fb-transport.js ส่ง io จำลองของโฮสต์เข้ามา (ข้อมูลวิ่งผ่าน Firebase)
// opts: { env, quiet, genCode, onRoomDeleted }
const crypto = require('crypto');

const {
  createInitialState, applyPlace, applyCard,
  processExplosionsWithWaves, checkEliminations, checkWin,
  nextTurn, tickTimeBombs, draw3UniqueCards,
  PLAYER_NAMES, HAND_LIMIT, CARD_DEFS,
} = require('../shared/gameLogic');

function attach(io, opts = {}) {
const env = opts.env || {};
const log = opts.quiet ? () => {} : console.log.bind(console);

// ── เวลา (ปรับผ่าน env ได้ — ชุดทดสอบใช้ค่าสั้นๆ) ──
const envMs = (name, def) => { const v = parseInt(env[name], 10); return Number.isFinite(v) && v >= 0 ? v : def; };
const TURN_MS           = envMs('TURN_MS', 30000);             // เวลาต่อตา
const GRACE_MS          = envMs('DISCONNECT_GRACE_MS', 20000); // ผู้เล่นปัจจุบันหลุด: รอให้กลับมาก่อนข้ามตา (นับจากตอนหลุด)
const SKIP_DELAY_MS     = envMs('SKIP_DELAY_MS', 800);         // หลุดต่อเนื่องหลายตา: ข้ามแทบทันที (เว้นให้ client วาดทัน)
const REJOIN_MIN_MS     = envMs('REJOIN_MIN_MS', 10000);       // กลับมาตอนเป็นตาตัวเอง: ได้เวลาอย่างน้อยเท่านี้
const PICK_MS           = envMs('PICK_MS', 30000);             // เวลาเลือกการ์ด
const LOBBY_GRACE_MS    = envMs('LOBBY_GRACE_MS', 15000);      // หลุดใน lobby: เก็บที่นั่งไว้ให้ครู่หนึ่ง
const ROOM_TTL_EMPTY_MS = envMs('ROOM_TTL_EMPTY_MS', 10 * 60 * 1000); // ห้องที่ไม่มีใครเชื่อมต่ออยู่เลย
const ROOM_TTL_LOBBY_MS = envMs('ROOM_TTL_LOBBY_MS', 30 * 60 * 1000); // ห้องรอ (lobby) ที่ไม่มีความเคลื่อนไหว
const ROOM_SWEEP_MS     = envMs('ROOM_SWEEP_MS', 30000);
const WAVE_MS     = 520;  // client เล่นระเบิด wave ละ 520ms
const CARD_VFX_MS = 2000; // เผื่อเวลา VFX ของการ์ดฝั่ง client

const rooms     = new Map();
const socketRoom= new Map();

// ══ ข้อมูลเข้าจาก client: เชื่อไม่ได้ทั้งหมด ══
const CARD_IDS = new Set(CARD_DEFS.map(d => d.id));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// cfg ของห้อง: รับเฉพาะคีย์ที่อนุญาตและค่าที่อยู่ในช่วง คืนเฉพาะส่วนที่ผ่าน (players / bots / คีย์อื่นจาก client ไม่รับเลย)
// แถว 4–16 · คอลัมน์ 4–18 (แมพผืนผ้าใหญ่สุดที่เกมมีให้เลือกคือ 12×18) · การ์ดทุก 0–10 เทิร์น
// ของเดิม Object.assign ตรงๆ: mapSize 1500 ทำให้ state ที่ broadcast แต่ละครั้งใหญ่ ~81 MB
function cleanCfg(cfg) {
  const out = {};
  if (!cfg || typeof cfg !== 'object') return out;
  if (isInt(cfg.mapSize, 4, 16)) out.mapSize = cfg.mapSize;
  if (isInt(cfg.mapCols, 4, 18)) out.mapCols = cfg.mapCols;
  if (isInt(cfg.cardInterval, 0, 10)) out.cardInterval = cfg.cardInterval;
  const dc = cfg.disabledCards;
  if (Array.isArray(dc) && dc.length <= CARD_IDS.size && dc.every(id => typeof id === 'string' && CARD_IDS.has(id))) out.disabledCards = [...new Set(dc)];
  return out;
}

// ชื่อผู้เล่น: ตัดอักขระควบคุม / ตัวพลิกทิศทางข้อความ, ยุบช่องว่าง, จำกัด 20 ตัวอักษร, ห้ามว่าง
// (ไม่ escape HTML ที่นี่ — เป็นหน้าที่ของ client ตอนแสดงผล ซึ่งใช้ textContent / esc())
function cleanName(name, fallback) {
  let s = (typeof name === 'string' || typeof name === 'number') ? String(name) : '';
  s = s.replace(/[\t\n\r\f\v]+/g, ' ')
       .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028-\u202e\u2066-\u2069\ufeff]/g, '')
       .replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, 20).join('').trim();
  return s || fallback;
}

// rate limit ต่อ socket ต่อ event: [จำนวนครั้งสูงสุด, ภายในกี่ ms]
const RATE = {
  create_room: [5, 10000], join_room: [10, 10000], rejoin_room: [10, 10000],
  update_cfg: [40, 5000], place: [30, 5000], use_card: [30, 5000], place_timeout: [20, 5000],
  group_pick_response: [20, 5000], group_pick_skip: [20, 5000], start_game: [10, 10000], restart_game: [10, 10000],
};
const NO_PAYLOAD = new Set(['start_game', 'restart_game']); // event ที่ client ส่งแค่ callback

// opts.genCode: โหมด Firebase จองรหัสห้องไว้ล่วงหน้า (ไม่ให้ซ้ำกับห้องของโฮสต์คนอื่น) แล้วส่งมาทางนี้
function genCode() {
  if (opts.genCode) return String(opts.genCode());
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

// ส่งแยกรายคน: ทุกคนได้ slot / สถานะ host ของ "ตัวเอง" จาก server ทุกครั้ง (you)
// ของเดิม client จำ slot จากตอน join — พอมีคนออกจาก lobby แล้ว server เลื่อน slot, client ก็เชื่อ slot ผิดไปตลอด
// เลือกวิธีนี้ (แทนการเลิกเลื่อน slot) เพราะ slot ต้องเรียงต่อเนื่อง 0..n-1 ให้ตรงกับผู้เล่นใน state อยู่แล้ว
// และ client จะคลาดไม่ได้อีก ไม่ว่า server จะจัดที่นั่งใหม่ตอนไหน
function broadcastRoom(room) {
  if (!room) return;
  const payload = {
    code:    room.code,
    phase:   room.phase,
    gameId:  room.gameId || 0, // client ใช้แยก "เกมไหน" (เช่น เปิดหน้าผู้ชนะครั้งเดียวต่อเกม)
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
  };
  room.members.forEach(m => {
    if (m.connected) io.to(m.socketId).emit('room_update', { ...payload, you: { slot: m.slot, isHost: m.socketId === room.host } });
  });
}

// state ที่ส่งให้ client: เฉพาะ field ที่ client ใช้จริง (whitelist)
// ของเดิม copy ทั้ง state แล้วลบ hands — _snapshot, voidSnapshot, playerTurns ฯลฯ หลุดไปด้วยทุกครั้ง
const STATE_FIELDS = [
  'rows', 'cols', 'players', 'current', 'alive', 'moved', 'turnCount', 'scores',
  'cells', 'shielded', 'shieldOwner', 'timeBombs', 'frozen', 'eclipse',
  'voidCells', 'severed', 'pinned', 'phase', 'winner', 'legendaryUsedBy', 'mythicalUsedBy',
];
function sanitizeState(state) {
  const pick = {};
  for (const k of STATE_FIELDS) pick[k] = state[k];
  const s = JSON.parse(JSON.stringify(pick));
  s.handsCount = state.hands.map(h => h.length); // จำนวนการ์ดในมือเท่านั้น — มือจริงส่งแยกให้เจ้าของ (your_hand)
  // สิ่งที่เกิดในตานี้ (การ์ด / การวาง / โดน Freeze) — ส่งมากับ state เลย client จะได้เล่นเอฟเฟกต์ได้จาก update ก้อนเดียว
  // ไม่ต้องพึ่งว่า card_vfx / place_vfx มาถึงก่อนหรือหลัง · เป็นของ broadcast ครั้งเดียว ส่งแล้วล้าง
  s.last = state._last || null;
  delete state._last;
  s.lastCardId = state._lastCardId || null;
  s.lastCardVfxData = state._lastCardVfxData || null;
  // ลูกโซ่ของเทิร์นล่าสุด: ครบทุก wave ในรูปกะทัดรัด + กระดานก่อน wave แรก (fxBase) — ดูรูปแบบที่ shared/gameLogic.js
  // (ของเดิมตัดที่ 20 wave เงียบๆ: ลูกโซ่ที่ยาวกว่านั้นหายท้ายแล้วกระดานกระโดด) · เป็นของ broadcast ครั้งเดียว ส่งแล้วล้าง
  const fx = state._fx;
  s.explosionWaves = fx && fx.waves.length ? fx.waves : null;
  s.fxBase = s.explosionWaves ? fx.base : null;
  if (fx && fx.truncated) s.wavesTruncated = true; // เกินเพดาน: client เล่นเท่าที่ได้แล้วจบด้วยการซิงก์
  state._fx = null;
  delete state._lastCardId; delete state._lastCardVfxData;
  state._lastExplosions = null;
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
  const waves = state._fx ? state._fx.waves.length : 0;
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
  // ผู้ตายที่ได้ตานี้เพราะถือ Rebirth แต่ไม่ใช้จนหมดเวลา (หรือหลุดเกิน grace): เสียสิทธิ์คืนชีพ
  // ของเดิม checkWin คืน false ตลอดตราบที่การ์ดยังอยู่ในมือ → ถ้าเขาไม่ใช้หรือหลุดไป เกมไม่มีวันจบ
  const forfeit = !state.alive.includes(slot) && state.hands[slot].some(d => d.id === 'l5');
  if (forfeit) { state.hands[slot] = state.hands[slot].filter(d => d.id !== 'l5'); sendPrivateHand(room, slot); }
  io.to(room.code).emit('turn_skipped', { playerIdx: slot, reason: forfeit ? 'forfeit' : away ? 'disconnected' : 'timeout' });
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
  // B1: room.phase ต้องเป็น 'group_pick' จริง — ของเดิมตั้งแค่ state.phase ส่วน room.phase ยังเป็น 'playing'
  // ทำให้ระหว่างเลือกการ์ด use_card ใช้ได้, group_pick_skip ไม่ทำอะไร, place_timeout ข้ามตาได้
  room.phase  = 'group_pick';
  state.phase = 'group_pick';

  // B2: client ต้องเล่นระเบิด/VFX ของเทิร์นนี้ให้จบก่อนเห็นการ์ด — คิดเวลาจาก wave จริง แล้ว broadcast "พร้อม" waves
  // (ของเดิมล้าง _allWaves ก่อน broadcast: ระเบิดของเทิร์นที่ทริกเกอร์การเลือกการ์ดหายไป และ delay เป็น 300ms เสมอ)
  const animMs = animMsOf(state);
  const waveDelay = animMs > 0 ? animMs + 200 : 300;
  broadcastRoom(room);
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
  room.phase  = 'playing';
  state.phase = 'playing';
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

function processTurnEnd(room) {
  if (!room?.state) return;
  const state = room.state;

  // ลูกโซ่ถูกบันทึกสะสมไว้ใน state._fx (รวมของ Time Bomb ที่ระเบิดตามหลัง) → sanitizeState ส่งให้ client
  processExplosionsWithWaves(state);
  if (tickTimeBombs(state)) processExplosionsWithWaves(state);
  const aliveB4 = [...state.alive];
  checkEliminations(state);
  if (aliveB4.length !== state.alive.length) {
    log(`[elim] alive before: ${aliveB4}, after: ${state.alive}`);
    // Log cells for eliminated players
    aliveB4.filter(i => !state.alive.includes(i)).forEach(i => {
      let cellCount = 0;
      state.cells.forEach(row => row.forEach(c => { if(c.owner===i) cellCount++; }));
      log(`[elim] P${i} eliminated, cells remaining: ${cellCount}, moved: ${state.moved[i]}`);
    });
  }

  if (checkWin(state)) {
    room.phase = 'finished';
    clearTurnTimer(room);
    broadcastRoom(room);
    sendAllHands(room);
    io.to(room.code).emit('game_over', {
      winner: state.winner,
      winnerName: room.members.find(m => m.slot === state.winner)?.name || PLAYER_NAMES[state.winner],
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
  if (rooms.get(room.code) === room) { rooms.delete(room.code); opts.onRoomDeleted?.(room.code); }
}

const touch = room => { room.touchedAt = Date.now(); }; // มีความเคลื่อนไหวในห้อง

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
  touch(room);
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

// อายุห้อง (ตรวจทุก ROOM_SWEEP_MS):
//  · ไม่มีใครเชื่อมต่อเลยครบ ROOM_TTL_EMPTY_MS (10 นาที) → ลบ — ครอบคลุมห้องที่จบเกมแล้วทุกคนออกไป และเกมที่ทุกคนหลุดไม่กลับมา
//  · ห้องรอ (lobby) ที่ไม่มีความเคลื่อนไหวครบ ROOM_TTL_LOBBY_MS (30 นาที) → แจ้งสมาชิกแล้วลบ
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!anyConnected(room)) {
      if (now - (room.emptySince || now) >= ROOM_TTL_EMPTY_MS) deleteRoom(room);
    } else if (room.phase === 'lobby' && now - (room.touchedAt || now) >= ROOM_TTL_LOBBY_MS) {
      io.to(room.code).emit('room_closed', { reason: 'idle' });
      room.members.forEach(m => io.sockets.sockets.get(m.socketId)?.leave(room.code));
      deleteRoom(room);
    }
  }
}, ROOM_SWEEP_MS);
sweeper.unref?.();

// ══ Socket.IO ══
io.on('connection', (socket) => {
  log(`[+] ${socket.id}`);
  // Wrap all socket events: กัน crash, จัดรูป payload/callback ให้แน่นอน, และ rate limit
  const origOn = socket.on.bind(socket);
  const hits = {};
  socket.on = (event, handler) => {
    if (event === 'disconnect') return origOn(event, (...args) => { try { handler(...args); } catch (err) { console.error('[SOCKET ERROR] disconnect', err.message); } });
    origOn(event, (...args) => {
      // client ส่งอะไรมาก็ได้: handler จะได้ (object, function|undefined) เสมอ — ไม่มี TypeError จากการ destructure ของแปลกๆ
      const cb = [...args].reverse().find(a => typeof a === 'function');
      const data = (args[0] && typeof args[0] === 'object') ? args[0] : {};
      const lim = RATE[event];
      if (lim) {
        const now = Date.now(), h = hits[event] || (hits[event] = []);
        while (h.length && now - h[0] > lim[1]) h.shift();
        if (h.length >= lim[0]) { try { cb?.({ ok: false, limited: true, msg: 'ส่งคำสั่งถี่เกินไป รอสักครู่' }); } catch (e) {} return; }
        h.push(now);
      }
      try { NO_PAYLOAD.has(event) ? handler(cb) : handler(data, cb); }
      catch(err) {
        console.error(`[SOCKET ERROR] event=${event}`, err.message, err.stack);
        try { cb?.({ ok: false, msg: 'Server error: ' + err.message }); } catch(e) {}
      }
    });
  };

  // ออกจากห้องเดิม (ถ้ามี) ก่อนสร้าง/เข้าห้องใหม่
  const leaveCurrent = () => { const old = getRoomBySocket(socket.id); if (old) cleanupMember(socket.id, old, { left: true }); };

  socket.on('create_room', ({ name, cfg }, cb) => {
    leaveCurrent();

    let code;
    let tries = 0;
    do { code = genCode(); } while (rooms.has(code) && ++tries < 50);
    if (rooms.has(code)) return cb?.({ ok: false, msg: 'สร้างห้องไม่ได้ ลองใหม่อีกครั้ง' });

    const token = newToken();
    const c = cleanCfg(cfg);
    const room = {
      code, host: socket.id,
      cfg: {
        players: 2, mapSize: c.mapSize ?? 8,
        mapCols: c.mapCols ?? c.mapSize ?? 8,
        cardInterval: c.cardInterval ?? 2, bots: [],
        disabledCards: c.disabledCards ?? [],
      },
      members: [{ socketId: socket.id, name: cleanName(name, 'ผู้เล่น'), slot: 0, connected: true, token, leftAt: 0, missedTurns: 0 }],
      state: null, phase: 'lobby', groupPick: null,
      gameId: 0, turnTimer: null, turnDeadline: 0, emptySince: 0, touchedAt: Date.now(),
    };
    rooms.set(code, room);
    socketRoom.set(socket.id, code);
    socket.join(code);
    cb?.({ ok: true, code, slot: 0, token });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, name }, cb) => {
    const room = (typeof code === 'string' || typeof code === 'number') ? rooms.get(String(code)) : null;
    if (!room) return cb?.({ ok: false, msg: 'ไม่พบห้องรหัสนี้' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, msg: 'เกมเริ่มแล้ว' });
    if (room.members.length >= 6) return cb?.({ ok: false, msg: 'ห้องเต็ม' });
    leaveCurrent();
    if (rooms.get(room.code) !== room) return cb?.({ ok: false, msg: 'ไม่พบห้องรหัสนี้' }); // ห้องเดิมของตัวเองถูกลบไปตอนออก

    const slot = room.members.length;
    const token = newToken();
    room.members.push({ socketId: socket.id, name: cleanName(name, `P${slot+1}`), slot, connected: true, token, leftAt: 0, missedTurns: 0 });
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    room.emptySince = 0; touch(room);
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
    room.emptySince = 0; touch(room);
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

  socket.on('update_cfg', ({ cfg }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return cb?.({ ok: false });
    const clean = cleanCfg(cfg);
    if (!Object.keys(clean).length) return cb?.({ ok: false, msg: 'ค่าตั้งห้องไม่ถูกต้อง' });
    Object.assign(room.cfg, clean); touch(room);
    log(`[update_cfg] room.cfg now:`, JSON.stringify(room.cfg));
    cb?.({ ok: true, cfg: clean });
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
    log(`[start_game] cfg:`, JSON.stringify(room.cfg));
    room.gameId = (room.gameId || 0) + 1;
    room.state = createInitialState(room.cfg);
    if (room.cfg.disabledCards?.length) {
      room.state.disabledCards = room.cfg.disabledCards;
    }
    log(`[start_game] state rows=${room.state.rows} cols=${room.state.cols}`);
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
    if (room.phase !== 'playing') return cb?.({ ok: false, msg: room.phase === 'group_pick' ? 'กำลังเลือกการ์ดอยู่' : 'ยังไม่ถึงเวลาเล่น' });
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member) return cb?.({ ok: false, msg: 'ไม่พบผู้เล่น' });
    const state = room.state;
    if (!state) return cb?.({ ok: false, msg: 'ไม่มี state' });
    if (state.current !== member.slot) return cb?.({ ok: false, msg: 'ยังไม่ใช่ตาของคุณ' });
    if (state.phase !== 'playing') return cb?.({ ok: false, msg: 'รอก่อน' });
    log(`[place] slot=${member.slot} r=${r} c=${c} rows=${state.rows} cols=${state.cols}`);
    // Validate bounds explicitly for rect map (และต้องเป็นจำนวนเต็ม)
    if (!isInt(r, 0, state.rows - 1) || !isInt(c, 0, state.cols - 1)) {
      log(`[place] OUT OF BOUNDS r=${r} c=${c} rows=${state.rows} cols=${state.cols}`);
      return cb?.({ ok: false, msg: 'ช่องอยู่นอกกระดาน' });
    }
    // ถ้าถูก Freeze: ยอมรับ action แต่ไม่มีผล แล้วข้ามเทิร์น
    if (state.frozen[member.slot] > 0) {
      log(`[place] slot=${member.slot} frozen - cancelling`);
      cb?.({ ok: true, isFirstPlace: false });
      io.to(room.code).emit('frozen_cancel', { playerIdx: member.slot, action: 'place' });
      state._last = { frozen: { playerIdx: member.slot, action: 'place' } };
      state.moved[member.slot] = true;
      processTurnEnd(room);
      return;
    }
    const result = applyPlace(state, member.slot, r, c);
    if (!result.ok) {
      log(`[place] FAILED: ${result.msg}`);
      return cb?.({ ok: false, msg: result.msg });
    }
    log(`[place] OK cell=${JSON.stringify(state.cells[r][c])}`);
    cb?.({ ok: true, isFirstPlace: result.isFirstPlace });
    io.to(room.code).emit('place_vfx', { r, c, playerIdx: member.slot, isFirstPlace: result.isFirstPlace });
    state._last = { place: { r, c, playerIdx: member.slot, isFirstPlace: !!result.isFirstPlace } };
    processTurnEnd(room);
  });

  // client แจ้งว่าตัวนับเวลาของมันหมดแล้ว — เป็นแค่ hint: server จับเวลาเอง ข้ามตาได้ก็ต่อเมื่อถึงเวลาจริงแล้วเท่านั้น
  // (ของเดิมเชื่อ client ทันที → ส่ง event นี้เมื่อไรก็ข้ามตาได้)
  socket.on('place_timeout', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !isPlaying(room)) return cb?.({ ok: true }); // ไม่ใช่ช่วงเดิน (เช่น กำลังเลือกการ์ด): ไม่มีผล
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
    if (room.phase !== 'playing') return cb?.({ ok: false, msg: room.phase === 'group_pick' ? 'กำลังเลือกการ์ดอยู่' : 'ยังไม่ถึงเวลาเล่น' });
    const member = room.members.find(m => m.socketId === socket.id);
    if (!member) return cb?.({ ok: false, msg: 'ไม่พบผู้เล่น' });
    const state = room.state;
    if (!state) return cb?.({ ok: false, msg: 'ไม่มี state' });
    if (state.phase !== 'playing') return cb?.({ ok: false, msg: 'รอก่อน' });
    if (state.current !== member.slot) return cb?.({ ok: false, msg: 'ยังไม่ใช่ตาของคุณ' });
    if (state.moved[member.slot]) return cb?.({ ok: false, msg: 'ใช้ action ไปแล้ว' });
    const cardDef = state.hands[member.slot]?.find(d => d.id === cardId);
    if (!cardDef) return cb?.({ ok: false, msg: 'ไม่มีการ์ดนี้ในมือ' });

    // ถ้าถูก Freeze: ยอมรับแต่ไม่ใช้การ์ด (ก่อน applyCard)
    if (state.frozen[member.slot] > 0) {
      cb?.({ ok: true, vfxData: {}, resultText: '' });
      io.to(room.code).emit('frozen_cancel', { playerIdx: member.slot, action: 'card', cardId });
      state._last = { frozen: { playerIdx: member.slot, action: 'card', cardId } };
      state.moved[member.slot] = true;
      processTurnEnd(room);
      return;
    }

    if (targets === null || typeof targets !== 'object') targets = {};
    // applyCard ตรวจเป้าหมายครบก่อนแก้ state แล้ว — แต่ถ้ายัง throw กลางทางได้อีก ต้องย้อน state ทั้งก้อน
    // (ของเดิมปล่อยค้าง: การ์ดหายจากมือ, ใช้ action ไปแล้ว, เทิร์นไม่จบ)
    const backup = JSON.stringify(state);
    let result;
    try { result = applyCard(state, member.slot, cardDef, targets); }
    catch(err) {
      console.error('[applyCard CRASH]', cardId, err.message, err.stack);
      room.state = JSON.parse(backup);
      return cb?.({ ok: false, msg: 'การ์ดใบนี้ใช้ไม่ได้ตอนนี้ (ไม่มีอะไรเปลี่ยน)' });
    }
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true, vfxData: result.vfxData, resultText: result.resultText });
    io.to(room.code).emit('card_vfx', { cardId, targets: targets||{}, playerIdx: member.slot, vfxData: result.vfxData||{} });
    // บันทึกการ์ดล่าสุดใน state เพื่อให้ room_update รู้ว่ามี VFX
    state._lastCardId = cardId;
    state._last = { card: { cardId, targets: targets || {}, playerIdx: member.slot, vfxData: result.vfxData || {} } };
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

return {
  rooms, socketRoom,
  stop() { clearInterval(sweeper); [...rooms.values()].forEach(deleteRoom); },
};
}

module.exports = { attach };
