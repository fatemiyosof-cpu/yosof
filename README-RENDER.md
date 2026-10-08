# ARcodm Subscription Server 2.1 — Render

این نسخه برای Render اصلاح شده تا Subscriptionها بعد از sleep/restart/deploy ناپدید نشوند.

## مشکل نسخه قبلی

نسخه قبلی اگر `DATABASE_URL` تنظیم نشده بود، اطلاعات را در `/var/data/subscriptions.json` ذخیره می‌کرد. فایل‌سیستم عادی Render دائمی نیست؛ بنابراین بعد از restart، redeploy یا spin-down می‌توانست اطلاعات از بین برود.

این نسخه PostgreSQL را مسیر اصلی و پایدار می‌کند. `render.yaml` هم یک Render Postgres تعریف می‌کند و `DATABASE_URL` را خودکار به Web Service وصل می‌کند.

## Render

اگر این repository را به صورت Blueprint/Infrastructure deploy می‌کنی، `render.yaml` را نگه دار. Render باید Web Service و PostgreSQL را از همان Blueprint بسازد و `DATABASE_URL` را خودش inject کند.

Build Command:
`npm install`

Start Command:
`npm start`

Health Check:
`/health`

`npm start` در این پروژه عمداً به `node server.js` وصل است؛ نیازی به Start Command دیگری نیست.

## متغیرها

- `DATABASE_URL`: از Render Postgres توسط Blueprint تنظیم می‌شود.
- `PUBLIC_BASE_URL`: آدرس عمومی همین Web Service، مثل `https://ae-codm-panel.onrender.com`
- `TELEGRAM_URL`: اختیاری؛ مقدار پیش‌فرض `https://t.me/ar8codm`
- `ADMIN_KEY`: اختیاری؛ اگر آن را فعال کنی، DELETE API به کلید نیاز دارد.

## تست بعد از Deploy

اول:
`https://YOUR-SERVICE.onrender.com/health`

باید چیزی شبیه این ببینی:
`{"ok":true,"service":"ARcodm Subscription","version":"2.1.0","storage":"postgres",...}`

اگر `storage` برابر `file` بود، یعنی سرویس به PostgreSQL وصل نشده و نباید آن را برای داده دائمی استفاده کنی.

## API

- `POST /api/subscriptions`
- `DELETE /api/subscriptions/:id`
- `GET /api/subscriptions/:id`
- `GET /sub/:id`

## نکته مهم درباره تایمر

وقتی پنل همان Subscription را برای update دوباره POST می‌کند، اگر Subscription هنوز فعال باشد، زمان اصلی آن حفظ می‌شود و از اول ۳۰ روز حساب نمی‌شود. اگر Subscription واقعاً منقضی شده باشد، ساخت مجدد آن تایمر جدید می‌گیرد.
