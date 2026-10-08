// ══ SHARED GAME LOGIC ══
// ใช้ร่วมกันระหว่าง server และ client
// ไม่มี DOM, ไม่มี window, ไม่มี document
//
// โหลดได้ 3 ทาง ด้วยไฟล์เดียวกันนี้:
//   · Node:                 require('../shared/gameLogic')
//   · เบราว์เซอร์ (<script>): window.CRLogic — ทุกชื่อข้างในอยู่ในฟังก์ชันปิด ไม่ชนกับ global ของ client/index.html
//   · โหมด Firebase:        client/fb-transport.js อ่านไฟล์นี้แล้วรันด้วย new Function('require','module','exports', src)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CRLogic = api;
})(typeof window !== 'undefined' ? window : null, function () {

// นิยามการ์ดทั้งหมด — ที่เดียวของทั้งเกม (client/index.html ใช้ชุดนี้ผ่าน CRLogic.CARD_DEFS)
//   ownOnly      ใช้ได้เฉพาะช่องของตัวเองที่มีลูก          twoTarget   ต้องเลือก 2 ช่อง
//   rebirthOnly  ใช้ได้เมื่อตายแล้ว                        anyTarget   ไม่ต้องเลือกช่อง (กดใช้ได้เลย)
//   offlineOnly  มีเฉพาะโหมดออฟไลน์ — server ไม่สุ่มแจก (ดู drawRandomCard)
// ขีดจำกัดต่อเกม (ตรวจใน applyCard): rarity legendary 2 ครั้ง · mythical 1 ครั้ง · ใบอื่นไม่จำกัด
const CARD_DEFS = [
  {id:'c1',emoji:'⚡',name:'Overload',rarity:'uncommon',cat:'burst',desc:'เพิ่มลูกบอล +2 ในช่องของตัวเองที่เลือก',needTarget:true,targetSelf:true,ownOnly:true},
  {id:'c2',emoji:'💠',name:'Pulse',rarity:'uncommon',cat:'burst',desc:'ช่องรอบๆ ที่เลือก +1 ทุกช่อง',needTarget:true,targetSelf:true},
  {id:'c3',emoji:'🎯',name:'Sniper',rarity:'common',cat:'attack',desc:'เลือกช่องศัตรู -1 ลูกบอล',needTarget:true,targetSelf:false},
  {id:'c4',emoji:'⚖️',name:'Exchange',rarity:'uncommon',cat:'chaos',desc:'+2 ช่องตัวเองที่เลือก แล้วสุ่มช่องศัตรู -2',needTarget:true,targetSelf:true},
  {id:'c5',emoji:'🌀',name:'Spin',rarity:'common',cat:'chaos',desc:'เลือกช่องตัวเองที่มีลูก แล้วเลือกช่องติดกันที่จะย้ายลูกทั้งหมดไป',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'c6',emoji:'🧲',name:'Attract',rarity:'common',cat:'burst',desc:'ดึงลูกบอลจากข้างๆ มารวม',needTarget:true,targetSelf:true},
  {id:'c7',emoji:'💢',name:'Poke',rarity:'common',cat:'attack',desc:'เพิ่มลูกบอลศัตรู +1 (ใกล้ระเบิด!)',needTarget:true,targetSelf:false},
  {id:'c8',emoji:'🛡️',name:'Shield',rarity:'common',cat:'defense',desc:'ช่องนั้นไม่ระเบิด 1 เทิร์น',needTarget:true,targetSelf:true},
  {id:'c9',emoji:'🪣',name:'Drain',rarity:'common',cat:'attack',desc:'ดูดช่องศัตรู -1 แล้วตัวเอง +1 สุ่ม',needTarget:true,targetSelf:false},
  {id:'c10',emoji:'🔄',name:'Cycle',rarity:'common',cat:'strategy',desc:'ทิ้งการ์ดทั้งหมด แล้วจั่ว 1 ใบใหม่',needTarget:false},
  {id:'c11',anyTarget:true,emoji:'📦',name:'Store',rarity:'common',cat:'burst',desc:'+1 สองช่องของตัวเองสุ่ม',needTarget:false},
  {id:'c12',emoji:'🔍',name:'Scout',rarity:'common',cat:'strategy',desc:'ดูการ์ดในมือของผู้เล่นอื่นสุ่ม',needTarget:false},
  {id:'u1',emoji:'💣',name:'Instant Burst',rarity:'uncommon',cat:'burst',desc:'ช่องของตัวเองที่เลือกระเบิดทันที',needTarget:true,targetSelf:true,ownOnly:true},
  {id:'u2',emoji:'🔁',name:'Swap',rarity:'uncommon',cat:'strategy',desc:'สลับตำแหน่ง 2 ช่องบนกระดาน',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'u3',emoji:'💥',name:'Double Shot',rarity:'uncommon',cat:'burst',desc:'+1 สองช่องของตัวเองที่เลือก',needTarget:true,targetSelf:true,twoTarget:true,ownOnly:true},
  {id:'u4',anyTarget:true,emoji:'🧱',name:'Wall',rarity:'uncommon',cat:'defense',desc:'ป้องกัน 3 ช่องของตัวเอง 1 เทิร์น',needTarget:false},
  {id:'u5',emoji:'⏳',name:'Time Bomb',rarity:'super_rare',cat:'chaos',desc:'อีก 2 เทิร์น ช่องนั้นระเบิดเอง',needTarget:true,targetSelf:false},
  {id:'u6',emoji:'⚔️',name:'Raid',rarity:'uncommon',cat:'attack',desc:'ลบลูกบอลศัตรู -2',needTarget:true,targetSelf:false},
  {id:'u7',emoji:'🎪',name:'Shuffle Zone',rarity:'uncommon',cat:'chaos',desc:'สุ่มตำแหน่งช่องใน 3×3 แต่รวมบอลแต่ละฝ่ายเท่าเดิม',needTarget:true,targetSelf:true},
  {id:'u9',emoji:'📌',name:'Pin',rarity:'uncommon',cat:'defense',desc:'ช่องศัตรูที่เลือกระเบิดไม่ได้ ตลอดตาถัดไปของเจ้าของช่อง',needTarget:true,targetSelf:false},
  {id:'u8',emoji:'🔃',name:'Mirror',rarity:'uncommon',cat:'chaos',desc:'คัดลอกจำนวนลูกบอลของช่องศัตรู มาใส่ช่องตัวเองที่ใกล้ที่สุด',needTarget:true,targetSelf:false},
  {id:'r1',emoji:'🌋',name:'Mega Burst',rarity:'rare',cat:'burst',desc:'เพิ่มลูกบอล +1 พื้นที่ 3×3',needTarget:true,targetSelf:true},
  {id:'r2',emoji:'🕳️',name:'Black Hole',rarity:'rare',cat:'chaos',desc:'ดูดลูกบอลรอบๆ ทั้งหมดมารวม',needTarget:true,targetSelf:true},
  {id:'r3',anyTarget:true,emoji:'🧊',name:'Freeze',rarity:'rare',cat:'defense',desc:'คู่ต่อสู้สุ่มข้ามเทิร์นถัดไป',needTarget:false},
  {id:'r4',anyTarget:true,emoji:'🏹',name:'Barrage',rarity:'epic',cat:'attack',desc:'ทุกช่องของศัตรูสุ่ม -1',needTarget:false},
  {id:'r5',anyTarget:true,emoji:'🌪️',name:'Tornado',rarity:'rare',cat:'chaos',desc:'สุ่มย้ายลูกบอล 20% ของแผนที่',needTarget:false},
  {id:'r6',anyTarget:true,emoji:'🪞',name:'Reflect',rarity:'super_rare',cat:'defense',desc:'ป้องกันทุกช่องของตัวเอง 1 เทิร์น',needTarget:false},
  {id:'e1',emoji:'☄️',name:'Meteor',rarity:'epic',cat:'burst',desc:'ช่องนั้นระเบิด 2 รอบ',needTarget:true,targetSelf:true},
  {id:'e2',emoji:'🌊',name:'Tsunami',rarity:'super_rare',cat:'chaos',desc:'ทุกช่องใน row เดียวกัน +1',needTarget:true,targetSelf:true},
  {id:'e3',emoji:'🎭',name:'Steal',rarity:'epic',cat:'attack',desc:'ขโมยช่องศัตรู 1 ช่อง (ทะลุโล่)',needTarget:true,targetSelf:false},
  {id:'c13',emoji:'🎲',name:'Gamble',rarity:'common',cat:'chaos',desc:'สุ่ม -2 ถึง +2 ในช่องที่เลือก',needTarget:true,targetSelf:true,offlineOnly:true},
  {id:'c14',emoji:'🪄',name:'Boost',rarity:'uncommon',cat:'burst',desc:'ช่องที่เลือก +1 และช่องตัวเองข้างๆ +1 ด้วย',needTarget:true,targetSelf:true,offlineOnly:true},
  {id:'u10',emoji:'🎁',name:'Gift',rarity:'common',cat:'chaos',desc:'ช่องตัวเองที่เลือก +2 แล้วสุ่ม 2 ช่องของศัตรู +1',needTarget:true,targetSelf:true},
  {id:'r7',emoji:'⬛',name:'Void',rarity:'rare',cat:'chaos',desc:'ช่องตัวเองที่เลือกหายไปจากกระดานจนถึงตาที่ 2 ของเรา ไม่มีใครวางหรือส่งลูกเข้าได้ แล้วกลับมาพร้อมลูกเดิม',needTarget:true,targetSelf:true},
  {id:'r8',anyTarget:true,emoji:'🔙',name:'Rewind',rarity:'epic',cat:'strategy',desc:'ย้อนกระดานกลับไปก่อน action ล่าสุด (ผู้เล่นที่เพิ่งตกรอบกลับมาด้วย)',needTarget:false},
  {id:'sr1',emoji:'🪓',name:'Sever',rarity:'rare',cat:'defense',desc:'เลือก 2 ช่องของตัวเอง ระเบิดออกไม่ได้ 4 ตาของเรา',needTarget:true,targetSelf:true,twoTarget:true},
  {id:'sr2',anyTarget:true,emoji:'🌑',name:'Eclipse',rarity:'super_rare',cat:'chaos',desc:'ทุกคนมองไม่เห็นจำนวนลูกบอลของกันและกัน 2 เทิร์น',needTarget:false},
  {id:'sr3',anyTarget:true,emoji:'🔑',name:'Key',rarity:'rare',cat:'strategy',desc:'การ์ดถัดไปที่เราจั่วได้จะเป็น rare ขึ้นไปแน่นอน',needTarget:false},
  {id:'ep3',anyTarget:true,emoji:'⚖️',name:'Balance',rarity:'epic',cat:'chaos',desc:'เฉลี่ยจำนวนลูกบอลทุกช่องบนกระดานให้เท่ากัน',needTarget:false},
  {id:'ep4',anyTarget:true,emoji:'🕐',name:'Delay',rarity:'super_rare',cat:'strategy',desc:'ข้ามตาเราไป 1 ตา แต่ตาต่อไปทำได้ 2 action (วางบอล/ใช้การ์ดรวมกัน)',needTarget:false,offlineOnly:true},
  {id:'ep5',anyTarget:true,emoji:'💫',name:'Nova',rarity:'super_rare',cat:'burst',desc:'เพิ่ม +2 รอบๆ ช่องตัวเองที่ใกล้ระเบิดที่สุด',needTarget:false},
  {id:'ep6',anyTarget:true,emoji:'🔥',name:'Inferno',rarity:'epic',cat:'burst',desc:'ทุกช่องตัวเองที่มีลูกบอล +1 พร้อมกัน',needTarget:false},
  {id:'l1',anyTarget:true,emoji:'💀',name:'Annihilate',rarity:'mythical',cat:'legendary',desc:'ลบลูกบอลทั้งหมดของคู่ต่อสู้สุ่ม (Mythical ใช้ได้ 1 ครั้ง/เกม)',needTarget:false},
  {id:'l2',anyTarget:true,emoji:'☢️',name:'Nuclear',rarity:'legendary',cat:'legendary',desc:'ทุกช่องที่มีลูกบอลระเบิดพร้อมกัน (Legendary ใช้ได้ 2 ครั้ง/เกม)',needTarget:false},
  {id:'l3',anyTarget:true,emoji:'👑',name:'Dominion',rarity:'legendary',cat:'legendary',desc:'ทุกช่องว่างบนกระดานกลายเป็นของตัวเองพร้อม 1 ลูกบอล (Legendary ใช้ได้ 2 ครั้ง/เกม)',needTarget:false},
  {id:'l4',anyTarget:true,emoji:'🛸',name:'Invasion',rarity:'super_rare',cat:'legendary',desc:'แปลงช่องศัตรูสุ่ม 3 ช่องเป็นช่องตัวเอง (ทะลุโล่)',needTarget:false},
  {id:'m1',emoji:'🪐',name:'Singularity',rarity:'legendary',cat:'mythical',desc:'ดูด 50% ของลูกบอลทุกช่องบนกระดานมารวมที่ช่องตัวเองที่เลือก (Legendary ใช้ได้ 2 ครั้ง/เกม)',needTarget:true,targetSelf:true},
  {id:'m2',anyTarget:true,emoji:'🌌',name:'Big Bang',rarity:'mythical',cat:'mythical',desc:'ทุกช่องตัวเองระเบิดพร้อมกัน แล้วทุกช่องที่ระเบิดได้ +2 คืนมา (Mythical ใช้ได้ 1 ครั้ง/เกม)',needTarget:false},
  {id:'l5',emoji:'🔮',name:'Rebirth',rarity:'legendary',cat:'legendary',desc:'คืนชีพ! เลือกช่องว่างแล้ววางบอล 3 ลูก ใช้ได้เมื่อตายแล้วเท่านั้น (Legendary ใช้ได้ 2 ครั้ง/เกม)',needTarget:true,targetSelf:true,rebirthOnly:true},
  {id:'e4',anyTarget:true,emoji:'🏛️',name:'Pillar',rarity:'super_rare',cat:'chaos',desc:'เพิ่ม +1 ทุกช่องในแนวตั้ง (column) เดียวกัน กดช่องไหนก็ได้',needTarget:false},
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

// opts.offline = true: โหมดออฟไลน์ — จั่วการ์ด offlineOnly ได้ด้วย · ค่าเริ่มต้น (server) ไม่แจกใบพวกนั้น
// (ของเดิม 3 ใบนั้นมีแต่ใน client: ออนไลน์ไม่มีทางได้อยู่แล้ว แต่พอรวมนิยามเป็นชุดเดียวต้องกันไว้ตรงนี้)
function drawRandomCard(keyActive = 0, disabledCards = [], opts) {
  const disabled = new Set(disabledCards);
  const offline = !!(opts && opts.offline);
  const pool = [];
  const forceRare = keyActive > 0;
  CARD_DEFS.forEach(def => {
    if (disabled.has(def.id)) return; // ข้ามการ์ดที่ปิดไว้
    if (def.offlineOnly && !offline) return;
    if (forceRare) {
      if (['rare','super_rare','epic','legendary','mythical'].includes(def.rarity)) pool.push(def);
    } else {
      const w = RARITY_WEIGHTS[def.rarity] || 0;
      for (let i = 0; i < w; i++) pool.push(def);
    }
  });
  if (!pool.length) return CARD_DEFS[0]; // fallback
  return pool[Math.floor(Math.random() * pool.length)];
}

function draw3UniqueCards(keyActive = 0, disabledCards = [], opts) {
  const chosen = [];
  for (let i = 0; i < 40 && chosen.length < 3; i++) {
    const card = drawRandomCard(keyActive, disabledCards, opts);
    if (!chosen.find(x => x.id === card.id)) chosen.push(card);
  }
  return chosen;
}

// Key ของผู้เล่นคนนี้ (ทนกับ state เก่าที่ยังเป็นตัวเลขกลางห้อง → ถือว่าไม่มี)
function keyOf(state, slot) { return Array.isArray(state.keyActive) ? (state.keyActive[slot] || 0) : 0; }
// ตัวเลือก 3 ใบของรอบเลือกการ์ด: ถ้าผู้เล่นคนนี้มี Key จะได้ rare ขึ้นไป แล้ว Key ถูกใช้ไป (เฉพาะของเขา)
function drawPickChoices(state, slot) {
  const k = keyOf(state, slot);
  const cards = draw3UniqueCards(k, state.disabledCards || []);
  if (k > 0) state.keyActive[slot]--;
  return cards;
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
    eclipse: 0,
    keyActive: Array(players).fill(0), // Key เป็นของผู้เล่นแต่ละคน (ของเดิมเป็นค่ากลางทั้งห้อง)
    delayFor: -1, _pendingDelayFor: -1,
    voidCells: {}, voidSnapshot: {},
    severed: {}, pinned: {}, catalyzed: {},
    voidOwner: {}, severedOwner: {}, pinnedOwner: {}, pinnedBy: {}, // เจ้าของเอฟเฟกต์ — ใช้ตัดสินว่านับถอยหลังตอนไหน (tickEffects)
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

// ผู้ตายยังได้ตา / ยังกันไม่ให้เกมจบ ก็ต่อเมื่อ Rebirth ในมือ "ใช้ได้จริง":
// ยังไม่ชนเพดาน Legendary 2 ครั้ง และยังมีช่องว่างให้เกิดใหม่ — ไม่งั้นเกมจะวนรอคนที่ไม่มีวันฟื้น
function rebirthUsable(state, i) {
  return !!(state.hands[i] && state.hands[i].some(d => d.id === 'l5'))
    && (state.legendaryUsedBy[i] || 0) < 2
    && state.cells.some(row => row.some(ce => ce.owner === -1));
}

// ── Snapshot สำหรับ Rewind ──
// เก็บ "สภาพกระดานก่อน action นี้": ช่อง + ใครยังอยู่ + เอฟเฟกต์ที่ติดกับกระดาน — ไม่เก็บมือการ์ด/โควตา (การ์ดที่ใช้ไปแล้วไม่คืน)
// (ของเดิมเก็บแค่ count/owner: ผู้เล่นที่เพิ่งถูกคัดออกไม่กลับมา และโล่ / Void / Sever / Pin / Time Bomb ไม่ย้อนตาม)
const SNAP_FIELDS = ['alive', 'shielded', 'shieldOwner', 'voidCells', 'voidSnapshot', 'voidOwner', 'severed', 'severedOwner', 'pinned', 'pinnedOwner', 'pinnedBy', 'timeBombs'];
function takeSnapshot(state) {
  const snap = { cells: state.cells.map(row => row.map(ce => ({ count: ce.count, owner: ce.owner }))) };
  SNAP_FIELDS.forEach(f => { snap[f] = state[f] === undefined ? null : state[f]; });
  state._snapshot = JSON.parse(JSON.stringify(snap));
}
// คืน diff ของช่องที่เปลี่ยน (ให้ VFX) หรือ null ถ้าไม่มี snapshot · ใช้แล้ว snapshot หมดไป
function restoreSnapshot(state) {
  const snap = state._snapshot;
  if (!snap || !snap.cells) return null;
  const diff = [];
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) {
    const now = state.cells[r][c], old = snap.cells[r][c];
    if (now.count !== old.count || now.owner !== old.owner) diff.push({ r, c, fromCount: now.count, fromOwner: now.owner, toCount: old.count, toOwner: old.owner });
    now.count = old.count; now.owner = old.owner;
  }
  SNAP_FIELDS.forEach(f => { if (snap[f] !== null && snap[f] !== undefined) state[f] = snap[f]; });
  state._snapshot = null;
  return diff;
}

// ── Apply place action ──
function applyPlace(state, playerIdx, r, c) {
  const { rows, cols, cells } = state;
  // ตกรอบแล้ววางบอลปกติไม่ได้ (ของเดิมไม่ตรวจ: ผู้ตายที่ได้ตาเพราะถือ Rebirth วางบอลได้ทั้งที่ไม่ได้อยู่ใน alive)
  if (!state.alive.includes(playerIdx)) return { ok: false, msg: 'ตกรอบแล้ว — ใช้การ์ด Rebirth เพื่อคืนชีพ' };
  if (isVoidCell(state, r, c)) return { ok: false, msg: 'ช่องนั้นหายไปจากกระดานอยู่ (Void)' };
  const cell = cells[r][c];
  const hasOwnCells = cells.some(row => row.some(ce => ce.owner === playerIdx));

  if (hasOwnCells && cell.owner !== playerIdx) return { ok: false, msg: 'วางได้เฉพาะช่องของตัวเองเท่านั้น' };
  if (!hasOwnCells && cell.owner !== -1 && cell.owner !== playerIdx) return { ok: false, msg: 'ช่องนี้เป็นของคนอื่น' };
  if (state.moved[playerIdx]) return { ok: false, msg: 'ใช้ action ไปแล้วในเทิร์นนี้' };
  if (state.frozen[playerIdx] > 0) return { ok: false, msg: 'ถูก Freeze!' };

  const isFirstPlace = !hasOwnCells;
  takeSnapshot(state);
  state.moved[playerIdx] = true;
  cell.count += isFirstPlace ? 3 : 1;
  cell.owner = playerIdx;

  return { ok: true, isFirstPlace };
}

// ── Process explosions (sync, returns changed cells) ──
// คืน array ของ waves สำหรับ animation (online mode)
// ── เวลาของเอฟเฟกต์ ──
// ที่เดียวที่ทั้ง server (ต่อเวลานาฬิกาตา / หน่วงหน้าเลือกการ์ด) และ client (คิวเอฟเฟกต์, โหมดออฟไลน์) ใช้
// แก้ตัวเลขที่นี่แล้วทั้งสองฝั่งเปลี่ยนตาม — ไม่มีตารางสำเนาให้ลืมแก้
const FX_TIMING = {
  WAVE_MS: 520,        // เวลาต่อ wave ปกติ
  WAVE_FAST_MS: 170,   // client มีงานค้าง: เร่ง
  WAVE_MIN_MS: 90,     // ขั้นภาพสั้นสุด — ลูกโซ่ที่ต้องเร็วกว่านี้ client รวมหลาย wave เป็นขั้นภาพเดียว
  CHAIN_CAP_MS: 8000,  // ลูกโซ่ยาวแค่ไหนก็เล่นจบในเวลานี้
  CARD_GAP_MS: 200,    // เว้นหลัง VFX การ์ดก่อนเริ่มลูกโซ่
  SETTLE_MS: 300,      // เผื่อให้อนุภาคนิ่งก่อนตาถัดไป
};
const CARD_VFX_MS = {
  c1:600,c2:1400,c3:1100,c4:1400,c5:700,c6:900,c7:500,c8:700,c9:1300,c10:500,c11:700,c12:500,c13:800,c14:1300,
  u1:400,u2:700,u3:700,u4:700,u5:500,u6:1100,u7:600,u8:700,u9:600,u10:1100,u11:500,
  r1:700,r2:900,r3:900,r4:1500,r5:1300,r6:700,r7:700,r8:1400,
  sr1:600,sr2:900,sr3:500,
  ep3:1000,ep4:600,ep5:1400,ep6:1200,e1:500,e2:800,e3:500,e4:800,
  l1:1400,l2:1800,l3:1800,l4:1400,l5:1300,m1:1800,m2:1500,
};
// VFX ของการ์ดใบนี้ยาวกี่ ms (บางใบขึ้นกับผลของมัน เช่น Dominion ไล่ตามระยะ)
function cardVfxMs(cardId, vfxData) {
  const v = vfxData || {};
  return (v.dur || v.novaDur || CARD_VFX_MS[cardId] || 500) + (cardId === 'l3' ? (v.maxDist || 0) * 55 + 900 : 0);
}
// เวลาต่อ wave ของลูกโซ่ n wave: ปกติ 520ms แต่ทั้งลูกโซ่ต้องจบใน CHAIN_CAP_MS
function waveStepMs(n) { return Math.min(FX_TIMING.WAVE_MS, FX_TIMING.CHAIN_CAP_MS / Math.max(1, n)); }
// เวลารวมที่ client ใช้เล่นเอฟเฟกต์ของ update หนึ่งก้อน
function animMs(nWaves, cardId, vfxData) {
  const n = nWaves || 0;
  return Math.round((cardId ? cardVfxMs(cardId, vfxData) + FX_TIMING.CARD_GAP_MS : 0) + n * waveStepMs(n) + (n || cardId ? FX_TIMING.SETTLE_MS : 0));
}

// ── บันทึกลูกโซ่ให้ client เล่นตาม (state._fx) ──
// client ไม่คำนวณกฎระเบิดเอง: เริ่มจาก base (กระดานก่อน wave แรก) แล้ววาดค่าที่ server บอกทีละ wave
//   base  = [count, owner, ...] ทุกช่อง เรียงทีละแถว
//   waves = [{ e: [r, c, owner, ...] ช่องที่ระเบิด, d: [r, c, count, owner, ...] ค่าใหม่ของช่องที่เปลี่ยนหลัง wave นี้,
//              b: [r, c, count, owner, ...] (ถ้ามี) สิ่งที่เปลี่ยน "ก่อน" wave นี้โดยไม่ใช่การระเบิด เช่น Time Bomb เติมช่องจนเต็ม }]
// server ส่งไปกับ room_update ครั้งเดียวแล้วล้าง (sanitizeState)
const FX_MAX_WAVES = 400; // เพดานกันพัง: เกินนี้เลิกบันทึก (truncated) แล้วให้ client จบด้วยการซิงก์
function fxPack(state) {
  const out = [];
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) { const ce = state.cells[r][c]; out.push(ce.count, ce.count > 0 ? ce.owner : -1); }
  return out;
}
// ช่องที่ต่างจาก shadow → [r, c, count, owner, ...] แล้วอัปเดต shadow ให้ตรง
function fxDiff(state, shadow) {
  const out = [];
  let i = 0;
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++, i += 2) {
    const ce = state.cells[r][c], ow = ce.count > 0 ? ce.owner : -1;
    if (shadow[i] !== ce.count || shadow[i + 1] !== ow) { out.push(r, c, ce.count, ow); shadow[i] = ce.count; shadow[i + 1] = ow; }
  }
  return out;
}

// ── การระเบิด: กติกาที่เดียว ──
// server (บันทึกลูกโซ่ให้ client), บอท (จำลอง) และโหมดออฟไลน์ (เล่นทีละ wave พร้อมแอนิเมชัน) เรียก explodeWave ตัวเดียวกัน
// (ของเดิมมีสามสำเนาที่ไม่ตรงกัน: ฉบับที่ server ใช้ปล่อยให้ลูกเข้าช่องมีโล่และพลิกเจ้าของได้, บวกความจุ +1 ตอน Eclipse,
//  และใช้เจ้าของที่ถูกเขียนทับกลาง wave เมื่อสองช่องติดกันของคนละฝ่ายระเบิดพร้อมกัน)
//
// หนึ่ง wave: ทุกช่องที่ครบความจุระเบิดพร้อมกัน — หักความจุออก แล้วส่ง +1 ให้เพื่อนบ้านในกระดานและยึดเป็นของผู้ระเบิด
//   · ช่องที่ถูก Void / Sever / Pin หรือมีโล่ ไม่ระเบิด
//   · ลูกไม่เข้าช่อง Void (หายไป) และไม่เข้าช่องมีโล่ของคนอื่น (หายไป) — โล่ของผู้ระเบิดเองรับลูกได้
// คืน null ถ้าไม่มีช่องไหนระเบิด · ไม่งั้นคืน { explosions: [{r, c, owner}], touched: Set<r*cols+c> }
function explodeWave(state) {
  const { rows, cols, cells } = state;
  const voidCells = state.voidCells || {}, severed = state.severed || {}, pinned = state.pinned || {}, catalyzed = state.catalyzed || {};
  const explosions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      if (cell.count <= 0 || state.shielded[r][c] > 0) continue;
      const key = `${r},${c}`;
      if ((voidCells[key] || 0) > 0 || (severed[key] || 0) > 0 || (pinned[key] || 0) > 0) continue;
      if (cell.count >= (catalyzed[key] ? 2 : (cell.cap || 4))) explosions.push({ r, c, owner: cell.owner });
    }
  }
  if (!explosions.length) return null;
  const touched = new Set();
  // หักออกทุกช่องก่อน แล้วค่อยกระจาย — เจ้าของของแต่ละการระเบิดคือเจ้าของ "ก่อน" wave นี้
  explosions.forEach(({ r, c }) => {
    const cell = cells[r][c];
    cell.count -= cell.cap || 4;
    if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
    touched.add(r * cols + c);
  });
  explosions.forEach(({ r, c, owner }) => {
    neighbors(r, c, rows, cols).forEach(([nr, nc]) => {
      if ((voidCells[`${nr},${nc}`] || 0) > 0) return;
      if (state.shielded[nr][nc] > 0 && state.shieldOwner[nr][nc] !== owner) return;
      cells[nr][nc].count++;
      cells[nr][nc].owner = owner;
      touched.add(nr * cols + nc);
    });
  });
  return { explosions, touched };
}
const explodeGuard = state => state.rows * state.cols * 4; // กันวนไม่จบ

