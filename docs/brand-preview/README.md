# ChivaGo × สินธานี — ปรับหน้าลูกค้า

ปรับหน้าแรก `/`, หน้าจอง `/book`, ตารางคิว `/schedule` และการจองของฉัน `/me` ให้ใช้สีเขียวเข้ม–มินต์ การ์ดสนามพร้อมภาพประกอบ และโลโก้ต้นฉบับทั้งสองแบรนด์ตามภาพอ้างอิง ไม่เพิ่มช่องทางชำระเงิน ราคา หรือสิทธิประโยชน์จากภาพตัวอย่าง

## ภาพก่อน–หลัง

ภาพเหล่านี้ตรวจที่ความกว้าง 390 พิกเซลด้วยคอมโพเนนต์จริงในหน้าทดสอบแยก ใช้ข้อมูลสนามจำลองและฟอนต์ของเครื่อง ไม่มีการเชื่อมต่อฐานข้อมูล สร้างการจอง หรือกดปุ่มแอดมิน ภาพในเว็บจริงใช้ฟอนต์ Prompt ตามเดิม

| หน้า | ก่อน | หลัง |
| --- | --- | --- |
| หน้าแรก | ![ก่อน](home-before-light.jpg) | ![หลัง](home-after-light.jpg) |
| จองสนาม | ![ก่อน](book-before-light.jpg) | ![หลัง](book-after-light.jpg) |

โหมดมืด: [หน้าแรก](home-after-dark.jpg), [จองสนาม](book-after-dark.jpg)

ตารางคิว: [ภาพหลังปรับ](schedule-after-light.jpg)

ตรวจการเลือกสองสนามพร้อมกันได้ และเลือกเวลา 15:00 แล้วแสดง 15:00–16:00 รวม 150 บาทตามข้อมูลทดสอบ ตรวจหน้าจองแล้วไม่มีการล้นในแนวนอน

## ภาพประกอบและโลโก้

- `public/brand/sinthani-logo.png`: คัดลอกโลโก้สินธานีที่ผู้ใช้ส่งมา ไม่แก้ไฟล์ต้นฉบับ
- `public/brand/chivago-logo.png`: คัดลอกโลโก้ ChivaGo ที่ผู้ใช้ส่งมา ไม่แก้ไฟล์ต้นฉบับ
- `public/brand/court-hero.png`: ภาพประกอบสถาปัตยกรรมที่สร้างด้วย built-in ImageGen ไม่ใช่ภาพถ่ายสนามจริง ใช้เป็นแบนเนอร์และภาพประกอบการ์ดสนาม บนหน้าเว็บใช้ Next Image เพื่อปรับขนาดภาพ

### Prompt ที่ใช้กับ built-in ImageGen

> Use case: stylized-concept. Create one premium website hero background asset, landscape 3:2. A cinematic architectural illustration of an indoor Thai badminton hall, emerald green courts with crisp white boundary lines, one net in the middle ground, dark teal walls, dramatic roof beams and warm ceiling strip lights, slight atmospheric mist, peaceful empty venue, eye-level view from the back corner. Photorealistic 3D architectural visualization, not documentary photo. Rich deep forest green, jade, teal and subtle lime highlights. The left half should have darker shadows suitable for white text overlay. On the lower RIGHT foreground place a beautiful oversized white feather shuttlecock with dark green cork band, angled diagonally, premium sports advertisement composition. No people, no logos, no lettering, no watermark, no UI. Keep center court and white feather detail visible when cropped to portrait. This is a decorative asset for a Thai badminton booking website styled in jade and mint.

## การตรวจสอบ

- npm test: ผ่าน 147 ข้อ
- npm run build: ผ่าน
- ตรวจหน้าแรก หน้าจอง และตารางคิวในหน้าทดสอบแยกที่ความกว้างมือถือ รวมโหมดสว่างและโหมดมืด
- ไม่แก้ migrations, Server Actions, API, การเชื่อมต่อฐานข้อมูล, ราคา หรือเวลาเปิด–ปิด
