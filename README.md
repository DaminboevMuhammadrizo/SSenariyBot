# Tartib — SMM kontent reja (Telegram Mini App)

SMM menejerlar uchun: har bir loyiha (brend/mijoz) uchun alohida kontent kalendar, post vaqtida eslatma,
mijoz yoki jamoaga ulashish (👍 / 👎 va izohlar), Gemini AI yordamchi, jamoa uchun vazifa va xodim faolligi.
Hammasi Telegram ichida. Dizayn: oq-qora minimalizm, loyiha rangi ixtiyoriy, o‘zimizning ikonkalar to‘plami.

## Tuzilma

```
src/                    NestJS backend
  main.ts, app.module.ts
  prisma/               PrismaService (PostgreSQL)
  common/               auth (Telegram initData HMAC), config, kesh (LFU), ETag/brotli, xatolar
  tg/                   Telegram yuborish navbati (25 msg/s), fikrlar dayjesti
  users/                foydalanuvchilar, faollik bufferi (15 s da bir marta yoziladi)
  billing/              tariflar, jamoa narxi, to‘lov (karta+chek yoki Telegram Payments), obuna
  projects/             loyihalar, postlar, baho, izoh, ulashish, /api/boot
  team/                 jamoa, vazifalar (berish → bajardim → tasdiqlash/qaytarish), xodim faolligi
  ai/                   Gemini: kontent reja, matn, yaxshilash, heshteg; oylik limit
  admin/                statistika (son va %), narxlarni belgilash, to‘lovlar, foydalanuvchilar
  scheduler/            eslatmalar (keyingi vaqtga bitta taymer), obuna tugashi, kunlik pg_dump
  telegram/             bot: /start, cheklar, admin tugmalari, murojaatlar (webhook yoki polling)
  web/                  Mini App fayllarini RAM’dan siqilgan holda beradi
web/src/                Mini App manbasi (framework yo‘q): core.js, team.js, admin.js, style.css, sprite.svg, sw.js
tools/build.mjs         web/src → public/ (bitta inline HTML + lazy chunk’lar + service worker)
prisma/schema.prisma    baza sxemasi
brand/                  logo
Dockerfile, docker-compose.yml, nginx.conf, .github/workflows/deploy.yml
```

## Tezlik va xotira

- **Birinchi ekran = bitta HTML, ~21 KB brotli** (CSS, JS, ikonkalar ichida). Jamoa va admin ekranlari
  alohida ~5 KB bo‘laklar, faqat kerak bo‘lganda yuklanadi.
- **Qurilmada kesh**: bosh sahifa va loyihalar localStorage’da — ekran tarmoqni kutmasdan chiziladi,
  keyin `If-None-Match` bilan tekshiriladi: o‘zgarmagan bo‘lsa **304, 0 bayt**. Service worker ilova
  qobig‘ini saqlaydi — ikkinchi ochilish qurilmadan.
- **Serverda kesh**: loyiha javobi har versiya (`rev`) uchun bir marta quriladi, brotli+gzip bilan siqilib
  LFU keshda turadi (`CACHE_MAX_MB`, bayt bilan cheklangan). O‘zgarishda versiya +1, eski yozuv o‘chadi —
  eskirgan ma’lumot hech qachon chiqmaydi. ETag versiyadan: bazaga tegmasdan 304.
- Tariflar va sozlamalar RAM’da; faollik/oxirgi kirish 15 soniyada **bitta** SQL bilan yoziladi.
- Eslatmalar uchun polling yo‘q: keyingi eslatma vaqtiga bitta taymer (indeksli `MIN()` so‘rov).
- AI: bir xil so‘rov keshdan (limitni yemaydi), bir vaqtda ko‘pi bilan 6 ta chaqiruv.
- Xotira nazoratchisi: RSS `RSS_SOFT_MB` dan oshsa kesh yarmini bo‘shatadi; konteyner `mem_limit: 512m`.

## Tariflar (admin paneldan o‘zgartiriladi)

| | Oylik | Yillik | |
|---|---|---|---|
| Bepul | 0 | 0 | 1 loyiha, loyihaga 30 post |
| Pro | 13 000 | 100 000 | cheksiz |
| Pro + AI | 26 000 | 134 000 | cheksiz + AI (oyiga 300 so‘rov) |
| Jamoa | 13 000 / kishi | 100 000 / kishi | 30+ kishi: 10 000 / 77 000 |

Admin yangi tarif qo‘shishi, narx, limit, AI kvotasini o‘zgartirishi, tarifni sotuvdan olishi mumkin.
AI so‘rov narxi: kontent reja = 3, qolganlari = 1.

## Ishga tushirish

**Lokal:**
```bash
npm install
cp .env.example .env        # DATABASE_URL — lokal Postgres; DEV_AUTH=1
npx prisma db push
npm run build:web
npm run start:dev           # brauzerda: http://localhost:4002/?dev=1
```

**Server (CI/CD):** `main` ga push → GitHub Actions: tip tekshiruvi + build → SSH orqali serverda
`git pull` → `.env` secrets’dan yoziladi → `docker compose build` (eski konteyner ishlab turadi) →
`up -d` (db tegilmaydi) → health check → tozalash.

GitHub secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `SERVER_PORT` (ixtiyoriy), `GH_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `WEBHOOK_DOMAIN`, `WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`,
`ADMIN_GROUP_ID`, `STORAGE_CHAT_ID`, `PAYMENT_PROVIDER_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `POSTGRES_PASSWORD`.

Serverda: `nginx.conf` → `/etc/nginx/sites-available/tartib` (domenni almashtiring), `certbot --nginx -d <domen>`.

## Bot sozlash

1. @BotFather → `/newbot` → token. **Bot Settings → Configure Mini App** → `https://<domen>/`
   (ulashish havolalari `t.me/<bot>?startapp=...` shu orqali ishlaydi).
2. To‘lov: BotFather → Payments (Click/Payme) → `PAYMENT_PROVIDER_TOKEN`; yoki bo‘sh qoldiring va admin
   panel → Narxlar → karta raqamini kiriting (foydalanuvchi chekni botga yuboradi, siz ✅ bosasiz).
3. Admin buyruqlari: `/admin`, `/stats`, `/backup`, `/grant <id> <tarif> <kun>`.