// ระเบิดจนนิ่งโดยไม่บันทึกอะไร (บอทจำลอง / เทสต์) — คืนจำนวน wave
function processExplosionsSync(state) {
  let n = 0;
  const max = explodeGuard(state);
  while (explodeWave(state)) { if (++n > max) break; }
  return n;
}

// ระเบิดจนนิ่ง + บันทึกลูกโซ่ลง state._fx ให้ client เล่นตาม · คืน [{ explosions }] ของการเรียกครั้งนี้
// opts.maxWaves: เพดานจำนวน wave ที่บันทึก (ชุดทดสอบใช้ค่าต่ำๆ)
function processExplosionsWithWaves(state, opts) {
  const { cols, cells } = state;
  const allWaves = [];
  const maxWaves = (opts && opts.maxWaves) || FX_MAX_WAVES;

  // เรียกครั้งแรกของตานี้: กระดานตอนนี้คือ base · เรียกซ้ำ (Time Bomb ระเบิดตามหลัง, รอบสองของ Meteor / Big Bang):
  // สิ่งที่เปลี่ยนไปตั้งแต่ wave ล่าสุดคือ b ของ wave ถัดไป
  let before = null;
  if (!state._fx) { const base = fxPack(state); state._fx = { base, shadow: base.slice(), waves: [], truncated: false }; }
  else before = fxDiff(state, state._fx.shadow);
  const fx = state._fx;

  const max = explodeGuard(state);
  let w;
  while ((w = explodeWave(state))) {
    allWaves.push({ explosions: w.explosions });
    if (fx.waves.length < maxWaves) {
      const e = [], d = [];
      w.explosions.forEach(x => e.push(x.r, x.c, x.owner));
      w.touched.forEach(k => {
        const r = Math.floor(k / cols), c = k % cols, ce = cells[r][c], ow = ce.count > 0 ? ce.owner : -1;
        d.push(r, c, ce.count, ow);
        fx.shadow[k * 2] = ce.count; fx.shadow[k * 2 + 1] = ow;
      });
      const rec = { e, d };
      if (before && before.length) rec.b = before;
      before = null;
      fx.waves.push(rec);
    } else fx.truncated = true;
    if (allWaves.length > max) break;
  }
  return allWaves;
}
// การ์ดที่ระเบิดในตัวเอง (Meteor / Big Bang): server บันทึกลูกโซ่ · สถานะจำลองของบอท (state._sim) ไม่ต้อง
const runExplosions = state => (state._sim ? processExplosionsSync(state) : processExplosionsWithWaves(state).length);

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
      if (!state.alive.includes(i) && state.moved[i] && rebirthUsable(state, i)) {
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

// ── เอฟเฟกต์ที่ค้างบนกระดาน: นับถอยหลังตอนเปลี่ยนตา ──
// เอฟเฟกต์ที่มีเจ้าของนับเฉพาะเมื่อ "ถึงตาเจ้าของ" (เหมือนโล่) — ไม่ใช่ทุกครั้งที่ใครก็ตามเปลี่ยนตา
// (ของเดิม Void / Sever / Pin ลดทุกการเปลี่ยนตา: เล่น 6 คนหมดก่อนครบรอบ และ Pin หมดก่อนถึงตาของคนที่โดน)
//   โล่        ลดเมื่อถึงตาเจ้าของโล่
//   Void      ลดเมื่อถึงตาผู้ใช้ (voidOwner) — 2 = อยู่ถึงตาที่สองของผู้ใช้ แล้วช่องกลับมาพร้อมลูกเดิม
//   Sever     ลดเมื่อถึงตาผู้ใช้ (severedOwner) — 4 ตาของผู้ใช้
//   Pin       หมดเมื่อ "เจ้าของช่องที่โดน Pin" เล่นตาของเขาจบ (กันระเบิดตลอดลูกโซ่ของตานั้น) หรือวนกลับมาถึงผู้ใช้
//   Eclipse   ลดทุกการเปลี่ยนตา (เป็นของทั้งห้อง)
// เจ้าของที่ตกรอบไปแล้ว (ไม่มีตาอีก) → นับทุกการเปลี่ยนตาแทน ไม่งั้นเอฟเฟกต์จะค้างตลอดเกม · ข้อมูลเก่าที่ไม่มีเจ้าของก็นับทุกตาเหมือนเดิม
function tickEffects(state, nextPlayer, prevPlayer) {
  const { rows, cols } = state;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.shielded[r][c] > 0 && state.shieldOwner[r][c] === nextPlayer) {
        state.shielded[r][c]--;
        if (state.shielded[r][c] <= 0) state.shieldOwner[r][c] = -1;
      }
    }
  }
  if (state.eclipse > 0) state.eclipse--;

  const due = owner => owner === undefined || owner === null || owner === nextPlayer || !state.alive.includes(owner);
  const vo = state.voidOwner || {}, so = state.severedOwner || {}, po = state.pinnedOwner || {}, pb = state.pinnedBy || {};
  Object.keys(state.voidCells || {}).forEach(k => {
    if (!due(vo[k])) return;
    if (--state.voidCells[k] > 0) return;
    if (state.voidSnapshot && state.voidSnapshot[k]) {
      const [ro, co] = k.split(',').map(Number);
      state.cells[ro][co].count = state.voidSnapshot[k].count;
      state.cells[ro][co].owner = state.voidSnapshot[k].count > 0 ? state.voidSnapshot[k].owner : -1;
      delete state.voidSnapshot[k];
    }
    delete state.voidCells[k]; delete vo[k];
  });
  Object.keys(state.severed || {}).forEach(k => {
    if (!due(so[k])) return;
    if (--state.severed[k] <= 0) { delete state.severed[k]; delete so[k]; }
  });
  Object.keys(state.pinned || {}).forEach(k => {
    const owner = po[k];
    const over = owner === undefined || owner === null || owner === prevPlayer || pb[k] === nextPlayer || !state.alive.includes(owner);
    if (!over) return;
    if (--state.pinned[k] <= 0) { delete state.pinned[k]; delete po[k]; delete pb[k]; }
  });
  Object.keys(state.catalyzed || {}).forEach(k => { if (--state.catalyzed[k] <= 0) delete state.catalyzed[k]; });
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
  const canPlay = i => state.alive.includes(i) || rebirthUsable(state, i);
  while (!canPlay(next)) {
    next = (next + 1) % state.players;
    if (++guard > state.players) break;
  }
  state.current = next;
  state.moved[next] = false;
  tickEffects(state, next, prev);
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

