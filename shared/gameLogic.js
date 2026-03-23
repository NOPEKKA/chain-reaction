// ══ SHARED GAME LOGIC ══
// ใช้ร่วมกันระหว่าง server และ client
// ไม่มี DOM, ไม่มี window, ไม่มี document

const CARD_DEFS = [
  {id:'c1',emoji:'⚡',name:'Overload',rarity:'uncommon',cat:'burst',desc:'เพิ่มลูกบอล +2 ในช่องที่เลือก',needTarget:true,targetSelf:true},
  {id:'c2',emoji:'💠',name:'Pulse',rarity:'uncommon',cat:'burst',desc:'ช่องรอบๆ ที่เลือก +1 ทุกช่อง',needTarget:true,targetSelf:true},
  {id:'c3',emoji:'🎯',name:'Sniper',rarity:'common',cat:'attack',desc:'เลือกช่องศัตรู -1 ลูกบอล',needTarget:true,targetSelf:false},
  {id:'c4',emoji:'⚖️',name:'Exchange',rarity:'uncommon',cat:'chaos',desc:'+2 ช่องตัวเองที่เลือก แล้วสุ่มช่องศัตรู -2',needTarget:true,targetSelf:true},
  {id:'c5',emoji:'🌀',name:'Spin',rarity:'common',cat:'chaos',desc:'ย้ายลูกบอล 1 ช่องไปข้างๆ สุ่ม',needTarget:true,targetSelf:true},
  {id:'c6',emoji:'🧲',name:'Attract',rarity:'common',cat:'burst',desc:'ดึงลูกบอลจากข้างๆ มารวม',needTarget:true,targetSelf:true},
  {id:'c7',emoji:'💢',name:'Poke',rarity:'common',cat:'attack',desc:'เพิ่มลูกบอลศัตรู +1 (ใกล้ระเบิด!)',needTarget:true,targetSelf:false},
  {id:'c8',emoji:'🛡️',name:'Shield',rarity:'common',cat:'defense',desc:'ช่องนั้นไม่ระเบิด 1 เทิร์น',needTarget:true,targetSelf:true},
  {id:'c9',emoji:'🪣',name:'Drain',rarity:'common',cat:'attack',desc:'ดูดช่องศัตรู -1 แล้วตัวเอง +1 สุ่ม',needTarget:true,targetSelf:false},
  {id:'c10',emoji:'🔄',name:'Cycle',rarity:'common',cat:'strategy',desc:'ทิ้งการ์ดทั้งหมด แล้วจั่ว 1 ใบใหม่',needTarget:false},
  {id:'c11',anyTarget:true,emoji:'📦',name:'Store',rarity:'common',cat:'burst',desc:'+1 สองช่องของตัวเองสุ่ม',needTarget:false},
  {id:'c12',emoji:'🔍',name:'Scout',rarity:'common',cat:'strategy',desc:'ดูการ์ดในมือของผู้เล่นอื่นสุ่ม',needTarget:false},
  {id:'u1',emoji:'💣',name:'Instant Burst',rarity:'uncommon',cat:'burst',desc:'ช่องที่เลือกระเบิดทันที',needTarget:true,targetSelf:true},
  {id:'u2',emoji:'🔁',name:'Swap',rarity:'uncommon',cat:'strategy',desc:'สลับตำแหน่ง 2 ช่องบนกระดาน',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'u3',emoji:'💥',name:'Double Shot',rarity:'uncommon',cat:'burst',desc:'+1 สองช่องที่เลือก',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'u4',anyTarget:true,emoji:'🧱',name:'Wall',rarity:'uncommon',cat:'defense',desc:'ป้องกัน 3 ช่องของตัวเอง 1 เทิร์น',needTarget:false},
  {id:'u5',emoji:'⏳',name:'Time Bomb',rarity:'rare',cat:'chaos',desc:'อีก 2 เทิร์น ช่องนั้นระเบิดเอง',needTarget:true,targetSelf:false},
  {id:'u6',emoji:'⚔️',name:'Raid',rarity:'uncommon',cat:'attack',desc:'ลบลูกบอลศัตรู -2',needTarget:true,targetSelf:false},
  {id:'u7',emoji:'🎪',name:'Shuffle Zone',rarity:'uncommon',cat:'chaos',desc:'สุ่มตำแหน่งช่องใน 3×3',needTarget:true,targetSelf:true},
  {id:'u8',emoji:'🔃',name:'Mirror',rarity:'uncommon',cat:'chaos',desc:'คัดลอกจำนวนลูกบอลจากช่องศัตรู',needTarget:true,targetSelf:false},
  {id:'u9',emoji:'📌',name:'Pin',rarity:'uncommon',cat:'defense',desc:'ช่องศัตรูที่เลือกระเบิดออกไม่ได้ 1 เทิร์น',needTarget:true,targetSelf:false},
  {id:'u10',emoji:'🎁',name:'Gift',rarity:'common',cat:'chaos',desc:'ช่องตัวเองที่เลือก +2 แล้วสุ่มช่องศัตรู +1',needTarget:true,targetSelf:true},
  {id:'r1',emoji:'🌋',name:'Mega Burst',rarity:'rare',cat:'burst',desc:'เพิ่มลูกบอล +1 พื้นที่ 3×3',needTarget:true,targetSelf:true},
  {id:'r2',emoji:'🕳️',name:'Black Hole',rarity:'rare',cat:'chaos',desc:'ดูดลูกบอลรอบๆ ทั้งหมดมารวม',needTarget:true,targetSelf:true},
  {id:'r3',anyTarget:true,emoji:'🧊',name:'Freeze',rarity:'rare',cat:'defense',desc:'คู่ต่อสู้สุ่มข้ามเทิร์นถัดไป',needTarget:false},
  {id:'r4',anyTarget:true,emoji:'🏹',name:'Barrage',rarity:'super_rare',cat:'attack',desc:'ทุกช่องของศัตรูสุ่ม -1',needTarget:false},
  {id:'r5',anyTarget:true,emoji:'🌪️',name:'Tornado',rarity:'rare',cat:'chaos',desc:'สุ่มย้ายลูกบอล 20% ของแผนที่',needTarget:false},
  {id:'r6',anyTarget:true,emoji:'🪞',name:'Reflect',rarity:'rare',cat:'defense',desc:'ป้องกันทุกช่องของตัวเอง 1 เทิร์น',needTarget:false},
  {id:'r7',emoji:'⬛',name:'Void',rarity:'rare',cat:'chaos',desc:'ช่องที่เลือกหายไปจากกระดาน 2 เทิร์น',needTarget:true,targetSelf:true},
  {id:'r8',anyTarget:true,emoji:'🔙',name:'Rewind',rarity:'epic',cat:'strategy',desc:'ย้อนกลับกระดานไปสภาพก่อนหน้า 1 เทิร์น',needTarget:false},
  {id:'e1',emoji:'☄️',name:'Meteor',rarity:'epic',cat:'burst',desc:'ช่องนั้นระเบิด 2 รอบ',needTarget:true,targetSelf:true},
  {id:'e2',emoji:'🌊',name:'Tsunami',rarity:'epic',cat:'chaos',desc:'ทุกช่องใน row เดียวกัน +1',needTarget:true,targetSelf:true},
  {id:'e3',emoji:'🎭',name:'Steal',rarity:'epic',cat:'attack',desc:'ขโมยช่องศัตรู 1 ช่อง',needTarget:true,targetSelf:false},
  {id:'e4',anyTarget:true,emoji:'🏛️',name:'Pillar',rarity:'epic',cat:'chaos',desc:'เพิ่ม +1 ทุกช่องใน column เดียวกัน',needTarget:false},
  {id:'ep3',anyTarget:true,emoji:'⚖️',name:'Balance',rarity:'epic',cat:'chaos',desc:'เฉลี่ยจำนวนลูกบอลทุกช่องบนกระดานให้เท่ากัน',needTarget:false},
  {id:'ep5',emoji:'💫',name:'Nova',rarity:'super_rare',cat:'burst',desc:'เพิ่ม +2 รอบๆ ช่องตัวเองที่ใกล้ระเบิดที่สุด',needTarget:false,anyTarget:true},
  {id:'ep6',anyTarget:true,emoji:'🔥',name:'Inferno',rarity:'epic',cat:'burst',desc:'ทุกช่องตัวเองที่มีลูกบอล +1 พร้อมกัน',needTarget:false},
  {id:'sr1',emoji:'🪓',name:'Sever',rarity:'super_rare',cat:'defense',desc:'เลือก 2 ช่อง ระเบิดออกไปข้างๆ ไม่ได้ 4 เทิร์น',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'sr2',anyTarget:true,emoji:'🌑',name:'Eclipse',rarity:'super_rare',cat:'chaos',desc:'ทุกคนมองไม่เห็นจำนวนลูกบอลของกันและกัน 2 เทิร์น',needTarget:false},
  {id:'sr3',anyTarget:true,emoji:'🔑',name:'Key',rarity:'rare',cat:'strategy',desc:'การ์ดถัดไปที่จั่วได้จะเป็น rare ขึ้นไปแน่นอน',needTarget:false},
  {id:'l1',anyTarget:true,emoji:'💀',name:'Annihilate',rarity:'mythical',cat:'legendary',desc:'ลบลูกบอลทั้งหมดของคู่ต่อสู้สุ่ม (1ครั้ง/เกม)',needTarget:false},
  {id:'l2',anyTarget:true,emoji:'☢️',name:'Nuclear',rarity:'legendary',cat:'legendary',desc:'ทุกช่องที่มีลูกบอลระเบิดพร้อมกัน (1ครั้ง/เกม)',needTarget:false},
  {id:'l3',anyTarget:true,emoji:'👑',name:'Dominion',rarity:'legendary',cat:'legendary',desc:'ทุกช่องว่างบนกระดานกลายเป็นของตัวเองพร้อม 1 ลูกบอล (1ครั้ง/เกม)',needTarget:false},
  {id:'l4',anyTarget:true,emoji:'🛸',name:'Invasion',rarity:'super_rare',cat:'legendary',desc:'แปลงช่องศัตรูสุ่ม 3 ช่องเป็นช่องตัวเอง',needTarget:false},
  {id:'l5',emoji:'🔮',name:'Rebirth',rarity:'legendary',cat:'legendary',desc:'คืนชีพ! วางบอล 3 ลูก ใช้ได้เมื่อตายแล้วเท่านั้น',needTarget:true,targetSelf:true,rebirthOnly:true},
  {id:'m1',emoji:'🪐',name:'Singularity',rarity:'legendary',cat:'mythical',desc:'ดูด 50% ของลูกบอลทุกช่องมารวมที่ช่องที่เลือก',needTarget:true,targetSelf:true},
  {id:'m2',anyTarget:true,emoji:'🌌',name:'Big Bang',rarity:'mythical',cat:'mythical',desc:'ทุกช่องตัวเองระเบิดพร้อมกัน แล้ว +2 คืนมา',needTarget:false},
];

