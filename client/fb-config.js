// ค่าเชื่อม Firebase สำหรับโหมดออนไลน์แบบไม่มีเซิร์ฟเวอร์ (GitHub Pages)
// ค่าพวกนี้เปิดเผยได้ — ใครเปิดหน้าเว็บก็เห็นอยู่แล้ว ความปลอดภัยอยู่ที่ database.rules.json ไม่ใช่การซ่อนค่า
// ถ้าเปิดเกมจาก server ของเกม (npm start / Railway) จะใช้ socket.io แทน ไม่แตะ Firebase
window.CR_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBw7hVW7nS89SulURFKdWalbguCq1AWAks",
  authDomain: "chain-reaction-acde2.firebaseapp.com",
  databaseURL: "https://chain-reaction-acde2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chain-reaction-acde2",
  storageBucket: "chain-reaction-acde2.firebasestorage.app",
  messagingSenderId: "162743480375",
  appId: "1:162743480375:web:f0b0200e6acbcb11d30fb2"
};

// App Check (ไม่บังคับ — ปิดอยู่เมื่อไม่ได้ตั้งค่า): กันสคริปต์ที่ไม่ได้มาจากหน้าเว็บนี้ไม่ให้ใช้ฐานข้อมูล
// วิธีเปิด: Firebase console → App Check → ลงทะเบียนเว็บแอปด้วย reCAPTCHA v3 → เอา site key มาใส่บรรทัดล่าง
//          → ลองเล่นให้แน่ใจว่าใช้ได้ แล้วค่อยกด Enforce ที่ Realtime Database (ดู README หัวข้อความปลอดภัย)
// window.CR_APPCHECK_SITE_KEY = "วาง site key ของ reCAPTCHA v3 ที่นี่";
