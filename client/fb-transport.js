// ══ โหมดไม่มีเซิร์ฟเวอร์: socket.io จำลองที่ส่งข้อมูลผ่าน Firebase Realtime Database ══
//
// online.js เรียก io() แล้วใช้ socket.on / socket.emit เหมือนเดิมทุกอย่าง — ไฟล์นี้ให้ `io()` อีกแบบหนึ่งที่
//   · คนสร้างห้อง = "โฮสต์": เบราว์เซอร์ของเขารันตรรกะเซิร์ฟเวอร์ตัวเดียวกับ server/game-server.js
//     (กติกา · จับเวลาตา · เลือกการ์ด · rejoin ด้วย token) ผ่าน io จำลอง
//   · คนเข้าห้อง = "แขก": ส่งคำสั่งไปที่ Firebase แล้วโฮสต์หยิบไปทำ · ผลลัพธ์ส่งกลับทาง Firebase
//
// โครงข้อมูลใน Firebase (ทุกอย่างอยู่ใต้ cr/):
//   hosts/{code}                  { host: uid, t: เวลา }   โฮสต์จองรหัสห้อง · หายเมื่อโฮสต์ออก (onDisconnect)
//   rooms/{code}/in/{key}         { from: sid, d: JSON }   แขก → โฮสต์ (โฮสต์ลบทิ้งหลังอ่าน)
//   rooms/{code}/out/{sid}/{key}  { d: JSON }              โฮสต์ → แขกแต่ละคน (แขกลบทิ้งหลังอ่าน)
//   rooms/{code}/presence/{sid}   { t }                    แขกที่ยังเชื่อมต่ออยู่ · หายเมื่อแขกหลุด (onDisconnect)
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
class HostRuntime {
  constructor(a, deps, attach) {
    this.a = a; this.deps = deps;
    this.io = new FakeIO();
    this.codes = new Map();      // code → { unsubs, cancelOD }
    this.deliver = new Map();    // sid ของผู้เล่นในหน้านี้ → ฟังก์ชันส่งเข้า ClientSocket
    this.pendingCode = null;
    this.game = attach(this.io, {
      env: deps.env || {}, quiet: deps.quiet !== false,
      genCode: () => this.pendingCode,
      onRoomDeleted: code => this.release(code),
    });
    this._guard();
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

  // จองรหัสห้อง 4 หลักใน Firebase (ไม่ซ้ำกับโฮสต์คนอื่น) แล้วเริ่มฟังคำสั่งของห้องนั้น
  async claim() {
    const a = this.a, uid = a.uid;
    for (let i = 0; i < 40; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (this.codes.has(code) || this.game.rooms.has(code)) continue;
      const ok = await a.transaction(P('hosts', code), cur => {
        if (cur && cur.host !== uid && typeof cur.t === 'number' && Date.now() - cur.t < 86400000) return undefined; // มีโฮสต์อื่นถืออยู่
        return { host: uid, t: Date.now() };
      });
      if (!ok) continue;
      this._listen(code);
      return code;
    }
    throw new Error('จองรหัสห้องไม่ได้');
  }
  _listen(code) {
    const a = this.a, st = { unsubs: [], cancelOD: noop };
    this.codes.set(code, st);
    st.cancelOD = a.onDisconnectRemove(P('hosts', code));
    st.unsubs.push(a.onChildAdded(P('rooms', code, 'in'), (key, v) => this._onIn(code, key, v)));
    st.unsubs.push(a.onChildRemoved(P('rooms', code, 'presence'), sid => this._gone(code, sid)));
  }
  // ต่อเน็ตกลับมา: ประกาศตัวเป็นโฮสต์ของห้องอีกครั้ง (onDisconnect ลบทิ้งไปตอนหลุด)
  async republish() {
    for (const [code, st] of this.codes) {
      st.cancelOD();
      st.cancelOD = this.a.onDisconnectRemove(P('hosts', code));
      await this.a.set(P('hosts', code), { host: this.a.uid, t: Date.now() }).catch(noop);
    }
  }
  release(code) {
    const st = this.codes.get(code);
    if (!st) return;
    this.codes.delete(code);
    st.unsubs.forEach(u => { try { u(); } catch (e) {} });
    st.cancelOD();
    // ลบ rooms ก่อน hosts — Rules ตรวจสิทธิ์ลบจากรายการ hosts
    this.a.remove(P('rooms', code)).catch(noop).then(() => this.a.remove(P('hosts', code)).catch(noop));
  }

  local(sid, deliver) {
    this.deliver.set(sid, deliver);
    return this.io.sockets.sockets.get(sid) || this.io._connect(sid, (ev, args) => {
      const s = enc(args);
      later(() => this.deliver.get(sid)?.(ev, JSON.parse(s)));
    });
  }
  _remote(code, sid) {
    let s = this.io.sockets.sockets.get(sid);
    if (!s) s = this.io._connect(sid, (ev, args) => this._out(s._code, sid, ev, args));
    s._code = code;
    return s;
  }
  _out(code, sid, ev, args) {
    if (!code || !this.codes.has(code)) return;
    this.a.push(P('rooms', code, 'out', sid), { d: enc([ev, args]) }).catch(e => this.deps.onError?.(e));
  }
  _onIn(code, key, v) {
    this.a.remove(P('rooms', code, 'in', key)).catch(noop);
    if (!v || typeof v.from !== 'string' || typeof v.d !== 'string' || !/^[A-Za-z0-9]+_[0-9a-f]+$/.test(v.from)) return;
    let m; try { m = JSON.parse(v.d); } catch (e) { return; }
    if (!m || typeof m.ev !== 'string' || m.ev === 'disconnect' || m.ev === 'connection') return;
    const sock = this._remote(code, v.from);
    const cb = m.k ? res => this._out(code, v.from, '__ack', [m.k, res === undefined ? null : res]) : null;
    const args = m.a === undefined || m.a === null ? [] : [m.a];
    sock._dispatch(m.ev, cb ? [...args, cb] : args);
  }
  _gone(code, sid) {
    this.a.remove(P('rooms', code, 'out', sid)).catch(noop);
    // ระหว่างที่ห้องนี้ถูกลบไปแล้ว ไม่ต้องทำอะไร
    if (this.io.sockets.sockets.has(sid) && !this.deliver.has(sid)) this.io._disconnect(sid, 'transport close');
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
        if (!host) return cb?.({ ok: false, gone: true, msg: 'ไม่พบห้องรหัสนี้' });
        await this._attach(code);
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
  async _attach(code) {
    this._unbind(false);
    const a = this.a, b = this._bind = { code, unsubs: [], cancelOD: noop, goneTimer: null, first: true };
    b.unsubs.push(a.onChildAdded(P('rooms', code, 'out', this.id), (key, v) => {
      a.remove(P('rooms', code, 'out', this.id, key)).catch(noop);
      let m; try { m = JSON.parse(v.d); } catch (e) { return; }
      if (Array.isArray(m)) this._recv(m[0], m[1] || []);
    }));
    await this._announce(b);
    // โฮสต์ยังอยู่ไหม: หายไปครู่หนึ่ง = หลุด (รอกลับมา) · หายนาน = ห้องปิด
    b.unsubs.push(a.onValue(P('hosts', code), v => {
      const first = b.first; b.first = false;
      if (v) {
        if (b.goneTimer) { clearTimeout(b.goneTimer); b.goneTimer = null; this._announce(b).catch(noop); this.connected = true; this._fire('connect'); }
        return;
      }
      if (b.goneTimer) return;
      if (this.connected) { this.connected = false; this._fire('disconnect', 'transport close'); }
      b.goneTimer = setTimeout(() => {
        if (this._bind !== b) return;
        this._unbind(true); this.route = null;
        this.connected = true; // ตัวเราเองยังต่อ Firebase อยู่ — โฮสต์ต่างหากที่ไป
        this._fire('room_closed', { reason: 'host_left' });
      }, this.deps.hostGoneMs ?? 20000);
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
  const app = A.initializeApp(config), db = D.getDatabase(app), auth = Au.getAuth(app);
  const R = p => D.ref(db, p);
  const a = {
    uid: null,
    async ready() { a.uid = (await Au.signInAnonymously(auth)).user.uid; return a.uid; },
    onConnection: cb => D.onValue(R('.info/connected'), s => cb(!!s.val())),
    get: async p => (await D.get(R(p))).val(),
    set: (p, v) => D.set(R(p), v),
    remove: p => D.remove(R(p)),
    push: async (p, v) => { const r = D.push(R(p)); await D.set(r, v); return r.key; },
    onChildAdded: (p, cb) => D.onChildAdded(R(p), s => cb(s.key, s.val())),
    onChildRemoved: (p, cb) => D.onChildRemoved(R(p), s => cb(s.key)),
    onValue: (p, cb) => D.onValue(R(p), s => cb(s.val())),
    onDisconnectRemove: p => { const od = D.onDisconnect(R(p)); od.remove(); return () => { od.cancel(); }; },
    transaction: async (p, fn) => (await D.runTransaction(R(p), cur => fn(cur))).committed,
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