const RARITY_WEIGHTS = {common:50,uncommon:25,rare:12,super_rare:7,epic:4,legendary:1.5,mythical:0.5};
const PLAYER_COLORS = ['#e05c5c','#5bc4e0','#6dba6d','#e0a84a','#cc55ee','#ee8844'];
const PLAYER_NAMES  = ['ผู้เล่น 1','ผู้เล่น 2','ผู้เล่น 3','ผู้เล่น 4','ผู้เล่น 5','ผู้เล่น 6'];
const HAND_LIMIT = 4;

function capacity() { return 4; }

function neighbors(r, c, rows, cols) {
  const nb = [];
  if (r > 0)        nb.push([r-1, c]);
  if (r < rows-1)   nb.push([r+1, c]);
  if (c > 0)        nb.push([r, c-1]);
  if (c < cols-1)   nb.push([r, c+1]);
  return nb;
}

function drawRandomCard(keyActive = 0) {
  const pool = [];
  const forceRare = keyActive > 0;
  CARD_DEFS.forEach(def => {
    if (forceRare) {
      if (['rare','super_rare','epic','legendary','mythical'].includes(def.rarity)) pool.push(def);
    } else {
      const w = RARITY_WEIGHTS[def.rarity] || 0;
      for (let i = 0; i < w; i++) pool.push(def);
    }
  });
  return pool[Math.floor(Math.random() * pool.length)];
}

