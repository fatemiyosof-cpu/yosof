# ARcodm Subscription — Render

این سرویس برای لینک Subscription پنل ARcodm آماده شده است.

## 1) ساخت سرویس روی Render

یک **Web Service** بساز و این پوشه را به عنوان پروژه بده.

- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `Node`

بعد از Deploy، آدرس سرویس را کپی کن، مثلاً:

`https://your-subscription.onrender.com`

## 2) اتصال پنل

در پنل، روی **ساخت / بروزرسانی Subscription** بزن. بار اول آدرس Render را می‌پرسد. همان URL را وارد کن.

پنل کانفیگ‌های همان کاربر را به سرویس می‌فرستد و یک لینک اختصاصی مثل زیر تحویل می‌گیرد:

`https://your-subscription.onrender.com/sub/xxxxxxxx`

یک لینک برای کل کاربر است؛ لوکیشن‌ها داخل همان لینک هستند.

## 3) مهم درباره ذخیره‌سازی

این نسخه برای تست و راه‌اندازی اولیه از فایل JSON استفاده می‌کند. روی سرویس‌های ابری، فایل محلی ممکن است با redeploy/restart از بین برود. برای استفاده پایدار باید بعداً ذخیره‌سازی دائمی (Database یا Persistent Disk) اضافه شود.

## 4) درباره WireGuard

خود اپ رسمی WireGuard استاندارد واحدی برای «Subscription URL» ندارد. این سرویس فعلاً یک Subscription Web Page و API داده ارائه می‌دهد که مشتری می‌تواند از آن لینک، لوکیشن‌ها و فایل‌های `.conf` را دریافت کند. اگر برنامه مشتری از فرمت Subscription خاصی پشتیبانی می‌کند، باید فرمت همان برنامه را مشخص کنیم تا endpoint مخصوص آن اضافه شود.
