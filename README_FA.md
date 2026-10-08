# ARcodm Subscription — TIMER PRO

پکیج جدید Subscription برای پنل ARcodm.

### امکانات
- تایمر واقعی بر اساس `Days` که پنل هنگام ساخت کاربر می‌فرستد.
- نمایش زمان باقی‌مانده داخل نوار دایره‌ای با کاهش تدریجی نوار.
- نمایش روز، ساعت و شمارش ثانیه‌ای داخل حلقه.
- متن `Premium Subscription` و مربع لوگوی `A` از صفحه حذف شده‌اند.
- فونت و ظاهر Subscription با Lalezar / Orbitron / Vazirmatn و افکت‌های نئون بازطراحی شده است.
- بعد از پایان زمان، Subscription و دانلود `.conf` و ZIP مسدود می‌شوند.
- اگر پنل لوکیشن‌های یک کاربر را دوباره Sync کند، Subscription قبلی به‌روزرسانی می‌شود و تایمر از اول Reset نمی‌شود.
- حذف کامل کاربر، Subscription مربوط به همان کاربر را از سرور حذف می‌کند.
- دانلود تکی `.conf` و ZIP حفظ شده است.
- مقدار «حجم» همان سهمیه‌ای است که پنل تنظیم می‌کند؛ این سرور به‌تنهایی مصرف واقعی ترافیک WireGuard را اندازه‌گیری نمی‌کند.

### Render
Build Command:
`npm install`

Start Command:
`node server.js`

Health:
`/health`

Subscription:
`/sub/ID`