// ── เป้าหมายของการ์ด ──
// กฎชุดเดียวที่ server (ก่อนแก้ state), client ออนไลน์ (ก่อนส่ง), โหมดออฟไลน์ และบอท ใช้ร่วมกัน
// (ของเดิม: client ออนไลน์ไม่ตรวจเลย ส่วน server ตรวจแค่ 3 ใบ → ใช้การ์ดของตัวเองบนช่องศัตรูเพื่อพลิกช่องได้)
//
//   rebirthOnly            → ผู้เล่นตายแล้ว + ช่องว่าง
//   ownOnly (c1, u1, u3)   → ช่องตัวเองที่มีลูก
//   targetSelf             → ช่องตัวเองหรือช่องว่าง (ใบใน EMPTY_OK) · ใบอื่น: ช่องตัวเองที่มีลูก
//   ไม่ใช่ targetSelf       → ช่องศัตรูที่มีลูก (c3, c9, u6 ต้องไม่มีโล่ด้วย)
//   สองเป้า                → ช่องต่างกัน · Spin: ช่องสองติดกัน · Double Shot / Sever: ช่องสองเป็นของเราด้วย · Swap: ช่องสองเป็นช่องไหนก็ได้
//   ช่องที่ถูก Void อยู่      → เลือกไม่ได้ทุกใบ
const EMPTY_OK = new Set(['c2', 'c4', 'c6', 'c8', 'u2', 'u7', 'r1', 'r2', 'e1', 'e2']);
const SHIELD_BLOCKS = new Set(['c3', 'c9', 'u6']);
const isVoidCell = (state, r, c) => ((state.voidCells && state.voidCells[`${r},${c}`]) || 0) > 0;

