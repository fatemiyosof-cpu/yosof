# ARcodm Subscription — REAL TIMER

این نسخه برای Subscription پنل ARcodm آماده شده است.

### چه چیزهایی اصلاح شده؟
- مدت اعتبار از مقدار `Days` ارسالی پنل محاسبه می‌شود و `expiresAt` واقعی هنگام ساخت Subscription ثبت می‌شود.
- صفحه Subscription یک شمارش‌معکوس ثانیه‌ای و پررنگ نشان می‌دهد: `روز HH:MM:SS`.
- بعد از پایان زمان، صفحه Subscription و دانلود `.conf` و ZIP دیگر قابل استفاده نیستند.
- مقدار حجم و مدت، همان مقداری است که پنل هنگام ساخت کانفیگ ارسال می‌کند؛ این سرور «حجم مصرف‌شده واقعی» را اندازه‌گیری نمی‌کند و ادعای محدودیت حجمی ندارد.
- حذف یک کانفیگ در پنل، Subscription را با لوکیشن‌های باقی‌مانده دوباره می‌سازد.
- حذف کامل کاربر، Subscription قبلی را از سرور حذف می‌کند.
- دانلود تکی `.conf` و ZIP حفظ شده است.

### Render
Build Command:
`npm install`

Start Command:
`node server.js`

Health:
`/health`

Subscription:
`/sub/ID`