function draw3UniqueCards(keyActive = 0) {
  const chosen = [];
  for (let i = 0; i < 40 && chosen.length < 3; i++) {
    const card = drawRandomCard(keyActive);
    if (!chosen.find(x => x.id === card.id)) chosen.push(card);
  }
  return chosen;
}

function createInitialState(cfg) {
  const { players, mapSize: rows, mapCols: cols = rows, cardInterval = 2 } = cfg;
  return {
    rows, cols, players,
    current: 0,
    alive: Array.from({ length: players }, (_, i) => i),
    moved: Array(players).fill(false),
    turnCount: 0,
    playerTurns: Array(players).fill(0),
    scores: Array(players).fill(0),
    hands: Array.from({ length: players }, () => []),
    legendaryUsedBy: Array(players).fill(0),
    mythicalUsedBy: Array(players).fill(false),
    eclipse: 0, keyActive: 0,
    delayFor: -1, _pendingDelayFor: -1,
    voidCells: {}, voidSnapshot: {},
    severed: {}, pinned: {}, catalyzed: {},
    _snapshot: null,
    shielded: Array.from({ length: rows }, () => Array(cols).fill(0)),
    shieldOwner: Array.from({ length: rows }, () => Array(cols).fill(-1)),
    timeBombs: [],
    frozen: Array(players).fill(0),
    cells: Array.from({ length: rows }, (_, rr) =>
      Array.from({ length: cols }, (_, cc) => ({
        count: 0, owner: -1, cap: capacity(rr, cc)
      }))
    ),
    cardInterval,
    phase: 'playing', // 'playing' | 'picking_card' | 'finished'
    winner: -1,
  };
}

