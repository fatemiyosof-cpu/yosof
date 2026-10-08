# ARcodm Subscription Server 2.0

این پکیج Backend جدید برای پنل ARcodm است.

## نکته مهم درباره ماندگاری اطلاعات

این نسخه Subscriptionها را داخل RAM نگه نمی‌دارد. بهترین حالت برای Render استفاده از PostgreSQL با متغیر `DATABASE_URL` است. فایل‌سیستم عادی Render موقتی است و برای داده دائمی نباید روی آن حساب کرد.

Render در حال حاضر Free Postgres را برای 30 روز ارائه می‌کند؛ برای استفاده دائمی باید یک datastore دائمی مناسب داشته باشی. همچنین Persistent Disk فقط روی سرویس‌های پولی Render قابل اتصال است.

## متغیرهای Environment

- `DATABASE_URL` = آدرس PostgreSQL (توصیه‌شده)
- `PUBLIC_BASE_URL` = آدرس خود Render، مثل `https://your-service.onrender.com`
- `TELEGRAM_URL` = به‌صورت پیش‌فرض https://t.me/ar8codm
- `ADMIN_KEY` = اختیاری؛ برای DELETE API
- `PERSISTENT_DATA_DIR` = فقط وقتی از JSON file storage استفاده می‌کنی؛ پیش‌فرض `/var/data`

## Render Web Service

Build Command:
`npm install`

Start Command:
`npm start`

Health Check Path:
`/health`

## API مورد انتظار پنل

POST `/api/subscriptions`

DELETE `/api/subscriptions/:id`

GET `/api/subscriptions/:id`

GET `/sub/:id`

## تست بعد از Deploy

اول این آدرس را باز کن:
`https://YOUR-SERVICE.onrender.com/health`

باید JSON با `ok: true` ببینی.

بعد از اینکه سرویس Deploy شد، فقط لینک Render را برای سازنده پنل بفرست تا `AR.html` به Backend جدید وصل شود.
