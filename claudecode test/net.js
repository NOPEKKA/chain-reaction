// ============================================================
// net.js — ออนไลน์ผ่าน Firebase Realtime Database
// ------------------------------------------------------------
// รูปแบบ: host เป็นเจ้าภาพ จำลองลูกบอล + บอท + คะแนน + เวลา
// ผู้เล่นจริงแต่ละคนส่งตำแหน่งปลาตัวเองขึ้น players/{slot}
// host ส่งสภาพโลก (world) ให้ทุกคนอ่าน
//
// โครงข้อมูลใน DB:
//   rooms/{code}/meta            { mode, sec, diff, slotState[], hostSlot, started }
//   rooms/{code}/players/{slot}  { name, team, skin, host, pos[3], heading, flop }
//   rooms/{code}/world           { ball[3], bots:{slot:{pos[3],heading,flop}},
//                                  scoreL, scoreR, timeLeft, playing }
// ============================================================
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, onDisconnect } from 'firebase/database';
import { firebaseConfig } from './firebase-config.js';

export const net = {
  online: false,   // Firebase ต่อได้แล้ว
  active: false,   // อยู่ในห้องออนไลน์อยู่
  isHost: false,
  code: null,
  slot: 0,
  players: {},     // slot -> presence/fish ล่าสุด
  meta: null,      // ตั้งค่าห้องจาก host
  world: null,     // สภาพโลกล่าสุดจาก host
};

let db = null;
let unsub = [];
let onPlayersCb = null;

// ยังไม่ได้ตั้งค่า Firebase → เล่นออฟไลน์
export function netAvailable() {
  const url = firebaseConfig && firebaseConfig.databaseURL;
  return !!(url && !url.includes('YOUR_'));
}

export function initNet() {
  if (db) return net.online;
  if (!netAvailable()) return false;
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    net.online = true;
  } catch (e) {
    console.warn('Firebase init ล้มเหลว — เล่นออฟไลน์แทน', e);
    net.online = false;
  }
  return net.online;
}

function watch(path, cb) {
  const r = ref(db, path);
  const u = onValue(r, (snap) => cb(snap.val()));
  unsub.push(u);
}

// ต่อเข้าห้องเพื่อ "ดู" ข้อมูล (เริ่มฟัง players/meta/world)
//  - host: เขียน meta + จองช่องตัวเองทันที
//  - joiner: แค่ฟังก่อน (ยังไม่จองช่อง กันไปทับ host) แล้วค่อย claimSlot ทีหลัง
export async function connectRoom(o) {
  if (!initNet()) return false;
  net.code = o.code; net.isHost = o.isHost;
  net.players = {}; net.world = null; net.meta = null;
  net.active = false; net.slot = o.slot != null ? o.slot : 0;
  const base = `rooms/${o.code}`;

  watch(`${base}/players`, (v) => { net.players = v || {}; if (onPlayersCb) onPlayersCb(net.players); });
  watch(`${base}/meta`, (v) => { net.meta = v; });
  watch(`${base}/world`, (v) => { net.world = v; });

  if (o.isHost) {
    await set(ref(db, `${base}/meta`), o.meta);
    onDisconnect(ref(db, base)).remove();   // host หลุด → ปิดห้องทั้งหมด
    await claimSlot(o.slot, o.presence);
  }
  return true;
}

// จองช่องนั่งของตัวเอง (ย้ายช่องได้ — ลบช่องเดิมก่อน)
export async function claimSlot(slot, presence) {
  if (!db || !net.code) return;
  const base = `rooms/${net.code}`;
  if (net.active && net.slot != null && net.slot !== slot) {
    await set(ref(db, `${base}/players/${net.slot}`), null).catch(() => {});
  }
  net.slot = slot; net.active = true;
  const meRef = ref(db, `${base}/players/${slot}`);
  await set(meRef, presence);
  onDisconnect(meRef).remove();   // ออกจากเกม/ปิดแท็บ → ลบตัวเองอัตโนมัติ
}

// host อัปเดตตั้งค่าห้อง (เช่นตอนสลับ บอท/ปิดช่อง ในล็อบบี้)
export function updateMeta(partial) {
  if (!db || !net.active || !net.isHost) return;
  update(ref(db, `rooms/${net.code}/meta`), partial);
}

// ให้ main.js รู้เมื่อรายชื่อผู้เล่นในห้องเปลี่ยน (อัปเดตล็อบบี้)
export function onPlayers(cb) { onPlayersCb = cb; }

let lastMe = 0;
// ผู้เล่นจริงส่งตำแหน่งปลาตัวเอง (จำกัดความถี่ ~15 ครั้ง/วินาที)
export function sendMe(p, now) {
  if (!net.active || !db) return;
  if (now - lastMe < 60) return; lastMe = now;
  set(ref(db, `rooms/${net.code}/players/${net.slot}`), {
    name: p.name, team: p.team, skin: p.skin, host: net.isHost,
    pos: [round(p.pos.x), round(p.pos.y), round(p.pos.z)],
    heading: +p.heading.toFixed(3), flop: p.flopSeq || 0,
  });
}

let lastWorld = 0;
// host ส่งสภาพโลก
export function sendWorld(w, now) {
  if (!net.active || !net.isHost || !db) return;
  if (now - lastWorld < 60) return; lastWorld = now;
  set(ref(db, `rooms/${net.code}/world`), w);
}
// ส่งทันทีไม่สนใจการจำกัดความถี่ (ใช้ตอนจบเกมให้ทุกคนเห็นผลพร้อมกัน)
export function sendWorldForce(w) {
  if (!net.active || !net.isHost || !db) return;
  set(ref(db, `rooms/${net.code}/world`), w);
}

export function leaveRoom() {
  if (!db || !net.active) return;
  unsub.forEach((u) => u && u()); unsub = [];
  set(ref(db, `rooms/${net.code}/players/${net.slot}`), null).catch(() => {});
  if (net.isHost) set(ref(db, `rooms/${net.code}`), null).catch(() => {});
  net.active = false; net.code = null; net.players = {}; net.world = null; net.meta = null;
}

function round(n) { return Math.round(n * 100) / 100; }