// ── Apply place action ──
function applyPlace(state, playerIdx, r, c) {
  const { rows, cols, cells } = state;
  const cell = cells[r][c];
  const hasOwnCells = cells.some(row => row.some(ce => ce.owner === playerIdx));

  if (hasOwnCells && cell.owner !== playerIdx) return { ok: false, msg: 'วางได้เฉพาะช่องของตัวเองเท่านั้น' };
  if (!hasOwnCells && cell.owner !== -1 && cell.owner !== playerIdx) return { ok: false, msg: 'ช่องนี้เป็นของคนอื่น' };
  if (state.moved[playerIdx]) return { ok: false, msg: 'ใช้ action ไปแล้วในเทิร์นนี้' };
  if (state.frozen[playerIdx] > 0) return { ok: false, msg: 'ถูก Freeze!' };

  const isFirstPlace = !hasOwnCells;
  state._snapshot = JSON.parse(JSON.stringify(cells.map(row => row.map(ce => ({ count: ce.count, owner: ce.owner })))));
  state.moved[playerIdx] = true;
  cell.count += isFirstPlace ? 3 : 1;
  cell.owner = playerIdx;

  return { ok: true, isFirstPlace };
}

// ── Process explosions (sync, returns changed cells) ──
// คืน array ของ waves สำหรับ animation (online mode)
function processExplosionsWithWaves(state) {
  const { rows, cols, cells } = state;
  const voidCells = state.voidCells || {};
  const severed   = state.severed   || {};
  const pinned    = state.pinned    || {};
  const allWaves  = [];

  while (true) {
    const toExplode = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c];
        const key = `${r},${c}`;
        const isVoid    = (voidCells[key] || 0) > 0;
        const isSevered = (severed[key]   || 0) > 0;
        const isPinned  = (pinned[key]    || 0) > 0;
        const cap       = cell.cap || 4;
        // eclipse ทำให้ cap เพิ่ม 1
        const effectiveCap = cap + (state.eclipse > 0 ? 1 : 0);
        if (!isVoid && !isSevered && !isPinned && cell.count >= effectiveCap && state.shielded[r][c] <= 0) {
          toExplode.push([r, c]);
        }
      }
    }
    if (!toExplode.length) break;

    // บันทึก wave นี้ก่อน apply
    const wave = toExplode.map(([r,c]) => ({ r, c, owner: cells[r][c].owner }));
    allWaves.push({ explosions: wave });

    // Apply explosion (same logic as processExplosionsSync)
    toExplode.forEach(([r, c]) => {
      const cell = cells[r][c];
      const owner = cell.owner;
      const cap = cell.cap || 4;
      cell.count -= cap;
      if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
      const nb = neighbors(r, c, rows, cols);
      nb.forEach(([nr, nc]) => {
        cells[nr][nc].count++;
        cells[nr][nc].owner = owner;
      });
    });
  }
  return allWaves;
}

function processExplosionsSync(state) {
  const { rows, cols, cells } = state;
  let totalWaves = 0;

  const voidCells = state.voidCells || {};
  const severed   = state.severed   || {};
  const pinned    = state.pinned    || {};

  while (true) {
    const toExplode = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c];
        const key = `${r},${c}`;
        const isVoid    = (voidCells[key] || 0) > 0;
        const isSevered = (severed[key]   || 0) > 0;
        const isPinned  = (pinned[key]    || 0) > 0;
        const cap       = cell.cap || 4;
        if (!isVoid && !isSevered && !isPinned && cell.count >= cap && state.shielded[r][c] <= 0) {
          toExplode.push([r, c]);
        }
      }
    }
    if (!toExplode.length) break;

    toExplode.forEach(([r, c]) => {
      const cell = cells[r][c];
      const owner = cell.owner;
      const cap = cell.cap || 4;
      cell.count -= cap;
      if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }

      neighbors(r, c, rows, cols).forEach(([nr, nc]) => {
        if (state.shielded[nr][nc] <= 0 || state.shieldOwner[nr][nc] === owner) {
          cells[nr][nc].count++;
          cells[nr][nc].owner = owner;
        }
      });
    });

    if (++totalWaves > rows * cols * 4) break;
  }
}

// ── Check eliminations ──
function checkEliminations(state) {
  state.alive = state.alive.filter(i => {
    if (!state.moved[i]) return true;
    return state.cells.some(row => row.some(ce => ce.owner === i));
  });
}

// ── Check win ──
function checkWin(state) {
  if (state.alive.length === 1 && state.moved.some(Boolean)) {
    const deadWithRebirth = [];
    for (let i = 0; i < state.players; i++) {
      if (!state.alive.includes(i) && state.moved[i] && state.hands[i].some(d => d.id === 'l5')) {
        deadWithRebirth.push(i);
      }
    }
    if (deadWithRebirth.length > 0) return false;
    state.phase = 'finished';
    state.winner = state.alive[0];
    state.scores[state.winner] = (state.scores[state.winner] || 0) + 1;
    return true;
  }
  return false;
}

