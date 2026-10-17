# เอกสารส่งมอบโปรเจกต์ (Project Handoff Document)
**ระบบจองสนามแบดมินตัน แบดมินตัน@สินธานี**

> เอกสารนี้จัดทำขึ้นเพื่อให้ทีมพัฒนาหรือ AI Assistant (Claude) สามารถอ่านและเข้าใจบริบท สถาปัตยกรรม กฎเกณฑ์ทางธุรกิจ สถานะปัจจุบัน และขั้นตอนการพัฒนาต่อได้อย่างรวดเร็วและถูกต้อง 100%

---

## 1. ข้อมูลภาพรวมและลิงก์โปรดักชัน (Executive Summary)
- **ชื่อโครงการ:** ระบบจองสนามแบดมินตัน แบดมินตัน@สินธานี
- **Production URL:** [https://badminton-booking-steel.vercel.app](https://badminton-booking-steel.vercel.app)
- **สถานะปัจจุบัน:** 
  - ✅ Production Deployment สำเร็จ (Live)
  - ✅ Vitest Unit Tests: 10/10 files (119/119 tests passed)
  - ✅ Database E2E Tests (PGlite): ALL PASSED
  - ✅ Production Build (`next build`): Compiled สำเร็จ 0 error
  - ✅ รัน Database Migration `0008_half_hour_and_rules.sql` บน Supabase Production เรียบร้อยแล้ว

---

## 2. อัปเดตล่าสุดที่เพิ่งทำเสร็จ (Recent Key Changes)
1. **ตัดเศษสตางค์ออกจากระบบทั้งหมด (No Satang)**:
   - ปรับยอดเงิน PromptPay QR, การแสดงผลในหน้าเว็บ และหน้าสลิปให้เป็นจำนวนเต็มบาท (`formatBaht` ใช้ `Math.round(...)`)
2. **ระบบสล็อตเวลาแบบ 30 นาที (ครึ่งชั่วโมง)**:
   - รองรับการจองทีละ 0.5 ชั่วโมง (เช่น 0.5, 1.0, 1.5, 2.0 ชม.)
   - รอบเริ่มต้นของสนามเริ่มได้ทุกๆ 30 นาที (เช่น 09:00, 09:30, 10:00, 10:30, ...)
3. **โครงสร้างราคาใหม่**:
   - **฿150 ต่อชั่วโมง** (หรือรอบละ **฿75 ต่อ 30 นาที**) สำหรับสนาม 1 – 4
4. **ระยะเวลาล็อกคิวรอชำระเงิน (Hold Timeout)**:
   - ปรับลดเหลือ **5 นาที** (จากเดิม 15 นาที) เพื่อป้องกันการจองดองคิว
5. **กติกาและข้อปฏิบัติของสนาม 9 ข้อ**:
   - สร้าง Component `src/components/CourtRules.tsx` และนำไปแสดงผลที่หน้าแรกของลูกค้าแล้ว
6. **Database Migration 0008**:
   - สร้างไฟล์ `supabase/migrations/0008_half_hour_and_rules.sql` อัปเดต Stored Procedures `opening_hours_ok`, `create_booking`, และ `admin_create_booking` ให้รับ `numeric hours` และรันบน Supabase เรียบร้อย

---

## 3. สถาปัตยกรรมและเทคโนโลยี (Tech Stack)
- **Frontend:** Next.js 15 (App Router, Server Actions, React 19)
- **Styling:** Vanilla CSS (`src/app/globals.css`) ออกแบบ Responsive ใช้งานง่ายบนมือถือ
- **Backend / Database:** Supabase (PostgreSQL 15+, Row Level Security, Realtime, Storage)
- **Database Engine ในการทดสอบ:** `@electric-sql/pglite` (รัน Postgres จำลองแบบ in-memory ทดสอบ Stored Procedures ได้ 100% ออฟไลน์)
- **Payment & Verification:**
  - สร้าง QR Code PromptPay ตามมาตรฐาน EMVCo (`promptpay-qr` logic ใน `src/lib/promptpay.ts`)
  - EasySlip API สำหรับตรวจสลิปอัตโนมัติ (Optional ใน `src/lib/slip/`)
  - Webhook รับ Notification เงินเข้าจากแอปธนาคารผ่านมือถือร้าน (`src/app/api/bank-notifications/`)
- **Authentication:** Supabase Auth (Magic Link OTP ทางอีเมล) + LINE Login (OAuth 2.0)
- **Hosting:** Vercel

---

## 4. กฎทางธุรกิจที่สำคัญ (Business Rules & Constraints)
ตั้งค่าหลักอยู่ที่ `src/lib/config.ts` และถูกบังคับใช้ซ้ำในระดับ PostgreSQL Stored Procedures (`create_booking`):
```typescript
export const BOOKING_RULES = {
  venueName: "แบดมินตัน@สินธานี",
  openHour: 9,          // เปิด 09:00 น.
  closeHour: 23,        // ปิด 23:00 น.
  stepMinutes: 30,      // สล็อตละ 30 นาที
  minHours: 0.5,        // ขั้นต่ำ 30 นาที (75 บาท)
  maxHours: 4,          // จองออนไลน์ได้ไม่เกิน 4 ชม.
  maxDaysAhead: 14,     // จองล่วงหน้าได้ไม่เกิน 14 วัน
  holdMinutes: 5,       // ล็อกคิวรอชำระเงิน 5 นาที
  pricePerHalfHour: 75,
  pricePerHour: 150,
} as const;
```

### การป้องกันในระดับ Database (Hard Constraints):
- **ห้ามจองซ้อน (No Double Booking):** ใช้ Exclusion Constraint `btree_gist` บน `(court_id, tstzrange(starts_at, ends_at))` ในตาราง `bookings`
- **อัตราการจอง:** 1 บัญชีผู้ใช้จองได้ไม่เกิน 6 ครั้ง/ชั่วโมง และมีคิวที่รอชำระเงิน/รอตรวจสลิปค้างได้ไม่เกิน 4 รายการ (รองรับผู้ใช้จองเหมา 4 สนามพร้อมกัน)
- **การปล่อยคิวหมดอายุ:** ฟังก์ชัน `expire_holds()` จะปลดคิวที่เกิน 5 นาทีให้อัตโนมัติทุกครั้งที่มีการจองใหม่ หรือทำงานผ่าน `pg_cron`

---

## 5. โครงสร้างโฟลเดอร์และไฟล์สำคัญ (Key Files & Directory Structure)
```
badminton-booking/
├── src/
│   ├── app/
│   │   ├── (customer)/
│   │   │   ├── layout.tsx         # Layout หน้าลูกค้า (แบรนด์ "แบดมินตัน@สินธานี")
│   │   │   ├── page.tsx           # หน้าแรก (คิววันนี้, สนามของเรา, กติกา 9 ข้อ)
│   │   │   ├── book/page.tsx      # หน้าเลือกวันเวลาจองสนาม
│   │   │   ├── bookings/[id]/     # หน้ารายละเอียดการจอง, QR ชำระเงิน, แนบสลิป
│   │   │   ├── me/page.tsx        # ประวัติการจองของฉัน
│   │   │   └── schedule/page.tsx  # ตารางคิวแบบละเอียดทุกสนาม
│   │   ├── admin/                 # ระบบหลังบ้านสำหรับแอดมินตรวจสลิปและคีย์จอง
│   │   ├── api/                   # API routes (Bank notifications webhook)
│   │   ├── actions.ts             # Server Actions (createBooking, submitSlip, adminCreateBooking ฯลฯ)
│   │   └── globals.css            # ดีไซน์ระบบทั้งหมด
│   ├── components/
│   │   ├── BookingForm.tsx        # แบบฟอร์มจองสนาม (รองรับสล็อต 30 นาที)
│   │   ├── ScheduleBoard.tsx      # ตารางบอร์ดเรียลไทม์ (ช่องละ 30 นาที)
│   │   ├── CourtRules.tsx         # ข้อปฏิบัติ 9 ข้อของ แบดมินตัน@สินธานี
│   │   ├── AdminBookingForm.tsx   # แบบฟอร์มแอดมินจองแทนลูกค้าหน้าร้าน/โทร/LINE
│   │   └── SlipUploader.tsx       # กล่องอัปโหลดสลิป
│   └── lib/
│       ├── config.ts              # ค่าคงที่กฎการจองและราคา
│       ├── slots.ts               # การคำนวณเวลาสล็อต 30 นาที และสถานะคิว
│       ├── format.ts              # ฟอร์แมตเงินบาท (formatBaht) และฟอร์แมตเวลา
│       ├── promptpay.ts           # สร้าง PromptPay QR payload
│       └── supabase/              # Supabase client helpers (SSR + Server)
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql          # สร้างตาราง courts, bookings, RLS, trigger
│       ├── 0002_expire_holds_cron.sql # pg_cron ปล่อยคิวหมดอายุ
│       ├── 0003_slip_verification.sql # ระบบตรวจสลิป Storage slips
│       ├── 0004_bank_notifications.sql # ระบบกล่องข้อความเงินเข้า
│       ├── 0005_admin_bookings.sql    # แอดมินจองแทนหน้าร้าน
│       ├── 0006_line.sql              # LINE Login profile link
│       ├── 0007_round_amounts.sql     # ตัดเศษสตางค์ออก
│       └── 0008_half_hour_and_rules.sql # รองรับ 30 นาที, hold 5 นาที, ราคา 150 บาท
├── scripts/
│   ├── test-db.mjs                # ชุดทดสอบ Postgres E2E จำลองด้วย PGlite
│   └── seed-demo.mjs              # Seed ข้อมูลจำลอง
└── test/                          # Unit test suites (Vitest)
```

---

## 6. คำสั่งสำหรับพัฒนาและตรวจสอบระบบ (Developer Commands)

### รัน Local Development
```bash
npm run dev
# เปิดที่ http://localhost:3000
```

### รัน Unit Tests (Vitest)
```bash
npm test
# ตรวจสอบ 119 unit tests
```

### รัน Database End-to-End Tests (PGlite)
```bash
npm run test:db
# รัน migration 0001 - 0008 ใน PGlite และทดสอบ business logic ทุกข้อ
```

### ตรวจสอบ Production Build
```bash
npm run build
```

### Deploy ขึ้น Vercel Production
```bash
npx vercel --prod --yes
```

---

## 7. ตัวแปรสภาพแวดล้อม (Environment Variables - `.env.local`)
| ตัวแปร | ความสำคัญ | คำอธิบาย |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | จำเป็น | URL ของ Supabase Project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | จำเป็น | Anon public key สำหรับ client-side |
| `SUPABASE_SERVICE_ROLE_KEY` | จำเป็น | Service role key สำหรับ Server Actions / Admin |
| `SUPABASE_DB_URL` | สำคัญ | Connection string ต่อตรงเข้า Postgres |
| `PROMPTPAY_ID` | จำเป็น | เบอร์โทรศัพท์ หรือเลขบัตร ปชช. พร้อมเพย์ของสนาม (เช่น `0829457278`) |
| `NEXT_PUBLIC_SITE_URL` | จำเป็น | URL เว็บ (Local: `http://localhost:3000`, Prod: `https://badminton-booking-steel.vercel.app`) |
| `LINE_LOGIN_CHANNEL_ID` | ตัวเลือก | LINE Login channel ID |
| `LINE_LOGIN_CHANNEL_SECRET` | ตัวเลือก | LINE Login secret |
| `LINE_MESSAGING_TOKEN` | ตัวเลือก | LINE OA Messaging token ส่งแจ้งเตือนหาร้าน |
| `EASYSLIP_API_KEY` | ตัวเลือก | API Key จาก EasySlip ตรวจสลิปอัตโนมัติ |
| `BANK_WEBHOOK_SECRET` | ตัวเลือก | Secret 32+ ตัวอักษรสำหรับรับ push notification เงินเข้า |

---

## 8. ข้อสังเกตและสิ่งที่ควรทราบสำหรับงานรอบถัดไป (Notes for Claude / Developers)
1. **การตั้งสิทธิ์ Admin ให้บัญชีแรก**:
   - เมื่อผู้ดูแลระบบล็อกอินผ่านเว็บแล้ว ให้เข้า Supabase SQL Editor แล้วรัน:
     ```sql
     update public.profiles set is_admin = true
     where id = (select id from auth.users where email = 'your-admin-email@example.com');
     ```
2. **การทำงานของ EasySlip**:
   - หากยังไม่ได้ตั้ง `EASYSLIP_API_KEY` ใน Vercel Environment Variables สลิปที่ลูกค้าอัปโหลดจะถูกส่งไปรอให้แอดมินกดตรวจสอบด้วยมือที่หน้า `/admin` เสมอ (ระบบไม่พัง)
3. **การแสดงผลสล็อต 30 นาที**:
   - ฟังก์ชัน `maxBookableHours` และ `cellState` ใน `src/lib/slots.ts` คำนวณแบบ 0.5 step หากต้องการปรับเปลี่ยนความละเอียดหรือเวลาเปิดปิด ให้แก้คู่กันระหว่าง `src/lib/config.ts` และ SQL Stored Procedure `opening_hours_ok`
