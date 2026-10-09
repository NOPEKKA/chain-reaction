// Realtime Database จำลองในหน่วยความจำ — ไว้ทดสอบ client/fb-transport.js โดยไม่ต้องต่อ Firebase จริง
//  · ใน Node: หลาย adapter ใช้ MemDB ตัวเดียวกัน (แทนแขกหลายคนที่ใช้ฐานข้อมูลเดียวกัน)
//  · ในเบราว์เซอร์: MemDB({ channel }) ซิงก์ข้ามแท็บด้วย BroadcastChannel (ชุดทดสอบ e2e เปิดสองแท็บ)
// Rules: จำลองเฉพาะกฎของ cr/hosts (จอง / ต่ออายุ / ปล่อยรหัสห้อง) ให้ตรงกับ database.rules.json เพราะตรรกะของโฮสต์พึ่งมัน
//        กฎอื่นทั้งหมดไม่ได้จำลอง — ต้องทดสอบกับ Firebase จริง (ดู README)
(function (root) {
'use strict';
const later = fn => setTimeout(fn, 0);
const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const seg = p => String(p).split('/').filter(Boolean);

class MemDB {
  // delay: () => ms — หน่วงการแจ้ง listener (จำลองความหน่วงของเครือข่าย) โดยยังคงลำดับเดิมเหมือน Firebase จริง
  constructor({ channel, delay } = {}) {
    this.data = {}; this.subs = new Set(); this.seq = 0; this.synced = true; this.delay = delay || null; this._due = 0;
    this.skew = 0; // เลื่อนนาฬิกาของ "server" ในเทสต์ (เช่น ข้ามไป 6 นาที)
    if (channel && typeof BroadcastChannel !== 'undefined') {
      this.id = Math.random().toString(36).slice(2);
      this.bc = new BroadcastChannel(channel);
      this.synced = false;
      this.bc.onmessage = (ev) => {
        const m = ev.data;
        if (m.t === 'w') this._apply(m.path, m.val);
        else if (m.t === 'hello' && m.from !== this.id && this.synced) this.bc.postMessage({ t: 'snap', to: m.from, data: this.data });
        else if (m.t === 'snap' && m.to === this.id && !this.synced) { this.data = clone(m.data) || {}; this.synced = true; this._notify(); }
      };
      this.bc.postMessage({ t: 'hello', from: this.id });
      setTimeout(() => { this.synced = true; }, 300); // ไม่มีใครตอบ = ฐานข้อมูลว่างอยู่
    }
  }
  // หน่วงแบบเข้าคิว: ส่งตามลำดับเดิมเสมอ (ตั้ง setTimeout แยกรายข้อความไม่ได้ — เวลาที่ถูกปัดเป็น ms ทำให้ลำดับสลับ ซึ่ง Firebase จริงไม่เป็น)
  _later(fn) {
    if (!this.delay) return later(fn);
    const now = Date.now(), due = Math.max(this._due, now + this.delay());
    this._due = due;
    (this._q || (this._q = [])).push({ due, fn });
    if (!this._pumping) this._pump();
  }
  _pump() {
    const q = this._q;
    if (!q.length) { this._pumping = false; return; }
    this._pumping = true;
    setTimeout(() => {
      while (q.length && q[0].due <= Date.now()) q.shift().fn();
      this._pump();
    }, Math.max(0, q[0].due - Date.now()));
  }
  now() { return Date.now() + this.skew; }
  // แทนค่า serverTimestamp ด้วยเวลาของฐานข้อมูล ณ ตอนเขียน
  _resolve(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return this.now();
      const out = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) out[k] = this._resolve(v[k]);
      return out;
    }
    return v;
  }
  whenSynced() { return new Promise(r => { const t = () => (this.synced ? r() : setTimeout(t, 20)); t(); }); }
  get(path) {
    let cur = this.data;
    for (const k of seg(path)) { if (cur === null || typeof cur !== 'object' || !(k in cur)) return null; cur = cur[k]; }
    return clone(cur);
  }
  write(path, val) { val = this._resolve(val); this._apply(path, val); this.bc?.postMessage({ t: 'w', path, val: clone(val) }); }
  _apply(path, val) {
    const ks = seg(path);
    if (!ks.length) { this.data = clone(val) || {}; return this._notify(); }
    const trail = [this.data];
    let cur = this.data;
    for (let i = 0; i < ks.length - 1; i++) {
      if (cur[ks[i]] === null || typeof cur[ks[i]] !== 'object') { if (val === null || val === undefined) return this._notify(); cur[ks[i]] = {}; }
      cur = cur[ks[i]]; trail.push(cur);
    }
    const last = ks[ks.length - 1];
    if (val === null || val === undefined) {
      delete cur[last];
      for (let i = trail.length - 1; i > 0; i--) { if (Object.keys(trail[i]).length) break; delete trail[i - 1][ks[i - 1]]; }
    } else cur[last] = clone(val);
    this._notify();
  }
  sub(type, path, cb) {
    const s = { type, path, cb, known: new Set(), last: undefined, dead: false };
    if (type === 'removed') Object.keys(this.get(path) || {}).forEach(k => s.known.add(k));
    this.subs.add(s);
    this._notify();
    return () => { s.dead = true; this.subs.delete(s); };
  }
  _notify() {
    for (const s of [...this.subs]) {
      const v = this.get(s.path);
      if (s.type === 'value') {
        const j = JSON.stringify(v);
        if (j !== s.last) { s.last = j; this._later(() => { if (!s.dead) s.cb(v === null ? null : JSON.parse(j)); }); }
      } else {
        const kids = v && typeof v === 'object' ? Object.keys(v).sort() : [];
        if (s.type === 'added') {
          for (const k of kids) if (!s.known.has(k)) { s.known.add(k); const x = clone(v[k]); this._later(() => { if (!s.dead) s.cb(k, x); }); }
          for (const k of [...s.known]) if (!(k in (v || {}))) s.known.delete(k);
        } else {
          for (const k of [...s.known]) if (!(k in (v || {}))) { s.known.delete(k); this._later(() => { if (!s.dead) s.cb(k); }); }
          for (const k of kids) s.known.add(k);
        }
      }
    }
  }
}