// ── Tick shields / effects on turn start ──
function tickEffects(state, nextPlayer) {
  const { rows, cols } = state;
  // shields
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.shielded[r][c] > 0 && state.shieldOwner[r][c] === nextPlayer) {
        state.shielded[r][c]--;
        if (state.shielded[r][c] <= 0) state.shieldOwner[r][c] = -1;
      }
    }
  }
  // eclipse
  if (state.eclipse > 0) state.eclipse--;
  // void
  Object.keys(state.voidCells).forEach(k => {
    state.voidCells[k]--;
    if (state.voidCells[k] <= 0) {
      if (state.voidSnapshot[k]) {
        const [ro, co] = k.split(',').map(Number);
        state.cells[ro][co].count = state.voidSnapshot[k].count;
        state.cells[ro][co].owner = state.voidSnapshot[k].owner;
        delete state.voidSnapshot[k];
      }
      delete state.voidCells[k];
    }
  });
  // severed / pinned
  ['severed','pinned','catalyzed'].forEach(f => {
    Object.keys(state[f]).forEach(k => {
      state[f][k]--;
      if (state[f][k] <= 0) delete state[f][k];
    });
  });
}

// ── Advance to next player ──
function nextTurn(state) {
  const prev = state.current;
  state.turnCount++;
  state.playerTurns[prev]++;
  if (state.frozen[prev] > 0) state.frozen[prev]--;

  if (state._pendingDelayFor >= 0) {
    state.delayFor = state._pendingDelayFor;
    state._pendingDelayFor = -1;
  }

  let next = (state.current + 1) % state.players;
  let guard = 0;
  const canPlay = i => state.alive.includes(i) || (state.hands[i] && state.hands[i].some(d => d.id === 'l5'));
  while (!canPlay(next)) {
    next = (next + 1) % state.players;
    if (++guard > state.players) break;
  }
  state.current = next;
  state.moved[next] = false;
  tickEffects(state, next);
}

// ── Tick time bombs ──
function tickTimeBombs(state) {
  const cur = state.current;
  const exploded = [];
  state.timeBombs.forEach(b => {
    if (b.owner === cur) {
      b.turnsLeft--;
      if (b.turnsLeft <= 0) exploded.push(b);
    }
  });
  state.timeBombs = state.timeBombs.filter(b => b.turnsLeft > 0);
  exploded.forEach(b => {
    state.cells[b.r][b.c].count = state.cells[b.r][b.c].cap;
    state.cells[b.r][b.c].owner = b.owner;
  });
  return exploded.length > 0;
}