// opts.partial = true: การ์ดสองเป้าที่เพิ่งเลือกช่องแรก (ยังไม่มี r2/c2) ให้ตรวจเฉพาะช่องแรก — ใช้ตอนไฮไลต์/คลิกช่องแรกใน UI
function validateTargets(state, cardDef, playerIdx, targets, opts) {
  const { rows, cols, cells } = state;
  const me = playerIdx;
  const { r, c, r2, c2 } = (targets && typeof targets === 'object') ? targets : {};
  const bad = msg => ({ ok: false, msg });
  const inBoard = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a < rows && b >= 0 && b < cols;
  const has1 = r !== undefined || c !== undefined;
  const has2 = r2 !== undefined || c2 !== undefined;
  const needsCell = !!cardDef.needTarget || cardDef.id === 'e4'; // Pillar ใช้ column ของช่องที่เลือก

  if (needsCell && !has1) return bad('ต้องเลือกช่องก่อน');
  if (has1 && !inBoard(r, c)) return bad('ช่องอยู่นอกกระดาน');
  if (has2 && !inBoard(r2, c2)) return bad('ช่องอยู่นอกกระดาน');
  if (cardDef.twoTarget && !has2 && !(opts && opts.partial)) return bad('ต้องเลือก 2 ช่อง');
  if (cardDef.twoTarget && has2 && r === r2 && c === c2) return bad('ต้องเลือกช่องคนละช่อง');
  if (!needsCell) return { ok: true };

  const mine = (a, b) => cells[a][b].owner === me && cells[a][b].count > 0;
  const empty = (a, b) => cells[a][b].owner === -1 || cells[a][b].count <= 0;
  if (isVoidCell(state, r, c)) return bad('ช่องนั้นหายไปจากกระดานอยู่ (Void)');

  if (cardDef.rebirthOnly) {
    if (state.alive.includes(me)) return bad('Rebirth ใช้ได้เมื่อตายแล้วเท่านั้น');
    if (!empty(r, c)) return bad('วางได้เฉพาะช่องว่าง');
    return { ok: true };
  }
  if (cardDef.id === 'e4') return { ok: true }; // Pillar: ช่องไหนก็ได้ เพื่อบอก column

  if (cardDef.ownOnly || cardDef.id === 'c5') {
    if (!mine(r, c)) return bad('ต้องเลือกช่องของตัวเองที่มีลูกบอล');
  } else if (cardDef.targetSelf) {
    if (EMPTY_OK.has(cardDef.id)) { if (!mine(r, c) && !empty(r, c)) return bad('ต้องเลือกช่องของตัวเองหรือช่องว่าง'); }
    else if (!mine(r, c)) return bad('ต้องเลือกช่องของตัวเองที่มีลูกบอล');
  } else {
    if (mine(r, c) || empty(r, c)) return bad('ต้องเลือกช่องของคู่ต่อสู้ที่มีลูกบอล');
    if (SHIELD_BLOCKS.has(cardDef.id) && state.shielded[r][c] > 0) return bad('ช่องนั้นมีโล่ป้องกันอยู่');
  }

  if (cardDef.id === 'u8' && !cells.some(row => row.some(ce => ce.owner === me && ce.count > 0))) return bad('ยังไม่มีช่องของตัวเองให้คัดลอกมาใส่');

  if (cardDef.twoTarget && has2) {
    if (isVoidCell(state, r2, c2)) return bad('ช่องนั้นหายไปจากกระดานอยู่ (Void)');
    if (cardDef.id === 'c5' && !neighbors(r, c, rows, cols).some(([a, b]) => a === r2 && b === c2)) return bad('ต้องเลือกช่องที่ติดกัน');
    if ((cardDef.id === 'u3' || cardDef.id === 'sr1') && !mine(r2, c2)) return bad('ช่องที่สองต้องเป็นช่องของตัวเองที่มีลูกบอล');
  }
  return { ok: true };
}

