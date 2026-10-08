// ══ โหมดไม่มีเซิร์ฟเวอร์: socket.io จำลองที่ส่งข้อมูลผ่าน Firebase Realtime Database ══
//
// online.js เรียก io() แล้วใช้ socket.on / socket.emit เหมือนเดิมทุกอย่าง — ไฟล์นี้ให้ `io()` อีกแบบหนึ่งที่
//   · คนสร้างห้อง = "โฮสต์": เบราว์เซอร์ของเขารันตรรกะเซิร์ฟเวอร์ตัวเดียวกับ server/game-server.js
//     (กติกา · จับเวลาตา · เลือกการ์ด · rejoin ด้วย token) ผ่าน io จำลอง
//   · คนเข้าห้อง = "แขก": ส่งคำสั่งไปที่ Firebase แล้วโฮสต์หยิบไปทำ · ผลลัพธ์ส่งกลับทาง Firebase
//
// โครงข้อมูลใน Firebase (ทุกอย่างอยู่ใต้ cr/) — สิทธิ์ของแต่ละเส้นทางอยู่ใน database.rules.json:
//   hosts/{code}                  { host: uid, t: เวลา server }  โฮสต์จองรหัสห้อง · ต่ออายุทุกนาที · เกิน 5 นาทีถือว่าว่าง
//   hostOf/{uid}                  code                           หนึ่ง uid ถือได้ห้องเดียว (เขียนพร้อม hosts/{code})
//   rooms/{code}/meta             { host: uid }                  เจ้าของข้อมูลห้อง (ให้ลบได้แม้รายการโฮสต์หายไปก่อน)
//   rooms/{code}/in/{key}         { from: sid, d: JSON }         แขก → โฮสต์ (โฮสต์ลบทิ้งหลังอ่าน)
//   rooms/{code}/out/{sid}/{key}  { d: JSON }                    โฮสต์ → แขกแต่ละคน (แขกลบทิ้งหลังอ่าน)
//   rooms/{code}/presence/{sid}   { t }                          แขกที่ยังเชื่อมต่ออยู่ · หายเมื่อแขกหลุด (onDisconnect)
// โฮสต์หลุด/แครช: onDisconnect ลบ rooms/{code}, hosts/{code}, hostOf/{uid}
// sid = `${uid}_${conn}` — uid จาก Anonymous Auth, conn สุ่มใหม่ทุกครั้งที่เปิดหน้า (เปิดสองแท็บในเบราว์เซอร์เดียวกันได้)
//
// ข้อมูลทุกก้อนเป็นสตริง JSON ในฟิลด์ d — ไม่ติดข้อจำกัดของ Firebase (key มีจุดไม่ได้, array, null, undefined)
(function (root) {
'use strict';

const BASE = 'cr';
const P = (...s) => BASE + '/' + s.join('/');
const noop = () => {};
const enc = v => JSON.stringify(v === undefined ? null : v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const later = fn => setTimeout(fn, 0); // ทำให้ไม่มี callback ไหนถูกเรียกซ้อนในจังหวะเดียวกับ emit (เหมือนผ่านเครือข่ายจริง)
const rid = (n) => {
  const a = new Uint8Array(n);
  (root.crypto || require('node:crypto').webcrypto).getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
};
const errText = (e) => {
  const c = e && (e.code || e.message || String(e));
  if (/operation-not-allowed|admin-restricted/i.test(c)) return 'ยังไม่ได้เปิด Sign-in แบบ Anonymous ใน Firebase → Authentication → Sign-in method';
  if (/permission[_ -]denied/i.test(c)) return 'Rules ของ Firebase ไม่อนุญาต — ตรวจว่า Publish Rules ล่าสุดแล้ว';
  if (/network|unavailable/i.test(c)) return 'เชื่อมต่อ Firebase ไม่ได้ (เครือข่าย)';
  return String(c).slice(0, 140);
};

// ══ io จำลองฝั่งโฮสต์: หน้าตาเท่าที่ server/game-server.js ใช้ ══
class FakeSocket {
  constructor(io, id, send) { this.io = io; this.id = id; this._send = send; this._h = Object.create(null); }
  on(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); return this; }
  emit(ev, ...args) { this._send(ev, args); return true; }
  join(r) { this.io._join(r, this.id); }
  leave(r) { this.io._leave(r, this.id); }
  _dispatch(ev, args) { (this._h[ev] || []).slice().forEach(fn => fn(...args)); }
}
class FakeIO {
  constructor() { this._onConn = []; this.sockets = { sockets: new Map() }; this._rooms = new Map(); }
  on(ev, fn) { if (ev === 'connection') this._onConn.push(fn); }
  to(room) {
    return { emit: (ev, ...args) => {
      const ids = new Set(this._rooms.get(room) || []);
      if (this.sockets.sockets.has(room)) ids.add(room); // socket.io: ทุก socket อยู่ในห้องที่ชื่อเท่า id ของตัวเอง
      ids.forEach(id => this.sockets.sockets.get(id)?.emit(ev, ...args));
    } };
  }
  _join(r, id) { if (!this._rooms.has(r)) this._rooms.set(r, new Set()); this._rooms.get(r).add(id); }
  _leave(r, id) { const s = this._rooms.get(r); if (s) { s.delete(id); if (!s.size) this._rooms.delete(r); } }
  _connect(id, send) {
    const s = new FakeSocket(this, id, send);
    this.sockets.sockets.set(id, s);
    this._onConn.forEach(fn => fn(s));
    return s;
  }
  _disconnect(id, reason) {
    const s = this.sockets.sockets.get(id);
    if (!s) return;
    s._dispatch('disconnect', [reason || 'transport close']);
    this.sockets.sockets.delete(id);
    [...this._rooms.keys()].forEach(r => this._leave(r, id));
  }
  close() {}
}

// ══ โฮสต์: รันเซิร์ฟเวอร์เกมในหน้านี้ แล้วรับ/ส่งข้อมูลกับแขกผ่าน Firebase ══
// ทุกอย่างที่มาจากคิว in มาจากคนแปลกหน้า: Rules รับประกันได้แค่ว่า `from` ขึ้นต้นด้วย uid ของคนเขียนจริง
// ที่เหลือ (ปริมาณ, ชนิดของคำสั่ง, จำนวนการเชื่อมต่อ) โฮสต์ต้องกันเองที่นี่ — Rules กันปริมาณไม่ได้
const REMOTE_EVENTS = new Set(['join_room', 'rejoin_room', 'update_cfg', 'start_game', 'restart_game', 'place', 'place_timeout',
  'use_card', 'discard_card', 'group_pick_response', 'group_pick_skip', 'leave_room']); // สร้างห้อง (create_room) ทำได้จากแท็บโฮสต์เองเท่านั้น
const ENTER_EVENTS = new Set(['join_room', 'rejoin_room']);
const SID_RE = /^[A-Za-z0-9]{1,128}_[0-9a-f]{8}$/;
const HOST_STALE_MS = 5 * 60 * 1000;   // รายการโฮสต์ที่ไม่ได้ต่ออายุเกินนี้ = ว่าง ใครจองทับก็ได้ (ตรงกับ database.rules.json)
const HOST_LIMITS = {
  heartbeatMs: 60000,      // ต่ออายุรหัสห้องทุกนาที
  burst: 40, perSec: 20,   // token bucket ต่อ uid: ผู้เล่นปกติส่งไม่กี่ข้อความต่อวินาที
  strikes: 20, blockMs: 60000, // เกินอัตราสะสมถึงเท่านี้ → บล็อก uid นั้นชั่วคราว
  connsPerUid: 3,          // แท็บ/การเชื่อมต่อพร้อมกันต่อ uid ต่อห้อง
  socketsPerRoom: 12,      // 6 ที่นั่ง + เผื่อคนรีเฟรช
  joinGraceMs: 10000,      // เชื่อมมาแล้วไม่เข้าห้องภายในเวลานี้ → ตัดทิ้ง
  batch: 50, batchMs: 100, // ประมวลผลคิวไม่เกิน 50 ข้อความต่อ 100ms (แท็บโฮสต์ยังต้องวาดเกมของตัวเอง)
  backlog: 300,            // ค้างเกินนี้ = โดนถล่ม: ทิ้งทั้งคิว
  maxUids: 200,            // จำนวน uid ที่จำสถิติไว้ต่อห้อง
};
const isDenied = e => /permission[_ -]?denied/i.test(String(e && (e.code || e.message || e)));

class HostRuntime {
  constructor(a, deps, attach) {
    this.a = a; this.deps = deps;
    this.L = Object.assign({}, HOST_LIMITS, deps.limits);
    this.io = new FakeIO();
    this.codes = new Map();      // code → สถานะของห้อง (ดู _listen)
    this.deliver = new Map();    // sid ของผู้เล่นในหน้านี้ → ฟังก์ชันส่งเข้า ClientSocket
    this.pendingCode = null;
    this.game = attach(this.io, {
      env: deps.env || {}, quiet: deps.quiet !== false,
      genCode: () => this.pendingCode,
      onRoomDeleted: code => this.release(code),
    });
    this._guard();
    this._beat = setInterval(() => this.heartbeat(), this.L.heartbeatMs);
    if (this._beat.unref) this._beat.unref();
    this._cleaned = this._cleanupOld().catch(noop);
  }
  static async get(a, deps) {
    if (!a._rt) a._rt = (async () => new HostRuntime(a, deps, await deps.loadAttach()))();
    return a._rt;
  }
  // ห้ามปิด/รีเฟรชหน้านี้ตอนที่ยังเป็นโฮสต์ — ห้องอยู่ในหน้านี้ทั้งห้อง
  _guard() {
    if (typeof root.addEventListener !== 'function') return;
    root.addEventListener('beforeunload', (e) => {
      if (!this.codes.size) return;
      e.preventDefault(); e.returnValue = '';
    });
  }
  _warn(st, msg) { const now = Date.now(); if (now - (st.warnedAt || 0) < 5000) return; st.warnedAt = now; console.warn('[fb] ' + msg); }

  // เปิดแท็บโฮสต์ใหม่ทั้งที่ uid นี้ยังมีห้องเก่าค้างอยู่ (แท็บเดิมแครช/ถูกปิด): เก็บกวาดห้องเก่าทิ้ง — หนึ่ง uid ถือได้ห้องเดียว
  async _cleanupOld() {
    const a = this.a, old = await a.get(P('hostOf', a.uid));
    if (typeof old !== 'string' || !/^\d{4}$/.test(old) || this.codes.has(old)) return;
    const h = await a.get(P('hosts', old));
    if (h && h.host === a.uid) { await a.remove(P('rooms', old)).catch(noop); await a.remove(P('hosts', old)).catch(noop); }
    await a.remove(P('hostOf', a.uid)).catch(noop);
  }

  // จองรหัสห้อง 4 หลัก: เขียน hosts/{code} กับ hostOf/{uid} พร้อมกัน (multi-path) — Rules ให้ผ่านเฉพาะรหัสที่ว่าง / หมดอายุ / ของเราเอง
  // เวลา t เป็นเวลาของ server เสมอ (serverTimestamp) — client กำหนดเองไม่ได้ จึงจองค้างด้วยเวลาอนาคตไม่ได้
  async claim() {
    await this._cleaned;
    const a = this.a, uid = a.uid;
    await this._cleanupOld().catch(noop); // ห้องของ uid นี้ที่ค้างจากแท็บอื่น: Rules ไม่ให้ถือสองรหัส ต้องปล่อยของเก่าก่อน
    // หนึ่ง uid = หนึ่งห้อง: ห้องเดิมของหน้านี้ (ถ้ามีคนค้างอยู่) ต้องปิดก่อน ไม่งั้นจะต่ออายุไม่ได้แล้วค้างเป็นห้องผี
    for (const code of [...this.codes.keys()]) this.game.closeRoom(code, 'host_left');
    await this._releasing; // รอให้ห้องเก่าถูกเก็บกวาดเสร็จก่อนจองห้องใหม่
    for (let i = 0; i < 40; i++) {
      const code = String(this.deps.pickCode ? this.deps.pickCode(i) : Math.floor(1000 + Math.random() * 9000));
      if (!/^\d{4}$/.test(code) || this.codes.has(code) || this.game.rooms.has(code)) continue;
      const cur = await a.get(P('hosts', code));
      if (cur && cur.host !== uid && typeof cur.t === 'number' && a.now() - cur.t < HOST_STALE_MS) continue; // โฮสต์อื่นยังต่ออายุอยู่
      try { await a.update({ [P('hosts', code)]: { host: uid, t: a.serverTimestamp() }, [P('hostOf', uid)]: code }); }
      catch (e) { if (isDenied(e)) continue; throw e; } // Rules ปฏิเสธ = มีคนชิงรหัสนี้ไปก่อน
      // ข้อมูลค้างจากโฮสต์เก่าของรหัสนี้ (คำสั่ง / out / presence) ต้องไม่ถูกประมวลผล: ล้างก่อนเริ่มฟัง
      await a.remove(P('rooms', code)).catch(noop);
      await a.set(P('rooms', code, 'meta'), { host: uid }).catch(noop);
      this._listen(code);
      return code;
    }
    throw new Error('จองรหัสห้องไม่ได้');
  }
  _armDisconnect(code, st) {
    st.cancel.forEach(c => { try { c(); } catch (e) {} });
    // โฮสต์หลุด/แครช: ลบข้อมูลห้อง "ก่อน" รายการโฮสต์ (สิทธิ์ลบห้องของ Rules ดูจากรายการโฮสต์ · มี meta/host เป็นทางสำรองถ้าลำดับสลับ)
    st.cancel = [this.a.onDisconnectRemove(P('rooms', code)), this.a.onDisconnectRemove(P('hosts', code)), this.a.onDisconnectRemove(P('hostOf', this.a.uid))];
  }
  _listen(code) {
    const a = this.a;
    const st = { unsubs: [], cancel: [], queue: [], pumping: false, timer: 0, graces: new Set(), uids: new Map(), sockets: new Set(), drops: 0, sweep: 0, warnedAt: 0 };
    this.codes.set(code, st);
    this._armDisconnect(code, st);
    st.unsubs.push(a.onChildAdded(P('rooms', code, 'in'), (key, v) => this._enqueue(code, key, v)));
    st.unsubs.push(a.onChildRemoved(P('rooms', code, 'presence'), sid => this._drop(code, sid)));
  }
  // ต่ออายุรหัสห้อง: ถ้า Rules ปฏิเสธ แปลว่ารหัสนี้ไม่ใช่ของเราแล้ว (เช่น เปิดห้องใหม่จากอีกแท็บ) → ปิดห้องในหน้านี้
  async heartbeat() {
    for (const code of [...this.codes.keys()]) {
      try { await this.a.update({ [P('hosts', code)]: { host: this.a.uid, t: this.a.serverTimestamp() }, [P('hostOf', this.a.uid)]: code }); }
      catch (e) { if (isDenied(e)) { console.warn('[fb] ห้อง ' + code + ': รหัสห้องไม่ใช่ของหน้านี้แล้ว — ปิดห้อง'); this.game.closeRoom(code, 'host_left'); } }
    }
  }
  // ต่อเน็ตกลับมา: onDisconnect ลบทุกอย่างของห้องไปแล้วตอนหลุด → ประกาศตัวใหม่ (แขกจะ rejoin ด้วย token เอง)
  async republish() {
    for (const [code, st] of this.codes) {
      this._armDisconnect(code, st);
      await this.a.set(P('rooms', code, 'meta'), { host: this.a.uid }).catch(noop);
    }
    await this.heartbeat();
  }
  release(code) {
    const st = this.codes.get(code);
    if (!st) return;
    this.codes.delete(code);
    st.unsubs.forEach(u => { try { u(); } catch (e) {} });
    st.cancel.forEach(c => { try { c(); } catch (e) {} });
    clearTimeout(st.timer); clearTimeout(st.sweep); st.graces.forEach(clearTimeout); st.queue.length = 0;
    st.sockets.forEach(sid => this.io._disconnect(sid, 'room closed'));
    // ลบ rooms ก่อน hosts — Rules ตรวจสิทธิ์ลบจากรายการ hosts · ดัชนี hostOf ลบเฉพาะเมื่อยังชี้มาที่ห้องนี้ (อาจชี้ไปห้องใหม่แล้ว)
    const a = this.a;
    this._releasing = (this._releasing || Promise.resolve())
      .then(() => a.remove(P('rooms', code)).catch(noop))
      .then(() => a.remove(P('hosts', code)).catch(noop))
      .then(() => a.get(P('hostOf', a.uid)).catch(noop))
      .then(idx => { if (idx === code) return a.remove(P('hostOf', a.uid)).catch(noop); });
  }

  local(sid, deliver) {
    this.deliver.set(sid, deliver);
    return this.io.sockets.sockets.get(sid) || this.io._connect(sid, (ev, args) => {
      const s = enc(args);
      later(() => this.deliver.get(sid)?.(ev, JSON.parse(s)));
    });
  }
  _out(code, sid, ev, args) {
    if (!code || !this.codes.has(code)) return;
    this.a.push(P('rooms', code, 'out', sid), { d: enc([ev, args]) }).catch(e => this.deps.onError?.(e));
  }

  // ── คิวขาเข้า ──
  // อัตราต่อ uid ตัดสินตั้งแต่ตอนข้อความ "มาถึง" (ยังไม่ parse): ข้อความของ uid ที่ส่งถี่เกิน/ถูกบล็อกไม่ได้เข้าคิวเลย
  // ผู้เล่นปกติจึงไม่ถูกเบียด แม้มีคนยิงเป็นพันข้อความ
  _uid(st, uid, now) {
    let u = st.uids.get(uid);
    if (!u) {
      if (st.uids.size >= this.L.maxUids) { // จำกัดความจำ: ทิ้งสถิติของ uid ที่ไม่มีการเชื่อมต่อและไม่ได้ถูกบล็อก
        for (const [k, x] of st.uids) { if (!x.conns.size && x.blockedUntil < now) { st.uids.delete(k); if (st.uids.size < this.L.maxUids) break; } }
        if (st.uids.size >= this.L.maxUids) return null;
      }
      u = { tokens: this.L.burst, at: now, over: 0, blockedUntil: 0, conns: new Set() };
      st.uids.set(uid, u);
    }
    return u;
  }
  _admit(st, uid, now, cost) {
    const u = this._uid(st, uid, now);
    if (!u || now < u.blockedUntil) return null;
    u.tokens = Math.min(this.L.burst, u.tokens + (now - u.at) / 1000 * this.L.perSec); u.at = now;
    if (u.tokens < 1) { this._strike(st, uid, u, now, cost || 1); return null; }
    u.tokens--;
    return u;
  }
  _strike(st, uid, u, now, n) {
    u.over += n;
    if (u.over < this.L.strikes) return;
    u.over = 0; u.blockedUntil = now + this.L.blockMs;
    this._warn(st, 'บล็อก uid ' + uid.slice(0, 6) + '… ชั่วคราว (ส่งคำสั่งถี่/ผิดรูปแบบเกินไป)');
    [...u.conns].forEach(sid => this._dropSid(st, sid));
  }
  _enqueue(code, key, v) {
    const st = this.codes.get(code);
    if (!st) return;
    const from = v && v.from, now = Date.now();
    const ok = typeof from === 'string' && SID_RE.test(from) && typeof v.d === 'string' && v.d.length < 4000 && !this.deliver.has(from)
      && this._admit(st, from.slice(0, from.indexOf('_')), now);
    if (!ok) { // ทิ้งโดยไม่ประมวลผล แล้วล้างทั้งกล่องจดหมายทีเดียวในอีกครู่ (ข้อความที่มาถึงแล้วอยู่ในความจำของเราทั้งหมด จึงไม่มีอะไรหาย)
      st.drops++;
      if (!st.sweep) st.sweep = setTimeout(() => { st.sweep = 0; if (this.codes.get(code) === st) this.a.remove(P('rooms', code, 'in')).catch(noop); }, 500);
      return;
    }
    st.queue.push([key, v]);
    if (st.queue.length > this.L.backlog) {
      st.queue.length = 0; this.a.remove(P('rooms', code, 'in')).catch(noop);
      this._warn(st, 'ห้อง ' + code + ': คำสั่งค้างเกิน ' + this.L.backlog + ' — ทิ้งทั้งคิว');
      return;
    }
    if (!st.pumping) this._pump(code);
  }
  _pump(code) {
    const st = this.codes.get(code);
    if (!st) return;
    st.pumping = true;
    for (let n = 0; st.queue.length && n < this.L.batch; n++) {
      const [key, v] = st.queue.shift();
      this.a.remove(P('rooms', code, 'in', key)).catch(noop);
      try { this._handle(code, st, v); } catch (e) { console.error('[fb] handle', e); }
    }
    if (st.queue.length) st.timer = setTimeout(() => this._pump(code), this.L.batchMs);
    else st.pumping = false;
  }
  _handle(code, st, v) {
    const from = v.from, uid = from.slice(0, from.indexOf('_')), now = Date.now();
    const u = st.uids.get(uid);
    if (!u || now < u.blockedUntil) return;
    let m; try { m = JSON.parse(v.d); } catch (e) { this._strike(st, uid, u, now, 5); return; }
    if (!m || typeof m.ev !== 'string' || !REMOTE_EVENTS.has(m.ev)) { this._strike(st, uid, u, now, 5); return; }
    let sock = this.io.sockets.sockets.get(from);
    if (!sock) {
      // sid ที่ไม่รู้จัก: ข้อความแรกต้องเป็นการเข้าห้องเท่านั้น และมีเพดานจำนวนการเชื่อมต่อ
      if (!ENTER_EVENTS.has(m.ev)) { this.a.remove(P('rooms', code, 'out', from)).catch(noop); this._strike(st, uid, u, now, 1); return; }
      if (u.conns.size >= this.L.connsPerUid || st.sockets.size >= this.L.socketsPerRoom) { this._strike(st, uid, u, now, 1); return; }
      sock = this.io._connect(from, (ev, args) => this._out(sock._code, from, ev, args));
      st.sockets.add(from); u.conns.add(from);
      const g = setTimeout(() => { st.graces.delete(g); if (!this.game.socketRoom.has(from)) this._dropSid(st, from, code); }, this.L.joinGraceMs);
      st.graces.add(g);
    }
    sock._code = code;
    const cb = m.k ? res => this._out(code, from, '__ack', [m.k, res === undefined ? null : res]) : null;
    const args = m.a === undefined || m.a === null ? [] : [m.a];
    sock._dispatch(m.ev, cb ? [...args, cb] : args);
  }
  // presence ของแขกหายไป (ปิดแท็บ/หลุด) หรือเราตัดเอง
  _drop(code, sid) { const st = this.codes.get(code); if (st) this._dropSid(st, sid, code); }
  _dropSid(st, sid, code) {
    if (this.deliver.has(sid)) return; // ผู้เล่นในหน้านี้ไม่ได้มาทาง Firebase
    if (code) this.a.remove(P('rooms', code, 'out', sid)).catch(noop);
    st.sockets.delete(sid);
    const u = st.uids.get(sid.slice(0, sid.indexOf('_')));
    if (u) u.conns.delete(sid);
    if (this.io.sockets.sockets.has(sid)) this.io._disconnect(sid, 'transport close');
  }
}

// ══ socket ฝั่งผู้เล่น: หน้าตาเหมือน socket.io-client ══
class ClientSocket {
  constructor(adapterP, deps) {
    this.deps = deps; this.conn = rid(4);
    this.connected = false; this.id = null; this.uid = null; this.a = null;
    this._h = Object.create(null);
    this.route = null;            // { t: 'local'|'remote', code }
    this._bind = null;            // การผูกกับห้องของโฮสต์คนอื่น
    this._pending = new Map();    // k → { cb, timer }
    this._up = false; this._everUp = false;
    this._adapterP = Promise.resolve(adapterP);
    this._ready = null;
    this.io = { on: noop };       // ให้ socket.io?.on(...) ไม่พัง
  }
  on(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); return this; }
  once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); }
  off(ev, fn) { if (this._h[ev]) this._h[ev] = fn ? this._h[ev].filter(f => f !== fn) : []; return this; }
  _fire(ev, ...args) { (this._h[ev] || []).slice().forEach(fn => { try { fn(...args); } catch (e) { console.error('[fb] handler', ev, e); } }); }
  _err(e, where) {
    console.error('[fb]', where || '', e);
    this._fire('connect_error', e);
    this.deps.onError?.(e);
  }

  connect() {
    if (this._ready) return this;
    this._ready = this._adapterP.then(async a => {
      this.a = a;
      this.uid = await a.ready();
      this.id = `${this.uid}_${this.conn}`;
      this._unConn = a.onConnection(up => this._onConn(up));
    }).catch(e => { this._ready = null; this._err(e, 'connect'); });
    return this;
  }
  disconnect() {
    this._unbind(false);
    try { this._unConn?.(); } catch (e) {}
    this._unConn = null; this._ready = null;
    if (this.a?._rt && this.id) this.a._rt.then(rt => rt.io._disconnect(this.id, 'client')).catch(noop);
    if (this.connected) { this.connected = false; this._fire('disconnect', 'io client disconnect'); }
  }
  _onConn(up) {
    if (up === this._up) return;
    this._up = up;
    if (!up) { this.connected = false; this._fire('disconnect', 'transport close'); return; }
    const first = !this._everUp; this._everUp = true;
    Promise.resolve().then(async () => {
      if (!first) {
        if (this.route?.t === 'local') await (await this.a._rt)?.republish();
        else if (this._bind) await this._announce(this._bind).catch(noop); // presence ถูก onDisconnect ลบไปตอนหลุด
      }
      this.connected = true; this._fire('connect');
    });
  }

  emit(ev, ...args) {
    let cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const data = args[0];
    const run = () => {
      if (!this.a || !this.uid) return cb?.({ ok: false, msg: 'ยังเชื่อมต่อ Firebase ไม่ได้' });
      if (ev === 'create_room') return this._create(data, cb);
      if (ev === 'join_room' || ev === 'rejoin_room') return this._enter(ev, data, cb);
      return this._send(ev, data, cb);
    };
    if (this._ready && !this.uid) this._ready.then(run); else run();
    return this;
  }

  async _runtime() { return HostRuntime.get(this.a, this.deps); }
  _loop(rt) { return rt.local(this.id, (ev, args) => this._recv(ev, args)); }
  _recv(ev, args) {
    if (ev === '__ack') {
      const p = this._pending.get(args[0]);
      if (p) { clearTimeout(p.timer); this._pending.delete(args[0]); p.cb?.(args[1]); }
      return;
    }
    this._fire(ev, ...args);
  }
  _wrapLocal(cb) { return cb ? (res) => { const s = enc(res); later(() => cb(JSON.parse(s))); } : undefined; }

  async _create(data, cb) {
    try {
      if (this.route?.t === 'remote') { this._send('leave_room'); }
      const rt = await this._runtime();
      const code = await rt.claim();
      rt.pendingCode = code;
      const fs = this._loop(rt);
      this.route = { t: 'local', code };
      fs._dispatch('create_room', [clone(data) || {}, this._wrapLocal(res => {
        if (!res || !res.ok) { rt.release(code); if (this.route?.code === code) this.route = null; }
        cb?.(res);
      })]);
      rt.pendingCode = null;
    } catch (e) { this._err(e, 'create'); cb?.({ ok: false, msg: errText(e) }); }
  }

  async _enter(ev, data, cb) {
    const code = String((data && data.code) ?? '');
    try {
      const rt = this.a._rt ? await this.a._rt : null;
      if (rt && rt.codes.has(code)) {
        this._unbind(ev === 'join_room');
        this.route = { t: 'local', code };
        const fs = this._loop(rt);
        fs._dispatch(ev, [clone(data) || {}, this._wrapLocal(res => {
          if (!res || !res.ok) { if (this.route?.code === code) this.route = null; }
          cb?.(res);
        })]);
        return;
      }
      if (!/^\d{4}$/.test(code)) return cb?.({ ok: false, gone: true, msg: 'ไม่พบห้องรหัสนี้' });
      if (!this._bind || this._bind.code !== code) {
        if (this._bind) this._send('leave_room');
        const host = await this.a.get(P('hosts', code));
        // ไม่มีรายการ หรือโฮสต์ไม่ได้ต่ออายุนานแล้ว (แท็บโฮสต์ตายไปโดยไม่ทันลบ) = ไม่มีห้อง
        if (!host || (typeof host.t === 'number' && this.a.now() - host.t > HOST_STALE_MS + 60000)) return cb?.({ ok: false, gone: true, msg: 'ไม่พบห้องรหัสนี้' });
        await this._attach(code, host.host);
      }
      this.route = { t: 'remote', code };
      this._post(ev, data, res => {
        if (!res || !res.ok) { this._unbind(false); this.route = null; }
        cb?.(res);
      });
    } catch (e) { this._err(e, 'enter'); cb?.({ ok: false, msg: errText(e) }); }
  }

  _send(ev, data, cb) {
    if (!this.route) { if (ev !== 'leave_room') cb?.({ ok: false, msg: 'ยังไม่ได้อยู่ในห้อง' }); return; }
    if (this.route.t === 'local') {
      this.a._rt.then(rt => {
        const fs = this._loop(rt);
        fs._dispatch(ev, data === undefined ? (cb ? [this._wrapLocal(cb)] : []) : (cb ? [clone(data), this._wrapLocal(cb)] : [clone(data)]));
      });
      if (ev === 'leave_room') this.route = null;
      return;
    }
    this._post(ev, data, cb);
    if (ev === 'leave_room') { const b = this._bind; this.route = null; setTimeout(() => { if (this._bind === b) this._unbind(true); }, 400); }
  }

  // ── ฝั่งแขก ──
  _post(ev, data, cb) {
    const b = this._bind;
    if (!b) return cb?.({ ok: false, msg: 'ยังไม่ได้อยู่ในห้อง' });
    let k = null;
    if (cb) {
      k = rid(5);
      const timer = setTimeout(() => {
        if (!this._pending.delete(k)) return;
        cb({ ok: false, gone: ev === 'rejoin_room', msg: 'โฮสต์ไม่ตอบสนอง' });
      }, this.deps.ackMs ?? 12000);
      this._pending.set(k, { cb, timer });
    }
    this.a.push(P('rooms', b.code, 'in'), { from: this.id, d: enc({ ev, a: data === undefined ? null : data, k }) })
      .catch(e => { this._err(e, 'send ' + ev); if (k && this._pending.has(k)) { const p = this._pending.get(k); clearTimeout(p.timer); this._pending.delete(k); p.cb({ ok: false, msg: errText(e) }); } });
  }
  _announce(b) {
    b.cancelOD();
    b.cancelOD = this.a.onDisconnectRemove(P('rooms', b.code, 'presence', this.id));
    return this.a.set(P('rooms', b.code, 'presence', this.id), { t: Date.now() });
  }
  async _attach(code, hostUid) {
    this._unbind(false);
    const a = this.a, b = this._bind = { code, hostUid, unsubs: [], cancelOD: noop, goneTimer: null };
    b.unsubs.push(a.onChildAdded(P('rooms', code, 'out', this.id), (key, v) => {
      a.remove(P('rooms', code, 'out', this.id, key)).catch(noop);
      let m; try { m = JSON.parse(v.d); } catch (e) { return; }
      if (Array.isArray(m)) this._recv(m[0], m[1] || []);
    }));
    await this._announce(b);
    // โฮสต์ยังอยู่ไหม: หายไปครู่หนึ่ง = หลุด (รอกลับมา) · หายนาน = ห้องปิด
    const closed = () => {
      if (this._bind !== b) return;
      this._unbind(true); this.route = null;
      this.connected = true; // ตัวเราเองยังต่อ Firebase อยู่ — โฮสต์ต่างหากที่ไป
      this._fire('room_closed', { reason: 'host_left' });
    };
    b.unsubs.push(a.onValue(P('hosts', code), v => {
      // รหัสเดิมแต่คนละโฮสต์ = ห้องของเราไม่อยู่แล้ว (โฮสต์เดิมหายไป แล้วมีคนอื่นได้รหัสนี้ไป) — ไม่ใช่ "โฮสต์กลับมา"
      if (v && hostUid && v.host !== hostUid) { later(closed); return; }
      if (v) {
        if (b.goneTimer) { // โฮสต์กลับมา: ประกาศตัว (presence) ให้เสร็จก่อน แล้วค่อยให้ client rejoin — Rules รับคำสั่งเฉพาะจาก sid ที่มี presence
          clearTimeout(b.goneTimer); b.goneTimer = null;
          this._announce(b).catch(noop).then(() => { if (this._bind !== b) return; this.connected = true; this._fire('connect'); });
        }
        return;
      }
      if (b.goneTimer) return;
      if (this.connected) { this.connected = false; this._fire('disconnect', 'transport close'); }
      b.goneTimer = setTimeout(closed, this.deps.hostGoneMs ?? 20000);
    }));
  }
  _unbind(cleanup) {
    const b = this._bind;
    if (!b) return;
    this._bind = null;
    clearTimeout(b.goneTimer);
    b.unsubs.forEach(u => { try { u(); } catch (e) {} });
    b.cancelOD();
    if (cleanup && this.a) {
      this.a.remove(P('rooms', b.code, 'presence', this.id)).catch(noop);
      this.a.remove(P('rooms', b.code, 'out', this.id)).catch(noop);
    }
    for (const [k, p] of this._pending) { clearTimeout(p.timer); this._pending.delete(k); }
  }
}