// ── Apply card effect (returns {ok, resultText, vfxData}) ──
function applyCard(state, playerIdx, cardDef, targets) {
  const { rows, cols, cells } = state;
  const cur = playerIdx;
  const { r, c, r2, c2 } = targets || {};
  let resultText = '';
  let vfxData = {};

  // Validate targets for cards that need them
  if (cardDef.needTarget && !cardDef.anyTarget && r === undefined) {
    return { ok: false, msg: 'ต้องเลือกช่องก่อน' };
  }
  if (cardDef.twoTarget && (r2 === undefined || c2 === undefined)) {
    return { ok: false, msg: 'ต้องเลือก 2 ช่อง' };
  }
  // Validate r,c are in bounds
  if (r !== undefined && (r < 0 || r >= state.rows || c < 0 || c >= state.cols)) {
    return { ok: false, msg: 'ช่องอยู่นอกกระดาน' };
  }

  if (cardDef.rarity === 'legendary' && (state.legendaryUsedBy[cur] || 0) >= 2)
    return { ok: false, msg: 'Legendary ใช้ได้แค่ 2 ครั้งต่อเกม!' };
  if (cardDef.rarity === 'mythical' && state.mythicalUsedBy[cur])
    return { ok: false, msg: 'Mythical ใช้ได้แค่ 1 ครั้งต่อเกม!' };

  if (cardDef.id !== 'r8') {
    state._snapshot = JSON.parse(JSON.stringify(cells.map(row =>
      row.map(ce => ({ count: ce.count, owner: ce.owner }))
    )));
  }

  if (cardDef.id !== 'ep4') state.moved[cur] = true;

  const idx = state.hands[playerIdx].findIndex(d => d.id === cardDef.id);
  if (idx >= 0) state.hands[playerIdx].splice(idx, 1);

  if (cardDef.rarity === 'legendary') state.legendaryUsedBy[cur] = (state.legendaryUsedBy[cur] || 0) + 1;
  if (cardDef.rarity === 'mythical')  state.mythicalUsedBy[cur] = true;
  if (state.keyActive > 0)            state.keyActive--;

  switch (cardDef.id) {
    case 'c1': cells[r][c].count += 2; cells[r][c].owner = cur; resultText = '+2!'; break;
    case 'c2': {
      const area = neighbors(r, c, rows, cols).filter(([nr,nc]) => cells[nr][nc].owner === cur || cells[nr][nc].owner === -1);
      area.forEach(([nr,nc]) => { cells[nr][nc].count++; cells[nr][nc].owner = cur; });
      vfxData = { area }; resultText = 'Pulse!'; break;
    }
    case 'c3': if (cells[r][c].owner !== cur && cells[r][c].count > 0 && state.shielded[r][c] <= 0) { cells[r][c].count--; if (cells[r][c].count <= 0) cells[r][c].owner = -1; resultText = '-1!'; } break;
    case 'c4': {
      cells[r][c].count += 2; cells[r][c].owner = cur;
      const enemies = [];
      for (let ro = 0; ro < rows; ro++) for (let co = 0; co < cols; co++) if (cells[ro][co].owner !== cur && cells[ro][co].owner !== -1) enemies.push([ro, co]);
      if (enemies.length) { const [er,ec] = enemies[Math.floor(Math.random()*enemies.length)]; cells[er][ec].count = Math.max(0, cells[er][ec].count-2); if(!cells[er][ec].count) cells[er][ec].owner=-1; vfxData.enemyCell=[er,ec]; }
      resultText = 'Exchange!'; break;
    }
    case 'c5': {
      const nbs = neighbors(r, c, rows, cols);
      if (nbs.length && cells[r][c].count > 0) {
        const [nr,nc] = nbs[Math.floor(Math.random()*nbs.length)];
        const ow = cells[r][c].owner;
        cells[r][c].count--; if (!cells[r][c].count) cells[r][c].owner = -1;
        cells[nr][nc].count++; cells[nr][nc].owner = ow;
        vfxData = { moves: [{from:[r,c],to:[nr,nc]}] };
      }
      resultText = 'Spin!'; break;
    }
    case 'c6': {
      const pulled = [];
      neighbors(r, c, rows, cols).forEach(([nr,nc]) => {
        if (cells[nr][nc].count > 0 && cells[nr][nc].owner === cur) {
          cells[nr][nc].count--; if (!cells[nr][nc].count) cells[nr][nc].owner = -1;
          cells[r][c].count++; cells[r][c].owner = cur; pulled.push([nr,nc]);
        }
      });
      vfxData = { pulled, to:[r,c] }; resultText = 'Attract!'; break;
    }
    case 'c7': if (cells[r][c].owner !== cur) { cells[r][c].count++; resultText = '+1 ศัตรู!'; } break;
    case 'c8': state.shielded[r][c] = 1; state.shieldOwner[r][c] = cur; resultText = 'Shield!'; break;
    case 'c9': {
      if (cells[r][c].owner !== cur && cells[r][c].count > 0 && state.shielded[r][c] <= 0) {
        cells[r][c].count--; if (!cells[r][c].count) cells[r][c].owner = -1;
        const own = []; for (let ro=0;ro<rows;ro++) for (let co=0;co<cols;co++) if (cells[ro][co].owner===cur) own.push([ro,co]);
        const bonusCell = own.length ? own[Math.floor(Math.random()*own.length)] : null;
        if (bonusCell) { const [br,bc]=bonusCell; cells[br][bc].count++; }
        vfxData = { target:[r,c], bonusCell }; resultText = 'Drain!';
      } break;
    }
    case 'c10': { state.hands[playerIdx] = []; const nc2 = drawRandomCard(state.keyActive); state.hands[playerIdx].push({...nc2}); resultText = `จั่ว ${nc2.name}!`; break; }
    case 'c11': {
      const own=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur) own.push([ro,co]);
      const picked = own.sort(()=>Math.random()-.5).slice(0,2); picked.forEach(([ro,co])=>cells[ro][co].count++);
      vfxData={boosted:picked}; resultText='+1 สองช่อง!'; break;
    }
    case 'c13': { const vals=[-2,-1,0,1,2]; const v=vals[Math.floor(Math.random()*vals.length)]; cells[r][c].count=Math.max(0,cells[r][c].count+v); if(cells[r][c].count>0) cells[r][c].owner=cur; vfxData={value:v}; resultText=`Gamble: ${v>=0?'+':''}${v}!`; break; }
    case 'c14': { cells[r][c].count++; cells[r][c].owner=cur; const boosted=[[r,c]]; neighbors(r,c,rows,cols).forEach(([nr,nc])=>{if(cells[nr][nc].owner===cur){cells[nr][nc].count++;boosted.push([nr,nc]);}}); vfxData={boosted}; resultText='Boost!'; break; }
    case 'u1': cells[r][c].count=cells[r][c].cap; cells[r][c].owner=cur; resultText='Burst!'; break;
    case 'u2': { const tmp={...cells[r][c]}; cells[r][c]={...cells[r2][c2]}; cells[r2][c2]=tmp; cells[r][c].cap=capacity(); cells[r2][c2].cap=capacity(); vfxData={moves:[{from:[r,c],to:[r2,c2]},{from:[r2,c2],to:[r,c]}]}; resultText='Swap!'; break; }
    case 'u3': [[r,c],[r2,c2]].forEach(([ro,co])=>{ if(cells[ro][co].owner===cur||cells[ro][co].owner===-1){cells[ro][co].count++;cells[ro][co].owner=cur;} }); vfxData={boosted:[[r,c],[r2,c2]]}; resultText='+1 สองช่อง!'; break;
    case 'u4': { const own=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur) own.push([ro,co]); const sh3=own.sort(()=>Math.random()-.5).slice(0,3); sh3.forEach(([ro,co])=>{state.shielded[ro][co]=1;state.shieldOwner[ro][co]=cur;}); vfxData={shielded:sh3}; resultText='Wall!'; break; }
    case 'u5': state.timeBombs.push({r,c,turnsLeft:2,owner:cur}); resultText='Time Bomb!'; break;
    case 'u6': if(cells[r][c].owner!==cur&&state.shielded[r][c]<=0){cells[r][c].count=Math.max(0,cells[r][c].count-2);if(!cells[r][c].count)cells[r][c].owner=-1;vfxData={target:[r,c]};resultText='-2!';}; break;
    case 'u9': { if(!state.pinned) state.pinned={}; state.pinned[`${r},${c}`]=1; resultText='Pin!'; break; }
    case 'u10': { cells[r][c].count+=2; cells[r][c].owner=cur; const others=state.alive.filter(i=>i!==cur); let enemyCell=null; if(others.length){const t=others[Math.floor(Math.random()*others.length)];const tc=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===t) tc.push([ro,co]); if(tc.length){const[ro,co]=tc[Math.floor(Math.random()*tc.length)];cells[ro][co].count++;enemyCell=[ro,co];}} vfxData={enemyCell};resultText='Gift!'; break; }
    case 'r1': { const area=[]; for(let ro=Math.max(0,r-1);ro<=Math.min(rows-1,r+1);ro++) for(let co=Math.max(0,c-1);co<=Math.min(cols-1,c+1);co++) if(cells[ro][co].owner===cur||cells[ro][co].owner===-1){cells[ro][co].count++;cells[ro][co].owner=cur;area.push([ro,co]);} vfxData={area};resultText='Mega Burst!'; break; }
    case 'r2': { const absorbed=neighbors(r,c,rows,cols).filter(([nr,nc])=>cells[nr][nc].count>0).map(x=>[...x]); neighbors(r,c,rows,cols).forEach(([nr,nc])=>{cells[r][c].count+=cells[nr][nc].count;cells[r][c].owner=cur;cells[nr][nc].count=0;cells[nr][nc].owner=-1;}); vfxData={pulled:absorbed,to:[r,c]};resultText='Black Hole!'; break; }
    case 'r3': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];state.frozen[t]=Math.max(state.frozen[t],1);vfxData={frozenPlayer:t};resultText=`Freeze ${PLAYER_NAMES[t]}!`;} break; }
    case 'r4': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];const hit=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===t&&state.shielded[ro][co]<=0){cells[ro][co].count--;if(!cells[ro][co].count)cells[ro][co].owner=-1;hit.push([ro,co]);}vfxData={hit};resultText='Barrage!';} break; }
    case 'r5': { const moves=[]; const all=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) all.push([ro,co]); all.filter(()=>Math.random()<.2).forEach(([ro,co])=>{const nbs2=neighbors(ro,co,rows,cols);if(nbs2.length&&cells[ro][co].count>0){const[nr,nc]=nbs2[Math.floor(Math.random()*nbs2.length)];const ow=cells[ro][co].owner;cells[ro][co].count--;if(!cells[ro][co].count)cells[ro][co].owner=-1;cells[nr][nc].count++;cells[nr][nc].owner=ow;moves.push({from:[ro,co],to:[nr,nc]});}}); vfxData={moves};resultText='Tornado!'; break; }
    case 'r6': { const shAll=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){state.shielded[ro][co]=1;state.shieldOwner[ro][co]=cur;shAll.push([ro,co]);} vfxData={shielded:shAll};resultText='Reflect!'; break; }
    case 'r7': { if(!state.voidCells) state.voidCells={}; if(!state.voidSnapshot) state.voidSnapshot={}; state.voidCells[`${r},${c}`]=2; state.voidSnapshot[`${r},${c}`]={count:cells[r][c].count,owner:cells[r][c].owner}; cells[r][c].count=0; cells[r][c].owner=-1; resultText='Void!'; break; }
    case 'r8': { if(state._snapshot){const snap=state._snapshot;const diff=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++){const cur3=cells[ro][co],old3=snap[ro][co];if(cur3.count!==old3.count||cur3.owner!==old3.owner)diff.push({r:ro,c:co,fromCount:cur3.count,fromOwner:cur3.owner,toCount:old3.count,toOwner:old3.owner});}vfxData={diff};for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++){cells[ro][co].count=snap[ro][co].count;cells[ro][co].owner=snap[ro][co].owner;}resultText='Rewind!';} break; }
    case 'e1': cells[r][c].count=Math.max(cells[r][c].count,cells[r][c].cap); cells[r][c].owner=cur; resultText='Meteor!'; break;
    case 'e2': { const row=[]; for(let co=0;co<cols;co++) if(cells[r][co].owner===cur||cells[r][co].owner===-1){cells[r][co].count++;cells[r][co].owner=cur;row.push([r,co]);} vfxData={row};resultText='Tsunami!'; break; }
    case 'e3': if(cells[r][c].owner!==cur&&cells[r][c].owner!==-1&&cells[r][c].count>0){cells[r][c].owner=cur;if(cells[r][c].count<=0)cells[r][c].count=1;resultText='Steal!';}; break;
    case 'e4': { const col=[]; for(let ro=0;ro<rows;ro++) if(cells[ro][c].owner===cur||cells[ro][c].owner===-1){cells[ro][c].count++;cells[ro][c].owner=cur;col.push([ro,c]);} vfxData={col};resultText='Pillar!'; break; }
    case 'ep3': { let total=0,cnt=0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0){total+=cells[ro][co].count;cnt++;} const avg=cnt>0?Math.round(total/cnt):0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) cells[ro][co].count=avg; resultText='Balance!'; break; }
    case 'ep4': state._pendingDelayFor=cur; resultText='Delay!'; break;
    case 'ep5': { let best=null,bestRatio=-1; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){const ratio=cells[ro][co].count/cells[ro][co].cap;if(ratio>bestRatio){bestRatio=ratio;best=[ro,co];}} if(best){const[br,bc]=best;const boosted=neighbors(br,bc,rows,cols).filter(([nr,nc])=>cells[nr][nc].owner===cur||cells[nr][nc].owner===-1);boosted.forEach(([nr,nc])=>{cells[nr][nc].count+=2;cells[nr][nc].owner=cur;});vfxData={best,boosted};resultText='Nova!';}; break; }
    case 'ep6': { const infCells=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){cells[ro][co].count++;infCells.push([ro,co]);} vfxData={cells:infCells};resultText='Inferno!'; break; }
    case 'sr1': { if(!state.severed) state.severed={}; state.severed[`${r},${c}`]=4; if(r2!==undefined&&c2!==undefined) state.severed[`${r2},${c2}`]=4; resultText='Sever!'; break; }
    case 'sr2': state.eclipse=(state.eclipse||0)+2; resultText='Eclipse!'; break;
    case 'sr3': state.keyActive=(state.keyActive||0)+1; resultText='Key!'; break;
    case 'l1': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];const wiped=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===t){cells[ro][co].count=0;cells[ro][co].owner=-1;wiped.push([ro,co]);}vfxData={wiped};resultText=`Annihilate!`;} break; }
    case 'l2': { for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) cells[ro][co].count=cells[ro][co].cap; resultText='Nuclear!'; break; }
    case 'l3': { const empts=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===-1) empts.push([ro,co]); empts.forEach(([ro,co])=>{cells[ro][co].owner=cur;cells[ro][co].count=1;}); const mid=rows/2; let md=0; empts.forEach(([ro,co])=>{const d=Math.abs(ro-mid)+Math.abs(co-cols/2);if(d>md)md=d;}); vfxData={empties:empts,maxDist:md,owner:cur};resultText='Dominion!'; break; }
    case 'l4': { const ec2=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner!==cur&&cells[ro][co].owner!==-1) ec2.push([ro,co]); ec2.sort(()=>Math.random()-.5); const invaded=ec2.slice(0,3); invaded.forEach(([ro,co])=>cells[ro][co].owner=cur); vfxData={invaded};resultText='Invasion!'; break; }
    case 'l5': { if(cells[r][c].owner!==-1) return {ok:false,msg:'วางได้เฉพาะช่องว่าง'}; if(!state.alive.includes(cur)){state.alive.push(cur);state.alive.sort((a,b)=>a-b);} cells[r][c].count=3;cells[r][c].owner=cur;state.moved[cur]=true;vfxData={target:[r,c]};resultText='Rebirth!'; break; }
    case 'm1': { let totalOrbs=0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++){if(ro===r&&co===c)continue;if(cells[ro][co].count>0){const taken=Math.ceil(cells[ro][co].count/2);totalOrbs+=taken;cells[ro][co].count-=taken;if(!cells[ro][co].count)cells[ro][co].owner=-1;}} cells[r][c].count+=totalOrbs;cells[r][c].owner=cur;resultText='Singularity!'; break; }
    case 'm2': { const exploded=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){cells[ro][co].count=cells[ro][co].cap;exploded.push([ro,co]);} vfxData={exploded};resultText='Big Bang!'; break; }
  }

  return { ok: true, resultText, vfxData, needsExplosion: true };
}

// Export สำหรับ Node.js
if (typeof module !== 'undefined') {
  module.exports = {
    CARD_DEFS, RARITY_WEIGHTS, PLAYER_COLORS, PLAYER_NAMES, HAND_LIMIT,
    createInitialState, applyPlace, applyCard,
    processExplosionsSync, processExplosionsWithWaves, checkEliminations, checkWin,
    nextTurn, tickTimeBombs, draw3UniqueCards, drawRandomCard, neighbors,
  };
}
