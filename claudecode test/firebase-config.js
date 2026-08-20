// ============================================================
// Firebase config — ใส่ค่าจากคอนโซล Firebase ของคุณตรงนี้
// ------------------------------------------------------------
// วิธีเอาค่ามา (ทำครั้งเดียว):
//   1) เข้า https://console.firebase.google.com → สร้างโปรเจกต์
//   2) เมนูซ้าย Build → Realtime Database → Create Database
//        - เลือกโซนใกล้ ๆ (เช่น asia-southeast1)
//        - Start in "test mode" (ให้อ่าน/เขียนได้ก่อน)
//   3) คัดลอก databaseURL ที่ขึ้น (หน้าตาแบบด้านล่าง) มาวางแทน
//
// ต้องมีแค่ databaseURL ก็เล่นออนไลน์ได้ ที่เหลือใส่หรือไม่ก็ได้
// ถ้ายังไม่ใส่ (ยังเป็น YOUR_...) เกมจะเล่นออฟไลน์กับบอทตามปกติ
// ============================================================
export const firebaseConfig = {
  databaseURL: 'https://fishball-e7248-default-rtdb.asia-southeast1.firebasedatabase.app',
  // apiKey:    'YOUR_API_KEY',       // ไม่จำเป็นสำหรับ Realtime Database
  // projectId: 'YOUR_PROJECT',
};