// ══ adapter ของ Firebase จริง (Realtime Database + Anonymous Auth, โหลด SDK จาก CDN เมื่อใช้งานจริง) ══
async function makeFirebaseAdapter(config, version) {
  const u = `https://www.gstatic.com/firebasejs/${version || '10.12.0'}/`;
  const [A, D, Au] = await Promise.all([import(u + 'firebase-app.js'), import(u + 'firebase-database.js'), import(u + 'firebase-auth.js')]);
  const app = A.initializeApp(config);
  // App Check (ไม่บังคับ): ใส่คีย์ reCAPTCHA v3 ใน fb-config.js (CR_APPCHECK_SITE_KEY) แล้วเปิด Enforce ใน Firebase console
  // — กันสคริปต์ที่ไม่ได้มาจากหน้าเว็บนี้ไม่ให้ใช้ฐานข้อมูล · ไม่ตั้งค่า = ไม่โหลด
  if (root.CR_APPCHECK_SITE_KEY) {
    const AC = await import(u + 'firebase-app-check.js');
    AC.initializeAppCheck(app, { provider: new AC.ReCaptchaV3Provider(root.CR_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  const db = D.getDatabase(app), auth = Au.getAuth(app);
  const R = p => (p ? D.ref(db, p) : D.ref(db));
  let offset = 0;
  D.onValue(R('.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const a = {
    uid: null,
    async ready() { a.uid = (await Au.signInAnonymously(auth)).user.uid; return a.uid; },
    onConnection: cb => D.onValue(R('.info/connected'), s => cb(!!s.val())),
    now: () => Date.now() + offset,                 // เวลาของ server โดยประมาณ
    serverTimestamp: () => D.serverTimestamp(),     // ค่าที่ server แทนด้วยเวลาของมันเองตอนเขียน
    get: async p => (await D.get(R(p))).val(),
    set: (p, v) => D.set(R(p), v),
    update: obj => D.update(R(''), obj),            // หลายเส้นทางพร้อมกัน (สำเร็จหรือล้มเหลวทั้งชุด)
    remove: p => D.remove(R(p)),
    push: async (p, v) => { const r = D.push(R(p)); await D.set(r, v); return r.key; },
    onChildAdded: (p, cb) => D.onChildAdded(R(p), s => cb(s.key, s.val())),
    onChildRemoved: (p, cb) => D.onChildRemoved(R(p), s => cb(s.key)),
    onValue: (p, cb) => D.onValue(R(p), s => cb(s.val())),
    onDisconnectRemove: p => { const od = D.onDisconnect(R(p)); od.remove(); return () => { od.cancel(); }; },
  };
  return a;
}

// ══ โหลดตรรกะเซิร์ฟเวอร์ไปรันในเบราว์เซอร์ (ไฟล์เดียวกับที่ Node ใช้ — ไม่มีสำเนาให้ลืมแก้) ══
async function loadAttachInBrowser() {
  const text = async rel => {
    const r = await fetch(new URL(rel, root.document.baseURI));
    if (!r.ok) throw new Error('โหลด ' + rel + ' ไม่ได้ (' + r.status + ')');
    return r.text();
  };
  const [logicSrc, srvSrc] = await Promise.all([text('shared/gameLogic.js'), text('lib/game-server.js')]);
  const run = (src, req) => { const m = { exports: {} }; new Function('require', 'module', 'exports', src)(req, m, m.exports); return m.exports; };
  const logic = run(logicSrc, () => { throw new Error('no require'); });
  const cryptoShim = { randomBytes: n => { const a = new Uint8Array(n); root.crypto.getRandomValues(a); return { toString: () => Array.from(a, b => b.toString(16).padStart(2, '0')).join('') }; } };
  const srv = run(srvSrc, id => id === 'crypto' ? cryptoShim : /gameLogic/.test(id) ? logic : (() => { throw new Error('require ' + id); })());
  return srv.attach;
}

// io(opts) แบบเดียวกับ socket.io-client
function makeIo(adapterP, deps) {
  return function io(opts) {
    const s = new ClientSocket(adapterP, deps);
    if (!opts || opts.autoConnect !== false) s.connect();
    return s;
  };
}

const api = { makeIo, makeFirebaseAdapter, loadAttachInBrowser, FakeIO, HostRuntime, ClientSocket };
if (typeof module !== 'undefined' && module.exports) module.exports = api;

// ── ในเบราว์เซอร์: root.CRFirebaseIO(opts) ──
// ตั้งค่าใน fb-config.js (CR_FIREBASE_CONFIG) · root.CR_DB_ADAPTER_FACTORY / CR_LOAD_ATTACH เป็นช่องให้ชุดทดสอบสลับของจริงเป็นของปลอม
if (root.document) {
  let adapterP = null;
  root.CRFirebaseAvailable = () => !!(root.CR_DB_ADAPTER_FACTORY || (root.CR_FIREBASE_CONFIG && root.CR_FIREBASE_CONFIG.databaseURL));
  root.CRFirebaseIO = function (opts) {
    if (!adapterP) adapterP = root.CR_DB_ADAPTER_FACTORY ? Promise.resolve(root.CR_DB_ADAPTER_FACTORY()) : makeFirebaseAdapter(root.CR_FIREBASE_CONFIG);
    const deps = {
      loadAttach: root.CR_LOAD_ATTACH || loadAttachInBrowser,
      onError: e => { if (typeof root.showToast === 'function') root.showToast('⚠️ Firebase: ' + errText(e)); },
    };
    return makeIo(adapterP, deps)(opts);
  };
}
})(typeof window !== 'undefined' ? window : globalThis);
