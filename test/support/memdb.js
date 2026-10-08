// Realtime Database จำลองในหน่วยความจำ — ไว้ทดสอบ client/fb-transport.js โดยไม่ต้องต่อ Firebase จริง
//  · ใน Node: หลาย adapter ใช้ MemDB ตัวเดียวกัน (แทนแขกหลายคนที่ใช้ฐานข้อมูลเดียวกัน)
//  · ในเบราว์เซอร์: MemDB({ channel }) ซิงก์ข้ามแท็บด้วย BroadcastChannel (ชุดทดสอบ e2e เปิดสองแท็บ)
// ไม่จำลอง Rules — Rules ต้องทดสอบกับ Firebase จริง
(function (root) {
'use strict';
const later = fn => setTimeout(fn, 0);
const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const seg = p => String(p).split('/').filter(Boolean);

class MemDB {
  constructor({ channel } = {}) {
    this.data = {}; this.subs = new Set(); this.seq = 0; this.synced = true;
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
  whenSynced() { return new Promise(r => { const t = () => (this.synced ? r() : setTimeout(t, 20)); t(); }); }
  get(path) {
    let cur = this.data;
    for (const k of seg(path)) { if (cur === null || typeof cur !== 'object' || !(k in cur)) return null; cur = cur[k]; }
    return clone(cur);
  }
  write(path, val) { this._apply(path, val); this.bc?.postMessage({ t: 'w', path, val: clone(val) }); }
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
        if (j !== s.last) { s.last = j; later(() => { if (!s.dead) s.cb(v === null ? null : JSON.parse(j)); }); }
      } else {
        const kids = v && typeof v === 'object' ? Object.keys(v).sort() : [];
        if (s.type === 'added') {
          for (const k of kids) if (!s.known.has(k)) { s.known.add(k); const x = clone(v[k]); later(() => { if (!s.dead) s.cb(k, x); }); }
          for (const k of [...s.known]) if (!(k in (v || {}))) s.known.delete(k);
        } else {
          for (const k of [...s.known]) if (!(k in (v || {}))) { s.known.delete(k); later(() => { if (!s.dead) s.cb(k); }); }
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
  const a = {
    uid, db,
    ready: async () => { await db.whenSynced(); return uid; },
    onConnection(cb) { conns.add(cb); later(() => { if (conns.has(cb)) cb(up); }); return () => conns.delete(cb); },
    get: async p => db.get(p),
    set: async (p, v) => { db.write(p, v); },
    remove: async p => { db.write(p, null); },
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