// ── Apply card effect (returns {ok, resultText, vfxData}) ──
// ลำดับ: ตรวจทุกอย่าง → แก้ state → ตอบ · การ์ดที่ถูกปฏิเสธต้องไม่เปลี่ยน state เลย
function applyCard(state, playerIdx, cardDef, targets) {
  const { rows, cols, cells } = state;
  const cur = playerIdx;
  const { r, c, r2, c2 } = (targets && typeof targets === 'object') ? targets : {};
  let resultText = '';
  let vfxData = {};

  const v = validateTargets(state, cardDef, playerIdx, targets);
  if (!v.ok) return v;

  if (cardDef.rarity === 'legendary' && (state.legendaryUsedBy[cur] || 0) >= 2)
    return { ok: false, msg: 'Legendary ใช้ได้แค่ 2 ครั้งต่อเกม!' };
  if (cardDef.rarity === 'mythical' && state.mythicalUsedBy[cur])
    return { ok: false, msg: 'Mythical ใช้ได้แค่ 1 ครั้งต่อเกม!' };

  // Rewind ตอนยังไม่มีอะไรให้ย้อน: ปฏิเสธก่อนกินการ์ด (ของเดิมการ์ดหายเปล่า)
  if (cardDef.id === 'r8' && !(state._snapshot && state._snapshot.cells)) return { ok: false, msg: 'ยังไม่มีอะไรให้ย้อน' };

  // ── ผ่านทุกข้อแล้ว: เริ่มแก้ state ──
  let priv = null; // ผลที่ส่งให้ "คนใช้" คนเดียว (server ใส่ใน callback เท่านั้น ไม่ broadcast)
  if (cardDef.id !== 'r8') takeSnapshot(state);

  if (cardDef.id !== 'ep4') state.moved[cur] = true;

  const idx = state.hands[playerIdx].findIndex(d => d.id === cardDef.id);
  if (idx >= 0) state.hands[playerIdx].splice(idx, 1);

  if (cardDef.rarity === 'legendary') state.legendaryUsedBy[cur] = (state.legendaryUsedBy[cur] || 0) + 1;
  if (cardDef.rarity === 'mythical')  state.mythicalUsedBy[cur] = true;
  // ช่องที่การ์ดเติมลูก/ยึดได้: ของเราหรือว่าง และไม่ได้ถูก Void อยู่ (ลูกที่ใส่ลงช่อง Void จะหายตอนช่องกลับมา)
  const free = (ro, co) => (cells[ro][co].owner === cur || cells[ro][co].owner === -1) && !isVoidCell(state, ro, co);

  switch (cardDef.id) {
    case 'c1': cells[r][c].count += 2; cells[r][c].owner = cur; resultText = '+2!'; break;
    case 'c2': {
      const area = neighbors(r, c, rows, cols).filter(([nr,nc]) => free(nr, nc));
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
      const nr = r2 !== undefined ? r2 : r;
      const nc = c2 !== undefined ? c2 : c;
      const isNeighbor = nbs.some(([a,b]) => a===nr && b===nc);
      if (isNeighbor && cells[r][c].count > 0) {
        const ow = cells[r][c].owner;
        const moved = cells[r][c].count;
        cells[r][c].count = 0; cells[r][c].owner = -1;
        cells[nr][nc].count += moved; cells[nr][nc].owner = ow;
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
    case 'c10': { state.hands[playerIdx] = []; const k10 = keyOf(state, cur); const nc2 = drawRandomCard(k10, state.disabledCards || []); if (k10 > 0) state.keyActive[cur]--; /* Cycle = จั่วจริง: ใช้ Key ของเรา */ state.hands[playerIdx].push({...nc2}); resultText = `จั่ว ${nc2.name}!`; break; }
    case 'c11': {
      const own=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur) own.push([ro,co]);
      const picked = own.sort(()=>Math.random()-.5).slice(0,2); picked.forEach(([ro,co])=>cells[ro][co].count++);
      vfxData={boosted:picked}; resultText='+1 สองช่อง!'; break;
    }
    case 'c12': { // Scout: ดูมือของผู้เล่นอื่นที่สุ่ม — ผลไปใน priv เท่านั้น
      const others = state.alive.filter(i => i !== cur);
      if (others.length) {
        const t = others[Math.floor(Math.random() * others.length)];
        priv = { scout: { player: t, cards: (state.hands[t] || []).map(d => ({ id: d.id, name: d.name, emoji: d.emoji, rarity: d.rarity })) } };
      }
      resultText = 'Scout!'; break;
    }
    case 'c13': { const vals=[-2,-1,0,1,2]; const v=vals[Math.floor(Math.random()*vals.length)]; cells[r][c].count=Math.max(0,cells[r][c].count+v); cells[r][c].owner=cells[r][c].count>0?cur:-1; vfxData={value:v}; resultText=`Gamble: ${v>=0?'+':''}${v}!`; break; }
    case 'c14': { cells[r][c].count++; cells[r][c].owner=cur; const boosted=[[r,c]]; neighbors(r,c,rows,cols).forEach(([nr,nc])=>{if(cells[nr][nc].owner===cur){cells[nr][nc].count++;boosted.push([nr,nc]);}}); vfxData={boosted}; resultText='Boost!'; break; }
    case 'u1': cells[r][c].count=cells[r][c].cap; cells[r][c].owner=cur; resultText='Burst!'; break;
    case 'u2': { const tmp={...cells[r][c]}; cells[r][c]={...cells[r2][c2]}; cells[r2][c2]=tmp; cells[r][c].cap=capacity(); cells[r2][c2].cap=capacity(); vfxData={moves:[{from:[r,c],to:[r2,c2]},{from:[r2,c2],to:[r,c]}]}; resultText='Swap!'; break; }
    case 'u3': [[r,c],[r2,c2]].forEach(([ro,co])=>{ if(cells[ro][co].owner===cur||cells[ro][co].owner===-1){cells[ro][co].count++;cells[ro][co].owner=cur;} }); vfxData={boosted:[[r,c],[r2,c2]]}; resultText='+1 สองช่อง!'; break;
    case 'u4': { const own=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur) own.push([ro,co]); const sh3=own.sort(()=>Math.random()-.5).slice(0,3); sh3.forEach(([ro,co])=>{state.shielded[ro][co]=1;state.shieldOwner[ro][co]=cur;}); vfxData={shielded:sh3}; resultText='Wall!'; break; }
    case 'u5': state.timeBombs.push({r,c,turnsLeft:2,owner:cur}); resultText='Time Bomb!'; break;
    case 'u6': if(cells[r][c].owner!==cur&&state.shielded[r][c]<=0){cells[r][c].count=Math.max(0,cells[r][c].count-2);if(!cells[r][c].count)cells[r][c].owner=-1;vfxData={target:[r,c]};resultText='-2!';}; break;
    case 'u7': { // Shuffle Zone: สุ่มตำแหน่งของกองลูกใน 3×3 — จำนวนลูกของแต่ละฝ่ายเท่าเดิม · ไม่แตะช่อง Void
      const zone = [];
      for (let ro = Math.max(0, r - 1); ro <= Math.min(rows - 1, r + 1); ro++)
        for (let co = Math.max(0, c - 1); co <= Math.min(cols - 1, c + 1); co++)
          if (!isVoidCell(state, ro, co)) zone.push([ro, co]);
      const piles = zone.filter(([ro, co]) => cells[ro][co].count > 0).map(([ro, co]) => ({ count: cells[ro][co].count, owner: cells[ro][co].owner }));
      const spots = zone.slice();
      for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
      zone.forEach(([ro, co]) => { cells[ro][co].count = 0; cells[ro][co].owner = -1; });
      piles.forEach((p, i) => { const [ro, co] = spots[i]; cells[ro][co].count = p.count; cells[ro][co].owner = p.owner; });
      vfxData = { zone }; resultText = 'Shuffle!'; break;
    }
    case 'u8': { // Mirror: คัดลอกจำนวนลูกของช่องศัตรูที่เลือก มาใส่ช่องตัวเองที่ใกล้ที่สุด
      let best = null, bd = Infinity;
      for (let ro = 0; ro < rows; ro++) for (let co = 0; co < cols; co++) if (cells[ro][co].owner === cur && cells[ro][co].count > 0) {
        const d = Math.abs(ro - r) + Math.abs(co - c);
        if (d < bd) { bd = d; best = [ro, co]; }
      }
      if (best) { cells[best[0]][best[1]].count = cells[r][c].count; vfxData = { moves: [{ from: [r, c], to: best }] }; }
      resultText = 'Mirror!'; break;
    }
    case 'u9': { // Pin: กันช่องศัตรูระเบิดตลอดตาถัดไปของเจ้าของช่อง (ดู tickEffects)
      const k = `${r},${c}`;
      (state.pinned || (state.pinned = {}))[k] = 1;
      (state.pinnedOwner || (state.pinnedOwner = {}))[k] = cells[r][c].owner;
      (state.pinnedBy || (state.pinnedBy = {}))[k] = cur;
      vfxData = { target: [r, c] }; resultText = 'Pin!'; break;
    }
    case 'u10': {
      cells[r][c].count += 2; cells[r][c].owner = cur;
      const others = state.alive.filter(i => i !== cur);
      const boosted = [[r, c]];
      if (others.length) {
        // สุ่มเลือกศัตรู 1 คน แล้วบวก +1 สองช่องสุ่มของเขา
        const t = others[Math.floor(Math.random() * others.length)];
        const tCells = [];
        for (let ro = 0; ro < rows; ro++) for (let co = 0; co < cols; co++)
          if (cells[ro][co].owner === t) tCells.push([ro, co]);
        tCells.sort(() => Math.random() - 0.5);
        tCells.slice(0, 2).forEach(([ro, co]) => {
          cells[ro][co].count++;
          boosted.push([ro, co]);
        });
      }
      vfxData = { boosted }; resultText = 'Gift!'; break; }
    case 'r1': { const area=[]; for(let ro=Math.max(0,r-1);ro<=Math.min(rows-1,r+1);ro++) for(let co=Math.max(0,c-1);co<=Math.min(cols-1,c+1);co++) if(free(ro,co)){cells[ro][co].count++;cells[ro][co].owner=cur;area.push([ro,co]);} vfxData={area};resultText='Mega Burst!'; break; }
    case 'r2': { const absorbed=neighbors(r,c,rows,cols).filter(([nr,nc])=>cells[nr][nc].count>0).map(x=>[...x]); neighbors(r,c,rows,cols).forEach(([nr,nc])=>{cells[r][c].count+=cells[nr][nc].count;cells[r][c].owner=cur;cells[nr][nc].count=0;cells[nr][nc].owner=-1;}); vfxData={pulled:absorbed,to:[r,c]};resultText='Black Hole!'; break; }
    case 'r3': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];state.frozen[t]=Math.max(state.frozen[t],1);vfxData={frozenPlayer:t};resultText=`Freeze ${PLAYER_NAMES[t]}!`;} break; }
    case 'r4': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];const hit=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===t&&state.shielded[ro][co]<=0){cells[ro][co].count--;if(!cells[ro][co].count)cells[ro][co].owner=-1;hit.push([ro,co]);}vfxData={hit};resultText='Barrage!';} break; }
    case 'r5': { const moves=[]; const all=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) all.push([ro,co]); all.filter(()=>Math.random()<.2).forEach(([ro,co])=>{const nbs2=neighbors(ro,co,rows,cols).filter(([a,b])=>!isVoidCell(state,a,b));if(nbs2.length&&cells[ro][co].count>0){const[nr,nc]=nbs2[Math.floor(Math.random()*nbs2.length)];const ow=cells[ro][co].owner;cells[ro][co].count--;if(!cells[ro][co].count)cells[ro][co].owner=-1;cells[nr][nc].count++;cells[nr][nc].owner=ow;moves.push({from:[ro,co],to:[nr,nc]});}}); vfxData={moves};resultText='Tornado!'; break; }
    case 'r6': { const shAll=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){state.shielded[ro][co]=1;state.shieldOwner[ro][co]=cur;shAll.push([ro,co]);} vfxData={shielded:shAll};resultText='Reflect!'; break; }
    case 'r7': { if(!state.voidCells) state.voidCells={}; if(!state.voidSnapshot) state.voidSnapshot={}; state.voidCells[`${r},${c}`]=2; (state.voidOwner || (state.voidOwner = {}))[`${r},${c}`]=cur; state.voidSnapshot[`${r},${c}`]={count:cells[r][c].count,owner:cells[r][c].owner}; cells[r][c].count=0; cells[r][c].owner=-1; resultText='Void!'; break; }
    case 'r8': { vfxData = { diff: restoreSnapshot(state) || [] }; resultText = 'Rewind!'; break; }
    case 'e1': { // Meteor: ระเบิด 2 รอบ — เติมเต็ม → ระเบิดจนนิ่ง → เติมช่องเดิมเต็มอีกครั้ง → ระเบิดอีกรอบ (เหมือนโหมดออฟไลน์)
      cells[r][c].count = Math.max(cells[r][c].count, cells[r][c].cap); cells[r][c].owner = cur;
      runExplosions(state);
      cells[r][c].count = cells[r][c].cap; cells[r][c].owner = cur;
      runExplosions(state);
      resultText = 'Meteor!'; break;
    }
    case 'e2': { const row=[]; for(let co=0;co<cols;co++) if(free(r,co)){cells[r][co].count++;cells[r][co].owner=cur;row.push([r,co]);} vfxData={row};resultText='Tsunami!'; break; }
    case 'e3': if(cells[r][c].owner!==cur&&cells[r][c].owner!==-1&&cells[r][c].count>0){cells[r][c].owner=cur;if(cells[r][c].count<=0)cells[r][c].count=1;resultText='Steal!';}; break;
    case 'e4': { const col=[]; for(let ro=0;ro<rows;ro++) if(free(ro,c)){cells[ro][c].count++;cells[ro][c].owner=cur;col.push([ro,c]);} vfxData={col};resultText='Pillar!'; break; }
    case 'ep3': { let total=0,cnt=0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0){total+=cells[ro][co].count;cnt++;} const avg=cnt>0?Math.round(total/cnt):0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) cells[ro][co].count=avg; resultText='Balance!'; break; }
    case 'ep4': state._pendingDelayFor=cur; resultText='Delay!'; break;
    case 'ep5': { let best=null,bestRatio=-1; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){const ratio=cells[ro][co].count/cells[ro][co].cap;if(ratio>bestRatio){bestRatio=ratio;best=[ro,co];}} if(best){const[br,bc]=best;const boosted=neighbors(br,bc,rows,cols).filter(([nr,nc])=>free(nr,nc));boosted.forEach(([nr,nc])=>{cells[nr][nc].count+=2;cells[nr][nc].owner=cur;});vfxData={best,boosted};resultText='Nova!';}; break; }
    case 'ep6': { const infCells=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===cur){cells[ro][co].count++;infCells.push([ro,co]);} vfxData={cells:infCells};resultText='Inferno!'; break; }
    case 'sr1': { // Sever: 2 ช่องระเบิดออกไม่ได้ 4 ตาของผู้ใช้
      if (!state.severed) state.severed = {};
      if (!state.severedOwner) state.severedOwner = {};
      [[r, c], [r2, c2]].forEach(([a, b]) => { if (a === undefined || b === undefined) return; state.severed[`${a},${b}`] = 4; state.severedOwner[`${a},${b}`] = cur; });
      resultText = 'Sever!'; break;
    }
    case 'sr2': state.eclipse=(state.eclipse||0)+2; resultText='Eclipse!'; break;
    case 'sr3': { if (!Array.isArray(state.keyActive)) state.keyActive = Array(state.players).fill(0); state.keyActive[cur] = (state.keyActive[cur] || 0) + 1; resultText = 'Key!'; break; }
    case 'l1': { const others=state.alive.filter(i=>i!==cur); if(others.length){const t=others[Math.floor(Math.random()*others.length)];const wiped=[];for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===t){cells[ro][co].count=0;cells[ro][co].owner=-1;wiped.push([ro,co]);}vfxData={wiped};resultText=`Annihilate!`;} break; }
    case 'l2': { for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].count>0) cells[ro][co].count=cells[ro][co].cap; resultText='Nuclear!'; break; }
    case 'l3': { const empts=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner===-1&&!isVoidCell(state,ro,co)) empts.push([ro,co]); empts.forEach(([ro,co])=>{cells[ro][co].owner=cur;cells[ro][co].count=1;}); const mid=rows/2; let md=0; empts.forEach(([ro,co])=>{const d=Math.abs(ro-mid)+Math.abs(co-cols/2);if(d>md)md=d;}); vfxData={empties:empts,maxDist:md,owner:cur};resultText='Dominion!'; break; }
    case 'l4': { const ec2=[]; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++) if(cells[ro][co].owner!==cur&&cells[ro][co].owner!==-1) ec2.push([ro,co]); ec2.sort(()=>Math.random()-.5); const invaded=ec2.slice(0,3); invaded.forEach(([ro,co])=>cells[ro][co].owner=cur); vfxData={invaded};resultText='Invasion!'; break; }
    case 'l5': { if(!state.alive.includes(cur)){state.alive.push(cur);state.alive.sort((a,b)=>a-b);} cells[r][c].count=3;cells[r][c].owner=cur;state.moved[cur]=true;vfxData={target:[r,c]};resultText='Rebirth!'; break; }
    case 'm1': { let totalOrbs=0; for(let ro=0;ro<rows;ro++) for(let co=0;co<cols;co++){if(ro===r&&co===c)continue;if(cells[ro][co].count>0){const taken=Math.ceil(cells[ro][co].count/2);totalOrbs+=taken;cells[ro][co].count-=taken;if(!cells[ro][co].count)cells[ro][co].owner=-1;}} cells[r][c].count+=totalOrbs;cells[r][c].owner=cur;resultText='Singularity!'; break; }
    case 'm2': { // Big Bang: ทุกช่องของเราระเบิดพร้อมกัน → +2 คืนช่องที่ระเบิดไป (ถ้ายังเป็นของเราหรือว่าง) → ระเบิดต่อ (เหมือนโหมดออฟไลน์)
      const exploded = [];
      for (let ro = 0; ro < rows; ro++) for (let co = 0; co < cols; co++) if (cells[ro][co].owner === cur) { cells[ro][co].count = cells[ro][co].cap; exploded.push([ro, co]); }
      runExplosions(state);
      exploded.forEach(([ro, co]) => { if (free(ro, co)) { cells[ro][co].count += 2; cells[ro][co].owner = cur; } });
      runExplosions(state);
      vfxData = { exploded }; resultText = 'Big Bang!'; break;
    }
  }

  const out = { ok: true, resultText, vfxData, needsExplosion: true };
  if (priv) out.private = priv;
  return out;
}

return {
    CARD_DEFS, RARITY_WEIGHTS, PLAYER_COLORS, PLAYER_NAMES, HAND_LIMIT,
    createInitialState, applyPlace, applyCard,
    processExplosionsSync, processExplosionsWithWaves, checkEliminations, checkWin,
    nextTurn, tickTimeBombs, draw3UniqueCards, drawRandomCard, neighbors, rebirthUsable,
    validateTargets, takeSnapshot, restoreSnapshot, explodeWave, tickEffects, drawPickChoices,
    FX_MAX_WAVES, FX_TIMING, CARD_VFX_MS, cardVfxMs, waveStepMs, animMs,
  };
});