// adapter = ฝั่งผู้ใช้หนึ่งคน (uid) ต่อกับ MemDB — หน้าตาเดียวกับ makeFirebaseAdapter
function memoryAdapter(db, uid) {
  const conns = new Set(); const ods = new Set();
  let up = true;
  const denied = () => Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
  // กฎของ cr/hosts/{code} และ cr/hostOf/{uid} (ย่อจาก database.rules.json) · writes = { path: value } ที่กำลังจะเขียนพร้อมกัน
  //   hosts:  จอง/ต่ออายุได้เมื่อ ว่าง | ของเรา | ไม่ได้ต่ออายุเกิน 5 นาที และ (หลังเขียน) hostOf/{uid} ชี้มาที่รหัสนี้ · ลบได้เฉพาะของเรา
  //   hostOf: ของ uid ตัวเองเท่านั้น · ย้าย/ลบได้ต่อเมื่อรายการโฮสต์ของรหัสเดิมไม่อยู่แล้ว (หรือถูกลบในชุดเดียวกัน) หรือไม่ใช่ของเรา
  //           → uid หนึ่งถือได้ทีละรหัสเดียว · ค่าใหม่ต้องชี้ไปรหัสที่ (หลังเขียน) เราเป็นโฮสต์
  const after = (writes, path) => (path in writes ? writes[path] : db.get(path));
  const check = writes => {
    for (const p of Object.keys(writes)) {
      const x = /^cr\/hostOf\/([^/]+)$/.exec(p);
      if (x) {
        if (x[1] !== uid) throw denied();
        const old = db.get(p), val = writes[p];
        if (old && val !== old) { const h = db.get('cr/hosts/' + old); if (after(writes, 'cr/hosts/' + old) && h && h.host === uid) throw denied(); }
        if (val !== null && val !== undefined) { const h = after(writes, 'cr/hosts/' + val); if (!/^\d{4}$/.test(String(val)) || !h || h.host !== uid) throw denied(); }
        continue;
      }
      const m = /^cr\/hosts\/([^/]+)$/.exec(p);
      if (!m) continue;
      const cur = db.get(p), val = writes[p];
      if (val === null || val === undefined) { if (cur && cur.host !== uid) throw denied(); continue; }
      const free = !cur || cur.host === uid || !(cur.t >= db.now() - 300000);
      const idx = after(writes, 'cr/hostOf/' + uid);
      if (!free || val.host !== uid || !/^\d{4}$/.test(m[1]) || idx !== m[1]) throw denied();
    }
  };
  const a = {
    uid, db,
    ready: async () => { await db.whenSynced(); return uid; },
    now: () => db.now(),
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    update: async (obj) => { check(obj); Object.keys(obj).forEach(p => db.write(p, obj[p])); },
    onConnection(cb) { conns.add(cb); later(() => { if (conns.has(cb)) cb(up); }); return () => conns.delete(cb); },
    get: async p => db.get(p),
    set: async (p, v) => { check({ [p]: v }); db.write(p, v); },
    remove: async p => { check({ [p]: null }); db.write(p, null); },
    push: async (p, v) => { const k = Date.now().toString(36) + (++db.seq).toString(36).padStart(5, '0') + Math.random().toString(36).slice(2, 4); db.write(p + '/' + k, v); return k; },
    onChildAdded: (p, cb) => db.sub('added', p, cb),
    onChildRemoved: (p, cb) => db.sub('removed', p, cb),
    onValue: (p, cb) => db.sub('value', p, cb),
    onDisconnectRemove(p) { const e = { p }; ods.add(e); return () => ods.delete(e); },
    transaction: async (p, fn) => { const r = fn(db.get(p)); if (r === undefined) return false; db.write(p, r); return true; },
    // จำลองหลุด: ลบสิ่งที่ผูก onDisconnect ไว้ แล้วบอกว่าไม่ได้เชื่อมต่อ · restore() = ต่อกลับมา
    drop() { up = false; ods.forEach(e => db.write(e.p, null)); ods.clear(); conns.forEach(cb => later(() => cb(false))); },
    restore() { up = true; conns.forEach(cb => later(() => cb(true))); },
  };
  return a;
}

const api = { MemDB, memoryAdapter };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CRMemDB = api;
})(typeof window !== 'undefined' ? window : globalThis);
