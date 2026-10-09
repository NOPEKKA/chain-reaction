const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const { attach } = require('./game-server');

// Global error handler - keep the process alive
// (เฉพาะตอนรันเป็น server จริง — ตอนถูก require จากชุดทดสอบ ปล่อยให้ error โผล่ตามปกติ)
if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
    // ไม่ crash server
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
  });
}

const app    = express();
const server = http.createServer(app);
// CORS: ตั้งผ่าน env ALLOWED_ORIGIN (คั่นหลายค่าด้วย ,) — ไม่ตั้ง = '*' เหมือนเดิม
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOrigin = (!ALLOWED_ORIGIN.length || ALLOWED_ORIGIN.includes('*')) ? '*' : ALLOWED_ORIGIN;
const io     = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET','POST'] },
  pingTimeout: 60000, pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, '../client')));
// โหมด Firebase (เกมรันจากหน้าเว็บล้วนๆ) โหลดสองไฟล์นี้ไปรันในเบราว์เซอร์ของโฮสต์ — เสิร์ฟให้ด้วยเพื่อทดลองในเครื่องได้
app.use('/shared', express.static(path.join(__dirname, '../shared')));
app.get('/lib/game-server.js', (req, res) => res.sendFile(path.join(__dirname, 'game-server.js')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

const game = attach(io, { env: process.env });
const { rooms, socketRoom } = game;

const PORT = process.env.PORT || 3000;
// start(0) = port สุ่ม (ชุดทดสอบใช้) · คืน port ที่เปิดจริง
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server.address().port));
  });
}
function stop() {
  game.stop();
  return new Promise(resolve => io.close(() => resolve()));
}

if (require.main === module) {
  start().then(port => console.log(`\n🚀 Chain Reaction at http://localhost:${port}\n`));
}

module.exports = { app, server, io, rooms, socketRoom, start, stop };
