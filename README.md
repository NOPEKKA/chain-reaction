# 💥 Chain Reaction — Online Multiplayer

เกม Chain Reaction พร้อมระบบออนไลน์ สร้างห้อง + แชร์รหัส 4 ตัว

---

## 🚀 Deploy บน Railway (ฟรี)

### ขั้นตอน

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. ทดสอบ local
npm start
# เปิด http://localhost:3000
```

### Deploy Railway

1. ไปที่ **railway.app** → Login ด้วย GitHub
2. กด **"New Project"** → **"Deploy from GitHub repo"**
3. เลือก repo นี้
4. Railway จะ detect `package.json` และ deploy อัตโนมัติ
5. ได้ link เช่น `https://chain-reaction-production.up.railway.app`

---

## 📁 โครงสร้าง

```
chain-reaction/
├── server/
│   └── index.js          ← Express + Socket.IO server
├── client/
│   ├── index.html        ← เกม + Lobby UI
│   └── online.js         ← Socket client logic
├── shared/
│   └── gameLogic.js      ← Game logic (ใช้ร่วมกัน server/client)
├── package.json
└── railway.toml
```

---

## 🎮 วิธีเล่นออนไลน์

```
1. เปิด link → กด "ออนไลน์"
2. ใส่ชื่อ → กด "สร้างห้อง"
3. ได้รหัส 4 ตัว เช่น XK7F
4. แชร์รหัสให้เพื่อน
5. เพื่อนกด "เข้าห้อง" → ใส่รหัส
6. Host กด "เริ่มเกม!"
```

---

## ⚙️ Environment Variables

ไม่ต้องตั้งค่าอะไรพิเศษ — Railway จัดการ PORT ให้อัตโนมัติ

---

## 🔧 Local Development

```bash
npm install
npm run dev    # ใช้ nodemon auto-reload
```

เปิด `http://localhost:3000` — เปิด 2 tab เพื่อทดสอบ 2 ผู้เล่น
