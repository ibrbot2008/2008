# استخدم نسخة Node.js مستقرة
FROM node:18

# تحديد مجلد العمل
WORKDIR /usr/src/app

# نسخ ملفات الـ package وتثبيت المكتبات
COPY package*.json ./
RUN npm install

# نسخ كافة ملفات المشروع (بما فيها bot.js و bedrock_client.js)
COPY . .

# إخبار المنصة بالمنفذ الذي سنستخدمه
ENV PORT=7860
EXPOSE 7860

# أمر تشغيل البوت (تأكد أن bot.js هو الملف الأساسي)
CMD ["node", "bot.js"]
