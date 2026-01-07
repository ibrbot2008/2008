const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('bedrock-protocol');
const fs = require('fs');
const path = require('path');
const os = require('os');

// pidusage اختياري (إذا لم يكن مثبتاً لن يتسبب بتوقف البوت)
let pidusage = null;
try {
  pidusage = require('pidusage');
} catch (e) {
  pidusage = null;
}

// ============== [الإعدادات] ==============
const REQUIRED_CHANNEL = -1003499194538; // قناة الاشتراك الإجباري
const botToken = '8198997283:AAHL_yWKazZf3Aa8OluwgjXV2goxtpwNPPQ';// ⚠️ غيّر هذا
const ownerId = 1421302016; // ⚠️ غيّر هذا

// قنوات الاشتراك (قابلة للإدارة من لوحة الأدمن)
const DEFAULT_SUB_CHANNELS = [
  { id: REQUIRED_CHANNEL, url: 'https://t.me/+c7sbwOViyhNmYzAy', title: 'IBR Channel' }
];


const bot = new Telegraf(botToken);

// ============== [تخزين البيانات] ==============
let servers = {};
let users = [];
let clients = {};
let userMeta = {};     // معلومات إضافية (آخر المستخدمين...)
let bannedUsers = [];  // قائمة المحظورين
let admins = [];       // مسؤولين إضافيين (لو احتجت لاحقاً)
let subChannels = [];  // قنوات الاشتراك الإجباري
let settings = { forceSubscription: true };
const DATA_DIR = './data';

// ============== [حالات لوحة الأدمن - بدون تغيير نظام البوت الأساسي] ==============
const pendingBroadcast = new Map();   // ownerId => true
const pendingUserAction = new Map();  // ownerId => { action: 'ban'|'unban'|'info', promptMsgId?: number }
const pendingAdminAction = new Map(); // ownerId => { action: 'add'|'remove' }
const pendingSubAction = new Map();   // ownerId => { action: 'add' }

// ============== [خريطة الإصدارات الذكية - محدثة] ==============
const PROTOCOL_MAP = {
  // إصدارات حديثة جداً (محدثة يدوياً)
  '1.21.140': 880, '1.21.139': 879, '1.21.138': 878, '1.21.137': 877,
  '1.21.136': 876, '1.21.135': 875, '1.21.134': 874, '1.21.133': 873,
  '1.21.132': 872, '1.21.131': 871,
  '1.21.130': 870,

  // بقية الإصدارات كما هي...
  '1.21.124.2': 860, '1.21.124': 860, '1.21.123': 859,
  '1.21.120': 859, '1.21.111': 844, '1.21.100': 827,
  '1.21.93': 819, '1.21.90': 818, '1.21.80': 800,
  '1.21.72': 786, '1.21.70': 786, '1.21.60': 776,
  '1.21.50': 766, '1.21.42': 748, '1.21.30': 729,
  '1.21.20': 712, '1.21.2': 686, '1.21.0': 685,

  // إصدارات سابقة
  '1.20.80': 671, '1.20.71': 662, '1.20.61': 649,
  '1.20.50': 630, '1.20.40': 622, '1.20.30': 618,
  '1.20.15': 594, '1.20.10': 594, '1.20.0': 589,
  '1.19.80': 582, '1.19.70': 575, '1.19.63': 568,
  '1.19.62': 567, '1.19.60': 567, '1.19.50': 560,
  '1.19.40': 557, '1.19.30': 554, '1.19.21': 545,
  '1.19.20': 544, '1.19.10': 534, '1.19.1': 527
};

// دالة للحصول على أقرب إصدار مدعوم
function getClosestVersion(requestedVersion) {
  if (PROTOCOL_MAP[requestedVersion]) {
    return requestedVersion;
  }

  const parts = requestedVersion.split('.').map(Number);
  const [major, minor, patch] = parts;

  for (let p = patch; p >= 0; p--) {
    const testVersion = `${major}.${minor}.${p}`;
    if (PROTOCOL_MAP[testVersion]) return testVersion;
  }

  for (let m = minor - 1; m >= 0; m--) {
    for (let p = 200; p >= 0; p--) {
      const testVersion = `${major}.${m}.${p}`;
      if (PROTOCOL_MAP[testVersion]) return testVersion;
    }
  }

  return '1.21.124'; // افتراضي
}

// ============== [وظائف الملفات] ==============
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function loadData() {
  try {
    ensureDataDir();

    const serversPath = path.join(DATA_DIR, 'servers.json');
    const usersPath = path.join(DATA_DIR, 'users.json');
    const metaPath = path.join(DATA_DIR, 'users_meta.json');
    const bannedPath = path.join(DATA_DIR, 'banned.json');
    const adminsPath = path.join(DATA_DIR, 'admins.json');
    const subChannelsPath = path.join(DATA_DIR, 'sub_channels.json');
    const settingsPath = path.join(DATA_DIR, 'settings.json');

    servers = safeReadJSON(serversPath, {});
    users = safeReadJSON(usersPath, []);
    userMeta = safeReadJSON(metaPath, {});
    bannedUsers = safeReadJSON(bannedPath, []);
    admins = safeReadJSON(adminsPath, []);
    subChannels = safeReadJSON(subChannelsPath, DEFAULT_SUB_CHANNELS);
    settings = safeReadJSON(settingsPath, { forceSubscription: true });

    // نظافة بيانات القنوات
    if (!Array.isArray(subChannels)) subChannels = DEFAULT_SUB_CHANNELS;
    subChannels = subChannels
      .filter(ch => ch && (typeof ch.id === 'string' || typeof ch.id === 'number'))
      .map(ch => ({ id: ch.id, url: ch.url || '', title: ch.title || '' }));

    // تأكد من شكل settings
    if (!settings || typeof settings !== 'object') settings = { forceSubscription: true };
    if (typeof settings.forceSubscription !== 'boolean') settings.forceSubscription = true;

    // تأكد أن المالك موجود كأدمن (للاستخدام لاحقاً لو وسّعت الصلاحيات)
    if (!admins.includes(ownerId)) admins.unshift(ownerId);

  } catch (error) {
    console.log('📂 لا توجد بيانات سابقة أو خطأ في التحميل');
  }
}

function saveServers() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'servers.json'), JSON.stringify(servers, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ السيرفرات');
  }
}

function saveUsers() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ المستخدمين');
  }
}

function saveUserMeta() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'users_meta.json'), JSON.stringify(userMeta, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ بيانات المستخدمين الإضافية');
  }
}

function saveBans() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'banned.json'), JSON.stringify(bannedUsers, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ قائمة الحظر');
  }
}

function saveAdmins() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'admins.json'), JSON.stringify(admins, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ قائمة المسؤولين');
  }
}


function saveSubChannels() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'sub_channels.json'), JSON.stringify(subChannels, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ قنوات الاشتراك');
  }
}

function saveSettings() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.log('❌ خطأ في حفظ الإعدادات');
  }
}

// ============== [فحص الاشتراك] ==============

async function checkSubscription(ctx) {
  try {
    // المالك يتجاوز الاشتراك
    if (ctx?.from?.id === ownerId) return true;
    if (!settings?.forceSubscription) return true;

    if (!Array.isArray(subChannels) || subChannels.length === 0) return true;

    for (const ch of subChannels) {
      const chatId = ch.id;
      const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      const ok = ['member', 'creator', 'administrator'].includes(member.status);
      if (!ok) return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

function buildSubscriptionKeyboard() {
  const rows = [];
  for (const ch of (subChannels || [])) {
    const title = ch.title?.trim() || (typeof ch.id === 'string' ? ch.id : 'Channel');
    const url = ch.url?.trim() || (typeof ch.id === 'string' && ch.id.startsWith('@') ? `https://t.me/${ch.id.replace('@','')}` : '');
    if (url) rows.push([Markup.button.url(`📌 اشترك: ${title}`, url)]);
  }
  rows.push([Markup.button.callback('🔍 تحقق من الاشتراك', 'check_sub')]);
  return Markup.inlineKeyboard(rows);
}

function buildVersionKeyboard(isOwnerUser) {
  const rows = [
    [Markup.button.callback('✨NEW 1.21.131', 'ver_1.21.131')],
    [Markup.button.callback('🚀 1.21.130', 'ver_1.21.130')],
    [Markup.button.callback('✅ 1.21.124', 'ver_1.21.124')],
    [Markup.button.callback('1.21.123', 'ver_1.21.123')],
    [Markup.button.callback('1.21.120', 'ver_1.21.120')],
    [Markup.button.callback('1.21.100', 'ver_1.21.100')],
    [Markup.button.callback('1.21.93', 'ver_1.21.93')],
    [Markup.button.callback('1.21.84', 'ver_1.21.84')],
    [Markup.button.callback('1.21.80', 'ver_1.21.80')],
    [Markup.button.callback('المزيد ⬇️', 'more_versions')]
  ];
  if (isOwnerUser) rows.push([Markup.button.callback('🛠 لوحة الأدمن', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

async function showMainMenu(ctx) {
  const isOwnerUser = ctx?.from?.id === ownerId;
  return ctx.reply('🎮 أهلاً بك في بوت Minecraft by IBR!\n\nاختر إصدار اللعبة:', {
    parse_mode: 'Markdown',
    ...buildVersionKeyboard(isOwnerUser)
  });
}



// ============== [مساعدات لوحة الأدمن] ==============
function isOwner(ctx) {
  return ctx?.from?.id === ownerId;
}

async function safeAnswerCbQuery(ctx, text, opts = {}) {
  try {
    if (ctx?.callbackQuery) {
      await ctx.answerCbQuery(text, opts);
    }
  } catch (e) { /* ignore */ }
}

async function safeEditOrReply(ctx, text, extra = {}) {
  // ملاحظة: كثير من الأزرار قد تفشل بسبب Markdown إذا كانت البيانات تحتوي رموز خاصة.
  // لذلك نحاول أولاً بالخيارات الأصلية، ثم نعيد المحاولة بدون parse_mode لضمان أن كل زر "يرد" دائماً.
  const extraPlain = { ...(extra || {}) };
  if (extraPlain && Object.prototype.hasOwnProperty.call(extraPlain, 'parse_mode')) {
    delete extraPlain.parse_mode;
  }

  // 1) حاول تعديل الرسالة (في حال callback)
  if (ctx?.callbackQuery) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (e1) {
      try {
        await ctx.editMessageText(text, extraPlain);
        return;
      } catch (e2) {
        // سنحاول إرسال رسالة جديدة
      }
    }
  }

  // 2) حاول الرد برسالة جديدة
  try {
    await ctx.reply(text, extra);
  } catch (e3) {
    try {
      await ctx.reply(text, extraPlain);
    } catch (e4) { /* ignore */ }
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return `${num.toFixed(2)} ${units[i]}`;
}


async function renderAdminPanel(ctx) {
  const totalUsers = users.length;
  const totalServers = Object.keys(servers).filter(uid => servers[uid]?.ip).length;
  const activeBots = Object.keys(clients).length;

  const text =
    `🛠️ *لوحة تحكم المالك*\n\n` +
    `📊 *إحصائيات مباشرة:*\n` +
    `👥 المستخدمين: *${totalUsers}*\n` +
    `🌐 السيرفرات: *${totalServers}*\n` +
    `🤖 البوتات النشطة: *${activeBots}*\n\n` +
    `اختر إجراء من الأزرار بالأسفل:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📢 إذاعة للكل', 'admin_broadcast')],
    [Markup.button.callback('📊 الإحصائيات (تفصيل)', 'admin_stats')],
    [Markup.button.callback('👤 إدارة المستخدمين', 'admin_users')],
    [Markup.button.callback('📋 قائمة جميع المستخدمين', 'admin_all_users:1')],
    [Markup.button.callback('🖥️ عرض كل السيرفرات', 'admin_all_servers:1')],
    [Markup.button.callback('📌 إدارة قنوات الاشتراك', 'admin_sub_channels')],
    [Markup.button.callback('🔑 إدارة المسؤولين', 'admin_manage_admins')],
    [Markup.button.callback('⚙️ الإعدادات', 'admin_settings')],
    [Markup.button.callback('🖥️ حالة النظام', 'admin_system')],
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
}



// ============== [Middleware: منع المحظورين] ==============
bot.use(async (ctx, next) => {
  try {
    const uid = ctx?.from?.id;
    if (!uid) return next();
    if (uid === ownerId) return next();

    if (bannedUsers.includes(uid)) {
      // لا نزعج المستخدم بكثرة، فقط تجاهل أو أعطه رسالة واحدة في /start
      if (ctx?.message?.text === '/start') {
        try { await ctx.reply('🚫 تم حظرك من استخدام البوت.'); } catch (e) { /* ignore */ }
      }
      return;
    }
  } catch (e) { /* ignore */ }
  return next();
});

// ============== [نظام منع النسخ المتعددة] ==============
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 استقبال إشارة ${signal}...`);

  console.log('🛑 إيقاف اتصالات ماينكرافت...');
  Object.keys(clients).forEach(key => {
    try {
      clients[key].end();
      console.log(`✓ تم إيقاف: ${key}`);
    } catch (err) {}
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('🛑 إيقاف بوت تلغرام...');
  try {
    await bot.stop(signal);
    console.log('✅ تم إيقاف البوت بنجاح');
  } catch (err) {
    console.error('❌ خطأ في إيقاف البوت:', err.message);
  }

  process.exit(0);
}

// ============== [الاتصال الذكي] ==============
// ============== [إصلاح دالة smartConnect لمنع التوقف] ==============
async function smartConnect(ip, port, requestedVersion, userId, botName = 'IBR_Bot') {
  try {
    const versionsToTry = [];
    const closestVersion = getClosestVersion(requestedVersion);

    versionsToTry.push(requestedVersion);

    if (requestedVersion !== closestVersion) {
      versionsToTry.push(closestVersion);
    }

    const commonVersions = ['1.21.124', '1.21.100', '1.21.80'];
    commonVersions.forEach(v => {
      if (!versionsToTry.includes(v) && PROTOCOL_MAP[v]) {
        versionsToTry.push(v);
      }
    });

    console.log(`🔄 محاولة الإصدارات: ${versionsToTry.join(', ')}`);

    let lastError = null;

    for (const version of versionsToTry) {
      const protocol = PROTOCOL_MAP[version];
      if (!protocol) continue;

      try {
        console.log(`🔗 محاولة ${version} (بروتوكول: ${protocol})`);

        const client = createClient({
          host: ip,
          port: port,
          username: botName,
          version: version,
          offline: true,
          connectTimeout: 10000,
          protocolVersion: protocol,
          skipPing: false,
          raknetBackoff: true
        });

        const connectionResult = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { client.end(); } catch (e) {}
            resolve({ success: false, error: 'انتهت مهلة الاتصال' });
          }, 10000);

          client.once('join', () => {
            clearTimeout(timeout);
            resolve({ success: true, client });
          });

          client.once('error', (err) => {
            clearTimeout(timeout);
            try { client.end(); } catch (e) {}
            resolve({ success: false, error: err.message });
          });

          client.once('disconnect', () => {
            clearTimeout(timeout);
            try { client.end(); } catch (e) {}
            resolve({ success: false, error: 'انقطع الاتصال' });
          });
        });

        if (connectionResult.success) {
          return {
            success: true,
            client: connectionResult.client,
            versionUsed: version,
            protocolUsed: protocol,
            requestedVersion,
            message: version === requestedVersion ?
              `✅ تم الاتصال بالإصدار ${version}` :
              `✅ تم الاتصال بالإصدار ${version} (بديل عن ${requestedVersion})`
          };
        } else {
          lastError = connectionResult.error;
          console.log(`❌ فشل ${version}: ${connectionResult.error}`);
        }

      } catch (error) {
        lastError = error.message;
        console.log(`💥 خطأ في محاولة ${version}: ${error.message}`);
        continue;
      }
    }

    return {
      success: false,
      error: lastError || 'فشل جميع المحاولات',
      requestedVersion
    };

  } catch (error) {
    console.error(`🔥 خطأ محتوى في smartConnect: ${error.message}`);
    return {
      success: false,
      error: 'حدث خطأ داخلي',
      requestedVersion
    };
  }
}

// ============== [تحميل البيانات] ==============
loadData();

// ============== [أوامر لوحة الأدمن] ==============
bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) return;
  await renderAdminPanel(ctx);
});

bot.action('admin_panel', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await renderAdminPanel(ctx);
});

// الإحصائيات التفصيلية
bot.action('admin_stats', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  const totalUsers = users.length;
  const totalServers = Object.keys(servers).filter(uid => servers[uid]?.ip).length;
  const activeBots = Object.keys(clients).length;
  const banned = bannedUsers.length;

  const uptimeSec = Math.floor(process.uptime());
  const uptime = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

  const text =
    `📊 *إحصائيات البوت (تفصيل)*\n\n` +
    `👥 إجمالي المستخدمين: *${totalUsers}*\n` +
    `🚫 المحظورون: *${banned}*\n` +
    `🌐 السيرفرات المحفوظة: *${totalServers}*\n` +
    `🤖 البوتات النشطة: *${activeBots}*\n` +
    `⏱️ مدة التشغيل: *${uptime}*\n` +
    `📀 الإصدارات المدعومة: *${Object.keys(PROTOCOL_MAP).length}*`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'admin_stats')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')],
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

// ===== البث =====
bot.action('admin_broadcast', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  pendingBroadcast.set(ownerId, true);

  const text =
    `📢 *إذاعة للكل*\n\n` +
    `أرسل الآن نص الرسالة التي تريد إرسالها لكل المستخدمين.\n` +
    `عدد المستلمين: *${users.length}*\n\n` +
    `لإلغاء العملية اضغط:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_broadcast_cancel')],
    [Markup.button.callback('🔙 رجوع للوحة', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_broadcast_cancel', async (ctx) => {
  if (!isOwner(ctx)) return;
  pendingBroadcast.delete(ownerId);
  await safeAnswerCbQuery(ctx, 'تم الإلغاء ✅', { show_alert: false });
  await renderAdminPanel(ctx);
});

// ===== إدارة المستخدمين =====
bot.action('admin_users', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  const text =
    `👤 *إدارة المستخدمين*\n\n` +
    `اختر الإجراء:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🆕 آخر المستخدمين', 'admin_last_users')],
    [Markup.button.callback('📋 قائمة جميع المستخدمين', 'admin_all_users:1')],
    [Markup.button.callback('🚫 حظر مستخدم', 'user_action:ban'), Markup.button.callback('✅ رفع الحظر', 'user_action:unban')],
    [Markup.button.callback('ℹ️ معلومات مستخدم', 'user_action:info')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_last_users', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  const list = Object.entries(userMeta)
    .map(([id, meta]) => ({ id: Number(id), ...meta }))
    .sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0))
    .slice(0, 15);

  let msg = `🆕 *آخر المستخدمين (15)*\n\n`;
  if (list.length === 0) {
    msg += 'لا توجد بيانات إضافية بعد.';
  } else {
    for (const u of list) {
      const name = u.first_name || 'بدون اسم';
      const username = u.username ? `@${u.username}` : 'بدون معرف';
      const date = u.joinedAt ? new Date(u.joinedAt).toLocaleString() : 'غير معروف';
      const banned = bannedUsers.includes(u.id) ? '🚫' : '✅';
      msg += `${banned} *${name}* (${username})\n`;
      msg += `🆔 ${u.id}\n`;
      msg += `📅 ${date}\n`;
      msg += `────────────\n`;
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'admin_last_users')],
    [Markup.button.callback('🔙 رجوع', 'admin_users')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/user_action:(ban|unban|info)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  const action = ctx.match[1];
  pendingUserAction.set(ownerId, { action });

  let title = '';
  if (action === 'ban') title = '🚫 حظر مستخدم';
  if (action === 'unban') title = '✅ رفع الحظر';
  if (action === 'info') title = 'ℹ️ معلومات مستخدم';

  const text =
    `${title}\n\n` +
    `أرسل الآن *ID المستخدم* في رسالة واحدة.\n\n` +
    `لإلغاء العملية اضغط:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_user_action_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_users')]
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_user_action_cancel', async (ctx) => {
  if (!isOwner(ctx)) return;
  pendingUserAction.delete(ownerId);
  await safeAnswerCbQuery(ctx, 'تم الإلغاء ✅');
  await renderAdminPanel(ctx);
});

// ===== عرض كل السيرفرات (تجميعي) =====
function buildAllServersList() {
  const list = [];
  for (const uidStr of Object.keys(servers)) {
    const uid = Number(uidStr);
    const s = servers[uidStr];
    if (!s || !s.ip || !s.port) continue;

    const version = s.version || 'غير محدد';
    const activeForUser = Object.keys(clients).some(k => k.startsWith(uid + '_'));
    list.push({
      userId: uid,
      ip: s.ip,
      port: s.port,
      version,
      active: activeForUser
    });
  }
  return list;
}

async function showAllServersPage(ctx, page = 1) {
  const perPage = 10;
  const list = buildAllServersList();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const start = (safePage - 1) * perPage;
  const slice = list.slice(start, start + perPage);

  let msg = `🖥️ *كل السيرفرات* (صفحة ${safePage}/${totalPages})\n`;
  msg += `إجمالي: *${total}*\n\n`;

  if (slice.length === 0) {
    msg += 'لا توجد سيرفرات محفوظة.';
  } else {
    slice.forEach((s, idx) => {
      const icon = s.active ? '🟢' : '🔴';
      msg += `${start + idx + 1}. ${icon} ${s.ip}:${s.port}\n`;
      msg += `   📀 ${s.version}\n`;
      msg += `   👤 ${s.userId}\n`;
    });
  }

  const navRow = [];
  if (safePage > 1) navRow.push(Markup.button.callback('⬅️ السابق', `admin_all_servers:${safePage - 1}`));
  if (safePage < totalPages) navRow.push(Markup.button.callback('التالي ➡️', `admin_all_servers:${safePage + 1}`));

  const keyboard = Markup.inlineKeyboard([
    ...(navRow.length ? [navRow] : []),
    [Markup.button.callback('🔄 تحديث', `admin_all_servers:${safePage}`)],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')],
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
}

bot.action(/admin_all_servers:(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  const page = parseInt(ctx.match[1], 10) || 1;
  await showAllServersPage(ctx, page);
});

// ===== إدارة المسؤولين / الإعدادات =====

bot.action('admin_manage_admins', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  const uniqueAdmins = Array.from(new Set(admins)).filter(x => typeof x === 'number' && !Number.isNaN(x));
  if (!uniqueAdmins.includes(ownerId)) uniqueAdmins.unshift(ownerId);

  let msg = `🔑 *إدارة المسؤولين*\n\n`;
  msg += `• المالك: *${ownerId}*\n\n`;

  msg += `👑 *قائمة المسؤولين الإضافيين:*\n`;
  const others = uniqueAdmins.filter(x => x !== ownerId);
  if (others.length === 0) msg += `— لا يوجد مسؤولين إضافيين.\n`;
  else msg += others.map((id, i) => `${i + 1}. ${id}`).join('\n') + '\n';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة مسؤول', 'admin_admins_add'), Markup.button.callback('➖ إزالة مسؤول', 'admin_admins_remove')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_admins_add', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  pendingAdminAction.set(ownerId, { action: 'add' });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_admins_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_manage_admins')]
  ]);

  await safeEditOrReply(ctx, '➕ *إضافة مسؤول*\n\nأرسل الآن ID المسؤول الذي تريد إضافته.', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_admins_remove', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  pendingAdminAction.set(ownerId, { action: 'remove' });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_admins_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_manage_admins')]
  ]);

  await safeEditOrReply(ctx, '➖ *إزالة مسؤول*\n\nأرسل الآن ID المسؤول الذي تريد إزالته.', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_admins_cancel', async (ctx) => {
  if (!isOwner(ctx)) return;
  pendingAdminAction.delete(ownerId);
  await safeAnswerCbQuery(ctx, 'تم الإلغاء ✅');
  await renderAdminPanel(ctx);
});

// ===== حالة النظام =====
bot.action('admin_system', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });

  const t0 = Date.now();
  await safeAnswerCbQuery(ctx);

  const uptimeSec = Math.floor(process.uptime());
  const uptime = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

  const mem = process.memoryUsage();
  const nodeRss = mem.rss || 0;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg ? os.loadavg() : [0, 0, 0];

  let cpuText = '';
  let memText = '';

  if (pidusage) {
    try {
      const stats = await pidusage(process.pid);
      cpuText = `• CPU: *${stats.cpu.toFixed(1)}%*\n`;
      memText = `• RAM (process): *${formatBytes(stats.memory)}*\n`;
    } catch (e) {
      cpuText = '';
      memText = `• RAM (process): *${formatBytes(nodeRss)}*\n`;
    }
  } else {
    memText = `• RAM (process): *${formatBytes(nodeRss)}*\n`;
  }

  const ping = Date.now() - t0;

  const msg =
    `🖥️ *حالة النظام*\n\n` +
    `⏱️ Ping: *${ping}ms*\n` +
    `⏳ Uptime: *${uptime}*\n` +
    cpuText +
    memText +
    `• RAM (system): *${formatBytes(totalMem - freeMem)} / ${formatBytes(totalMem)}*\n` +
    `• Load: *${load.map(x => x.toFixed(2)).join(' / ')}*\n` +
    `• Node: \`${process.version}\``;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'admin_system')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
});

// ===================== [لوحة الأدمن: الإعدادات + قنوات الاشتراك + قائمة المستخدمين] =====================

// ---- الإعدادات ----
async function renderSettingsPanel(ctx) {
  const forceSub = !!settings?.forceSubscription;
  const chCount = Array.isArray(subChannels) ? subChannels.length : 0;

  const msg =
    `⚙️ *الإعدادات*\n\n` +
    `🔒 الاشتراك الإجباري: *${forceSub ? 'مفعل ✅' : 'موقوف ❌'}*\n` +
    `📌 قنوات الاشتراك: *${chCount}*\n\n` +
    `اختر من الأزرار:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(forceSub ? '🔓 تعطيل الاشتراك الإجباري' : '🔒 تفعيل الاشتراك الإجباري', 'settings_toggle_force')],
    [Markup.button.callback('📌 إدارة قنوات الاشتراك', 'admin_sub_channels:1')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
}

bot.action('admin_settings', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await renderSettingsPanel(ctx);
});

bot.action('settings_toggle_force', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  settings.forceSubscription = !settings.forceSubscription;
  saveSettings();
  await safeAnswerCbQuery(ctx, '✅ تم الحفظ');
  await renderSettingsPanel(ctx);
});

// ---- قائمة جميع المستخدمين (Pagination) ----
function buildAllUsersList() {
  const set = new Set(Array.isArray(users) ? users : []);
  // اجمع أي مستخدم موجود في meta أو servers
  Object.keys(userMeta || {}).forEach(id => set.add(Number(id)));
  Object.keys(servers || {}).forEach(id => set.add(Number(id)));

  const list = Array.from(set)
    .filter(id => typeof id === 'number' && !Number.isNaN(id))
    .map(id => {
      const meta = userMeta?.[String(id)] || {};
      const hasServer = !!(servers?.[String(id)]?.ip || servers?.[id]?.ip);
      const isBanned = bannedUsers.includes(id);
      return {
        id,
        name: meta.first_name || '',
        username: meta.username || '',
        joinedAt: meta.joinedAt || null,
        hasServer,
        isBanned
      };
    });

  // الأحدث أولاً حسب joinedAt (وإن لم يوجد، حسب ID تنازلياً)
  list.sort((a, b) => {
    const da = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
    const db = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
    if (da !== db) return db - da;
    return b.id - a.id;
  });

  return list;
}

async function showAllUsersPage(ctx, page = 1) {
  const perPage = 12;
  const list = buildAllUsersList();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const start = (safePage - 1) * perPage;
  const slice = list.slice(start, start + perPage);

  let msg = `📋 *قائمة جميع المستخدمين* (صفحة ${safePage}/${totalPages})\n`;
  msg += `إجمالي: *${total}*\n\n`;

  if (slice.length === 0) {
    msg += 'لا يوجد مستخدمون.';
  } else {
    slice.forEach((u, idx) => {
      const banned = u.isBanned ? '🚫' : '✅';
      const hasSrv = u.hasServer ? '🌐' : '—';
      const name = u.name ? ` ${u.name}` : '';
      const uname = u.username ? ` @${u.username}` : '';
      msg += `${start + idx + 1}. ${banned} ${hasSrv} *${u.id}*${name}${uname}\n`;
    });
  }

  const navRow = [];
  if (safePage > 1) navRow.push(Markup.button.callback('⬅️ السابق', `admin_all_users:${safePage - 1}`));
  if (safePage < totalPages) navRow.push(Markup.button.callback('التالي ➡️', `admin_all_users:${safePage + 1}`));

  const keyboard = Markup.inlineKeyboard([
    ...(navRow.length ? [navRow] : []),
    [Markup.button.callback('🔄 تحديث', `admin_all_users:${safePage}`)],
    [Markup.button.callback('👤 إدارة المستخدمين', 'admin_users')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
}

bot.action('admin_all_users', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await showAllUsersPage(ctx, 1);
});

bot.action(/admin_all_users:(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  const page = parseInt(ctx.match[1], 10) || 1;
  await showAllUsersPage(ctx, page);
});

// ---- عرض كل السيرفرات (Fallback بدون رقم صفحة) ----
bot.action('admin_all_servers', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await showAllServersPage(ctx, 1);
});

// ---- إدارة قنوات الاشتراك (Pagination + إضافة + حذف) ----
function normalizeSubChannels() {
  if (!Array.isArray(subChannels)) subChannels = [];
  subChannels = subChannels.filter(ch => ch && (typeof ch.id === 'string' || typeof ch.id === 'number'))
    .map(ch => ({
      id: typeof ch.id === 'string' ? ch.id.trim() : ch.id,
      url: (ch.url || '').trim(),
      title: (ch.title || '').trim()
    }));
}

async function showSubChannelsPage(ctx, page = 1) {
  normalizeSubChannels();
  const perPage = 5;
  const total = subChannels.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const start = (safePage - 1) * perPage;
  const slice = subChannels.slice(start, start + perPage);

  let msg = `📌 *إدارة قنوات الاشتراك* (صفحة ${safePage}/${totalPages})\n`;
  msg += `إجمالي القنوات: *${total}*\n\n`;
  msg += `ملاحظة: التحقق من الاشتراك يحتاج *ID رقمي -100...* أو *@username*.\n\n`;

  if (slice.length === 0) {
    msg += 'لا توجد قنوات.\n';
  } else {
    slice.forEach((ch, idx) => {
      const num = start + idx;
      const title = ch.title || 'بدون اسم';
      msg += `${num + 1}. *${title}*\n`;
      msg += `   • ID: \`${String(ch.id)}\`\n`;
      if (ch.url) msg += `   • Link: ${ch.url}\n`;
    });
  }

  const navRow = [];
  if (safePage > 1) navRow.push(Markup.button.callback('⬅️ السابق', `admin_sub_channels:${safePage - 1}`));
  if (safePage < totalPages) navRow.push(Markup.button.callback('التالي ➡️', `admin_sub_channels:${safePage + 1}`));

  // أزرار حذف لكل قناة في الصفحة الحالية
  const delRows = slice.map((ch, idx) => {
    const globalIndex = start + idx;
    const label = ch.title ? `🗑️ حذف: ${ch.title}` : `🗑️ حذف #${globalIndex + 1}`;
    return [Markup.button.callback(label.slice(0, 60), `sub_del:${globalIndex}:${safePage}`)];
  });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة قناة', 'sub_add')],
    ...delRows,
    ...(navRow.length ? [navRow] : []),
    [Markup.button.callback('🔄 تحديث', `admin_sub_channels:${safePage}`)],
    [Markup.button.callback('⚙️ الإعدادات', 'admin_settings')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
}

bot.action('admin_sub_channels', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await showSubChannelsPage(ctx, 1);
});

bot.action(/admin_sub_channels:(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  const page = parseInt(ctx.match[1], 10) || 1;
  await showSubChannelsPage(ctx, page);
});

bot.action('sub_add', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  pendingSubAction.set(ownerId, { action: 'add' });

  const msg =
    `➕ *إضافة قناة اشتراك*\n\n` +
    `أرسل رسالة واحدة بهذه الصيغة:\n` +
    `\n` +
    `\`-1001234567890 | https://t.me/+InviteLink | اسم القناة\`\n` +
    `أو\n` +
    `\`@channelusername | https://t.me/channelusername | اسم القناة\`\n\n` +
    `مهم: لازم يكون البوت قادر يعمل getChatMember على القناة.`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'sub_add_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_sub_channels:1')]
  ]);

  await safeEditOrReply(ctx, msg, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('sub_add_cancel', async (ctx) => {
  if (!isOwner(ctx)) return;
  pendingSubAction.delete(ownerId);
  await safeAnswerCbQuery(ctx, 'تم الإلغاء ✅');
  await showSubChannelsPage(ctx, 1);
});

bot.action(/sub_del:(\d+):(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);

  normalizeSubChannels();
  const index = parseInt(ctx.match[1], 10);
  const backPage = parseInt(ctx.match[2], 10) || 1;

  if (Number.isNaN(index) || index < 0 || index >= subChannels.length) {
    await safeAnswerCbQuery(ctx, '❌ عنصر غير موجود', { show_alert: true });
    return showSubChannelsPage(ctx, backPage);
  }

  const removed = subChannels.splice(index, 1)[0];
  saveSubChannels();

  await safeAnswerCbQuery(ctx, `✅ تم حذف: ${removed?.title || removed?.id || 'القناة'}`);
  // إعادة عرض الصفحة مع تصحيح الرقم لو نقصت الصفحات
  const totalPages = Math.max(1, Math.ceil(subChannels.length / 5));
  const newPage = Math.min(backPage, totalPages);
  await showSubChannelsPage(ctx, newPage);
});


// ============== [أوامر البوت] ==============

// بداية البوت

bot.start(async (ctx) => {
  const isSub = await checkSubscription(ctx);

  if (!isSub) {
    const list = (subChannels || []).map((ch, i) => {
      const title = ch.title?.trim() || (typeof ch.id === 'string' ? ch.id : `Channel ${i + 1}`);
      return `• ${title}`;
    }).join('\n') || '• IBR Channel';

    return ctx.reply(
      `🔒 للوصول إلى البوت يجب الاشتراك في القنوات التالية:\n${list}\n\nبعد الاشتراك اضغط /start أو زر التحقق`,
      buildSubscriptionKeyboard()
    );
  }

  const user = ctx.from;
  const userId = user.id;

  if (!users.includes(userId)) {
    users.push(userId);
    saveUsers();

    userMeta[String(userId)] = {
      first_name: user.first_name || '',
      username: user.username || '',
      joinedAt: new Date().toISOString()
    };
    saveUserMeta();

    try {
      await bot.telegram.sendMessage(ownerId,
        `👤 مستخدم جديد\n` +
        `الاسم: ${user.first_name}\n` +
        `المعرف: @${user.username || 'لا يوجد'}\n` +
        `ID: ${userId}\n` +
        `المجموع: ${users.length}`
      );
    } catch (err) {}
  } else {
    if (!userMeta[String(userId)]) {
      userMeta[String(userId)] = { first_name: user.first_name || '', username: user.username || '', joinedAt: new Date().toISOString() };
      saveUserMeta();
    }
  }

  return showMainMenu(ctx);
});



// المزيد من الإصدارات
bot.action('more_versions', (ctx) => {
  ctx.editMessageText('🎮 اختر إصدار اللعبة:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('1.21.72', 'ver_1.21.72')],
      [Markup.button.callback('1.21.50', 'ver_1.21.50')],
      [Markup.button.callback('1.21.0', 'ver_1.21.0')],
      [Markup.button.callback('1.20.80', 'ver_1.20.80')],
      [Markup.button.callback('1.20.50', 'ver_1.20.50')],
      [Markup.button.callback('1.20.0', 'ver_1.20.0')],
      [Markup.button.callback('1.19.80', 'ver_1.19.80')],
      [Markup.button.callback('العودة ⬆️', 'back_versions')]
    ])
  });
});

bot.action('back_versions', (ctx) => {
  ctx.editMessageText('🎮 اختر إصدار اللعبة:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✨NEW 1.21.131', 'ver_1.21.131')],
      [Markup.button.callback('🚀 1.21.130', 'ver_1.21.130')],
      [Markup.button.callback('✅ 1.21.124', 'ver_1.21.124')],
      [Markup.button.callback('1.21.123', 'ver_1.21.123')],
      [Markup.button.callback('1.21.120', 'ver_1.21.120')],
      [Markup.button.callback('1.21.100', 'ver_1.21.100')],
      [Markup.button.callback('1.21.93', 'ver_1.21.93')],
      [Markup.button.callback('1.21.84', 'ver_1.21.84')],
      [Markup.button.callback('1.21.80', 'ver_1.21.80')],
      [Markup.button.callback('المزيد ⬇️', 'more_versions')]
    ])
  });
});

// زر التحقق من الاشتراك

bot.action('check_sub', async (ctx) => {
  const isSub = await checkSubscription(ctx);

  if (!isSub) {
    return ctx.answerCbQuery('❌ لم تشترك بعد!', { show_alert: true });
  }

  await ctx.answerCbQuery('✅ تم التحقق بنجاح!', { show_alert: true });
  try { await ctx.deleteMessage(); } catch (e) {}
  return showMainMenu(ctx);
});



// اختيار الإصدار
bot.action(/ver_(.+)/, (ctx) => {
  const version = ctx.match[1];
  const userId = ctx.from.id;

  ctx.answerCbQuery(`✅ تم اختيار ${version}`);

  servers[userId] = servers[userId] || {};
  servers[userId].version = version;
  saveServers();

  ctx.reply(`✅ الإصدار: ${version}\n\n📥 أرسل IP السيرفر وPort:\nمثال:\nplay.server.com:19132`);
});

// ============== [دالة آمنة للمعالجة التلقائية] ==============
let isProcessing = false;

async function safeAsyncOperation(operation, errorMessage = 'حدث خطأ') {
  if (isProcessing) {
    return { success: false, error: 'جاري معالجة طلب آخر' };
  }

  isProcessing = true;
  try {
    return await operation();
  } catch (error) {
    console.error(`🚨 خطأ محتوى: ${error.message}`);
    return { success: false, error: errorMessage };
  } finally {
    isProcessing = false;
  }
}

// استقبال النصوص (IP:PORT + مدخلات لوحة الأدمن)
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;

  if (text.startsWith('/')) return;

  // ===== أولوية: أوضاع لوحة الأدمن (للـ owner فقط) =====
  if (userId === ownerId) {
    // 1) بث
    if (pendingBroadcast.get(ownerId)) {
      pendingBroadcast.delete(ownerId);

      const message = text.trim();
      if (!message) {
        return ctx.reply('❌ الرسالة فارغة.');
      }

      await ctx.reply(`📢 إرسال لـ ${users.length} مستخدم...`);

      let sent = 0;
      for (const uid of users) {
        try {
          await bot.telegram.sendMessage(uid, `📢 إشعار:\n\n${message}`);
          sent++;
        } catch (err) { /* ignore */ }
      }

      await ctx.reply(`✅ تم الإرسال لـ ${sent}/${users.length} مستخدم`);
      return;
    }

    // 2) إدارة مستخدم (حظر/رفع/معلومات)
    const ua = pendingUserAction.get(ownerId);
    if (ua) {
      const targetId = parseInt(text.trim(), 10);
      if (Number.isNaN(targetId)) {
        return ctx.reply('❌ ID غير صحيح. أرسل رقم فقط.');
      }

      pendingUserAction.delete(ownerId);

      if (ua.action === 'ban') {
        if (!bannedUsers.includes(targetId)) {
          bannedUsers.push(targetId);
          saveBans();
        }

        // إيقاف اتصالاته
        Object.keys(clients).forEach(key => {
          if (key.startsWith(targetId + '_')) {
            try { clients[key].end(); } catch (e) {}
            delete clients[key];
          }
        });

        return ctx.reply(`✅ تم حظر المستخدم: ${targetId}`);
      }

      if (ua.action === 'unban') {
        bannedUsers = bannedUsers.filter(x => x !== targetId);
        saveBans();
        return ctx.reply(`✅ تم رفع الحظر عن: ${targetId}`);
      }

      if (ua.action === 'info') {
        const meta = userMeta[String(targetId)] || {};
        const s = servers[String(targetId)] || servers[targetId] || null;
        const activeForUser = Object.keys(clients).filter(k => k.startsWith(targetId + '_'));

        const name = meta.first_name || 'بدون اسم';
        const username = meta.username ? `@${meta.username}` : 'بدون معرف';
        const joined = meta.joinedAt ? new Date(meta.joinedAt).toLocaleString() : 'غير معروف';
        const banned = bannedUsers.includes(targetId) ? 'نعم 🚫' : 'لا ✅';

        let msg = `ℹ️ *معلومات المستخدم*\n\n`;
        msg += `🆔 ID: *${targetId}*\n`;
        msg += `👤 الاسم: *${name}*\n`;
        msg += `🔗 المعرف: *${username}*\n`;
        msg += `📅 الانضمام: *${joined}*\n`;
        msg += `🚫 محظور: *${banned}*\n\n`;

        if (s && s.ip) {
          msg += `🌐 السيرفر:\n`;
          msg += `• ${s.ip}:${s.port}\n`;
          msg += `• إصدار: ${s.version || 'غير محدد'}\n\n`;
        } else {
          msg += `🌐 السيرفر: لا يوجد\n\n`;
        }

        msg += `🤖 اتصالات نشطة: *${activeForUser.length}*\n`;
        if (activeForUser.length) {
          msg += activeForUser.map(k => `• ${k}`).join('\n');
        }

        return ctx.reply(msg, { parse_mode: 'Markdown' });
      }
    }

    // 3) إدارة مسؤولين
    const aa = pendingAdminAction.get(ownerId);
    if (aa) {
      const targetId = parseInt(text.trim(), 10);
      if (Number.isNaN(targetId)) {
        return ctx.reply('❌ ID غير صحيح. أرسل رقم فقط.');
      }

      pendingAdminAction.delete(ownerId);

      if (aa.action === 'add') {
        if (!admins.includes(targetId)) admins.push(targetId);
        // تأكد عدم حذف المالك
        if (!admins.includes(ownerId)) admins.unshift(ownerId);
        saveAdmins();
        return ctx.reply(`✅ تم إضافة المسؤول: ${targetId}`);
      }

      if (aa.action === 'remove') {
        if (targetId === ownerId) return ctx.reply('❌ لا يمكن إزالة المالك.');
        admins = admins.filter(x => x !== targetId);
        if (!admins.includes(ownerId)) admins.unshift(ownerId);
        saveAdmins();
        return ctx.reply(`✅ تم إزالة المسؤول: ${targetId}`);
      }
    }
  }

  
// ===== أوضاع إضافية للمالك: إدارة قنوات الاشتراك =====
if (userId === ownerId) {
  const sa = pendingSubAction.get(ownerId);
  if (sa) {
    pendingSubAction.delete(ownerId);

    const raw = text.trim();
    const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
    if (parts.length < 1) return ctx.reply('❌ صيغة غير صحيحة.');

    let idPart = parts[0];
    let urlPart = parts[1] || '';
    let titlePart = parts[2] || '';

    // id: رقم أو @username
    let idVal = idPart;
    if (/^-?\d+$/.test(idPart)) {
      idVal = parseInt(idPart, 10);
    } else {
      if (!idPart.startsWith('@') && /^[A-Za-z0-9_]{5,}$/.test(idPart)) idVal = '@' + idPart;
    }

    // إذا @username ولم يُرسل رابط، اصنعه تلقائياً
    if (!urlPart && typeof idVal === 'string' && idVal.startsWith('@')) {
      urlPart = `https://t.me/${idVal.replace('@','')}`;
    }

    if (!urlPart) {
      return ctx.reply('❌ يجب توفير رابط للقناة (خصوصاً للقنوات الخاصة).');
    }

    if (!Array.isArray(subChannels)) subChannels = [];
    const exists = subChannels.some(ch => String(ch.id) === String(idVal));
    if (exists) return ctx.reply('⚠️ هذه القناة موجودة بالفعل.');

    subChannels.push({ id: idVal, url: urlPart, title: titlePart });
    saveSubChannels();

    return ctx.reply('✅ تم إضافة قناة الاشتراك بنجاح.');
  }
}

// ===== النظام الأساسي للبوت (IP:PORT) =====
  if (text.includes(':')) {
    const parts = text.split(':');
    if (parts.length === 2) {
      const ip = parts[0].trim();
      const port = parseInt(parts[1].trim(), 10);

      if (!isNaN(port)) {
        servers[userId] = servers[userId] || {};
        servers[userId].ip = ip;
        servers[userId].port = port;
        saveServers();

        const version = servers[userId].version || '1.21.124';

        ctx.reply(
          `✅ تم حفظ السيرفر!\n` +
          `🌐 IP: ${ip}\n` +
          `🔌 Port: ${port}\n` +
          `📀 الإصدار: ${version}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('▶️ تشغيل البوت', 'run_bot')],
            [Markup.button.callback('➕ إضافة بوت', 'add_bot')],
            [Markup.button.callback('🔧 تشغيل ذكي', 'run_smart')],
            [Markup.button.callback('🛑 إيقاف البوت', 'stop_bot')],
            [Markup.button.callback('🗑️ حذف السيرفر', 'del_server')],
            [Markup.button.url('تفاعل في قناة البوت والا يتم حظرك نهائيا🚫 ', 'https://t.me/+c7sbwOViyhNmYzAy')]
          ])
        );
      } else {
        ctx.reply('❌ Port يجب أن يكون رقم!');
      }
    }
  }
});

// تشغيل البوت الذكي (آمن)
bot.action('run_smart', async (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.answerCbQuery('❌ أضف السيرفر أولاً!', { show_alert: true });
  }

  const { ip, port, version = '1.21.124' } = servers[userId];

  ctx.answerCbQuery('🤖 جاري التشغيل الذكي...');

  ctx.reply(`🔍 بدء الاتصال الذكي:\n${ip}:${port}\nالإصدار المطلوب: ${version}`)
    .catch(() => {});

  setTimeout(async () => {
    try {
      const result = await smartConnect(ip, port, version, userId);

      if (result.success) {
        const clientKey = `${userId}_main`;
        clients[clientKey] = result.client;

        ctx.reply(result.message).catch(() => {});

        result.client.on('join', () => {
          bot.telegram.sendMessage(userId,
            `🔥 تم دخول البوت!\n` +
            `▫️ الإصدار المستخدم: ${result.versionUsed}\n` +
            `▫️ البروتوكول: ${result.protocolUsed}\n` +
            `▫️ الحالة: ${result.versionUsed === result.requestedVersion ? 'مباشر' : 'بديل'}`
          ).catch(() => {});
        });

        result.client.on('disconnect', (reason) => {
          bot.telegram.sendMessage(userId, `❌ تم الفصل: ${reason}`).catch(() => {});
          delete clients[clientKey];
        });

        result.client.on('error', (err) => {
          bot.telegram.sendMessage(userId, `⚠️ خطأ: ${String(err.message).substring(0, 100)}`).catch(() => {});
          delete clients[clientKey];
        });

      } else {
        ctx.reply(
          `❌ فشل الاتصال\n\n` +
          `خطأ: ${result.error}\n\n` +
          `💡 جرب:\n` +
          `1. تحقق من تشغيل السيرفر\n` +
          `2. جرب إصداراً مختلفاً\n` +
          `3. استخدم الزر "▶️ تشغيل البوت"`
        ).catch(() => {});
      }

    } catch (error) {
      console.error('🔥 خطأ محتوى في run_smart:', error.message);
    }
  }, 100);
});

// ============== [نظام حماية من التوقف] ==============
process.on('uncaughtException', (error) => {
  console.error(`🚨 خطأ غير متوقع (محتوى): ${error.message}`);
  console.error('💡 البوت يستمر بالعمل...');
});

process.on('unhandledRejection', (reason) => {
  console.error('🚨 وعد مرفوض غير معالج (محتوى):', reason);
});

// أمر مراقبة الحالة (قديم - يبقى كما هو)
bot.command('status', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const stats = `📊 حالة البوت:\n` +
    `👥 المستخدمين: ${users.length}\n` +
    `🌐 السيرفرات: ${Object.keys(servers).length}\n` +
    `🤖 اتصالات: ${Object.keys(clients).length}\n` +
    `🔄 معالجة: ${isProcessing ? 'نعم' : 'لا'}\n` +
    `✅ الحالة: نشط`;

  ctx.reply(stats);
});

// عرض جميع المستخدمين (قديم - يبقى كما هو)
bot.command('users', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const userList = users.slice(0, 50).map((id, index) =>
    `${index + 1}. ID: ${id}`
  ).join('\n');

  ctx.reply(
    `👥 المستخدمين (${users.length}):\n\n${userList}\n\n` +
    `📊 أول 50 مستخدم من أصل ${users.length}`
  );
});

// حذف مستخدم (قديم - يبقى كما هو)
bot.command('remove', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ استخدم: /remove [رقم المستخدم]');
  }

  const userId = parseInt(args[1], 10);
  if (isNaN(userId)) {
    return ctx.reply('❌ رقم المستخدم يجب أن يكون رقماً');
  }

  const userIndex = users.indexOf(userId);
  if (userIndex !== -1) {
    users.splice(userIndex, 1);
  }

  if (servers[userId]) {
    delete servers[userId];
  }

  Object.keys(clients).forEach(key => {
    if (key.startsWith(userId + '_')) {
      try {
        clients[key].end();
      } catch (err) {}
      delete clients[key];
    }
  });

  delete userMeta[String(userId)];
  bannedUsers = bannedUsers.filter(x => x !== userId);

  saveUsers();
  saveServers();
  saveUserMeta();
  saveBans();

  ctx.reply(`✅ تم حذف المستخدم ${userId} وبياناته`);
});

// عرض السيرفرات المحفوظة (قديم - يبقى كما هو)
bot.command('servers', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  let serverList = '';
  let count = 0;

  for (const uid in servers) {
    if (servers[uid]?.ip) {
      count++;
      serverList += `${count}. ${servers[uid].ip}:${servers[uid].port} (الإصدار: ${servers[uid].version || 'غير محدد'})\n`;

      if (count >= 20) {
        serverList += '... والمزيد\n';
        break;
      }
    }
  }

  ctx.reply(
    `🌐 السيرفرات المحفوظة (${Object.keys(servers).length}):\n\n${serverList || 'لا توجد سيرفرات'}\n\n` +
    `📊 عرض أول 20 سيرفر`
  );
});

// إعادة التشغيل
bot.command('restart', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  ctx.reply('🔄 جاري إعادة التشغيل...');

  Object.keys(clients).forEach(key => {
    try {
      clients[key].end();
    } catch (err) {}
  });

  setTimeout(() => {
    console.log('🔄 إعادة التشغيل عن بعد بواسطة المالك');
    process.exit(0);
  }, 2000);
});

// نسخ احتياطي
bot.command('backup', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  try {
    const backupData = {
      users: users,
      servers: servers,
      timestamp: new Date().toISOString(),
      count: {
        users: users.length,
        servers: Object.keys(servers).length
      }
    };

    JSON.stringify(backupData, null, 2);

    ctx.reply(
      `💾 النسخ الاحتياطي:\n\n` +
      `👥 المستخدمين: ${users.length}\n` +
      `🌐 السيرفرات: ${Object.keys(servers).length}\n` +
      `⏰ الوقت: ${new Date().toLocaleString()}\n\n` +
      `📋 البيانات جاهزة للنسخ`
    );

  } catch (error) {
    ctx.reply(`❌ خطأ في النسخ الاحتياطي: ${error.message}`);
  }
});

// تشغيل البوت العادي
bot.action('run_bot', async (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.answerCbQuery('❌ أضف السيرفر أولاً!', { show_alert: true });
  }

  const { ip, port, version = '1.21.124' } = servers[userId];
  const protocol = PROTOCOL_MAP[version] || 860;

  ctx.answerCbQuery('🚀 جاري التشغيل...');
  ctx.reply(`🔗 الاتصال بـ:\n${ip}:${port}\nالإصدار: ${version}`);

  try {
    const client = createClient({
      host: ip,
      port: port,
      username: 'IBR_Bot',
      version: version,
      offline: true,
      connectTimeout: 15000,
      protocolVersion: protocol,
      skipPing: true
    });

    const clientKey = `${userId}_main`;
    clients[clientKey] = client;

    client.on('join', () => {
      bot.telegram.sendMessage(userId, '🔥 دخل البوت بنجاح!').catch(() => {});
    });

    client.on('disconnect', (reason) => {
      bot.telegram.sendMessage(userId, `❌ تم الفصل: ${reason}`).catch(() => {});
      delete clients[clientKey];
    });

    client.on('error', (err) => {
      let errorMsg = `❌ خطأ: ${err.message}`;

      if (String(err.message).includes('Unsupported version')) {
        const closest = getClosestVersion(version);
        errorMsg += `\n\n💡 جرب:\n`;
        errorMsg += `• الزر "🔧 تشغيل ذكي"\n`;
        errorMsg += `• أو الإصدار ${closest}`;
      }

      bot.telegram.sendMessage(userId, errorMsg).catch(() => {});
      delete clients[clientKey];
    });

  } catch (error) {
    ctx.reply(`❌ خطأ: ${error.message}`);
  }
});

// إضافة بوت إضافي
bot.action('add_bot', async (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.answerCbQuery('❌ أضف السيرفر أولاً!', { show_alert: true });
  }

  const { ip, port, version = '1.21.124' } = servers[userId];

  ctx.answerCbQuery('➕ جاري إضافة بوت...');

  try {
    const botNames = ['IBR_Bot_2', 'IBR_Bot_3', 'IBR_Bot_4', 'IBR_Bot_5'];
    const botName = botNames[Math.floor(Math.random() * botNames.length)];

    const result = await smartConnect(ip, port, version, userId, botName);

    if (result.success) {
      const clientKey = `${userId}_${botName}`;
      clients[clientKey] = result.client;

      ctx.reply(`✅ ${botName} - ${result.message}`);

      result.client.on('disconnect', () => {
        bot.telegram.sendMessage(userId, `❌ ${botName} تم فصله`).catch(() => {});
        delete clients[clientKey];
      });

    } else {
      ctx.reply(`❌ فشل إضافة ${botName}: ${result.error}`);
    }

  } catch (error) {
    ctx.reply(`❌ خطأ في إضافة البوت: ${error.message}`);
  }
});

// إيقاف البوتات
bot.action('stop_bot', (ctx) => {
  const userId = ctx.from.id;

  let stopped = 0;
  Object.keys(clients).forEach(key => {
    if (key.startsWith(userId + '_')) {
      try {
        clients[key].end();
        stopped++;
      } catch (err) {}
      delete clients[key];
    }
  });

  ctx.answerCbQuery(`🛑 تم إيقاف ${stopped} بوت`);
  ctx.reply(`✅ تم إيقاف ${stopped} بوت`);
});

// حذف السيرفر
bot.action('del_server', (ctx) => {
  const userId = ctx.from.id;

  if (servers[userId]) {
    delete servers[userId];
    saveServers();

    Object.keys(clients).forEach(key => {
      if (key.startsWith(userId + '_')) {
        try {
          clients[key].end();
        } catch (err) {}
        delete clients[key];
      }
    });

    ctx.answerCbQuery('🗑️ تم الحذف');
    ctx.reply('✅ تم حذف السيرفر وإيقاف البوتات');
  } else {
    ctx.answerCbQuery('❌ لا يوجد سيرفر');
  }
});

// ============== [أوامر خاصة] ==============

// اختبار الاتصال
bot.command('test', async (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.reply('❌ أضف السيرفر أولاً!');
  }

  const { ip, port } = servers[userId];

  ctx.reply(`🔬 *بدء اختبار الاتصال:*\n${ip}:${port}`, { parse_mode: 'Markdown' });

  const testVersions = ['1.21.130', '1.21.124', '1.21.100', '1.21.80', '1.20.80'];
  let results = [];

  for (const version of testVersions) {
    const protocol = PROTOCOL_MAP[version];
    if (!protocol) {
      results.push(`❓ ${version} - غير معروف`);
      continue;
    }

    try {
      const testClient = createClient({
        host: ip,
        port: port,
        username: 'Test_Bot',
        version: version,
        offline: true,
        connectTimeout: 5000,
        protocolVersion: protocol,
        skipPing: true
      });

      const connected = await new Promise((resolve) => {
        testClient.once('join', () => {
          try { testClient.end(); } catch (e) {}
          resolve(true);
        });

        testClient.once('error', () => {
          try { testClient.end(); } catch (e) {}
          resolve(false);
        });

        setTimeout(() => {
          try { testClient.end(); } catch (e) {}
          resolve(false);
        }, 5000);
      });

      results.push(`${connected ? '✅' : '❌'} ${version} - ${connected ? 'ناجح' : 'فاشل'}`);

    } catch (error) {
      results.push(`💥 ${version} - خطأ`);
    }
  }

  ctx.reply(
    `📊 *نتائج الاختبار:*\n\n${results.join('\n')}\n\n` +
    `💡 استخدم الإصدار الأول الناجح`,
    { parse_mode: 'Markdown' }
  );
});

// تحديث الإصدارات (للمالك فقط)
bot.command('update_versions', async (ctx) => {
  if (ctx.from.id !== ownerId) return;

  ctx.reply('🔄 جاري تحديث خريطة الإصدارات...');

  try {
    let newVersions = '';

    for (let i = 131; i <= 140; i++) {
      const version = `1.21.${i}`;
      const protocolNum = 870 + (i - 130);

      if (!PROTOCOL_MAP[version]) {
        PROTOCOL_MAP[version] = protocolNum;
        newVersions += `• ${version}: ${protocolNum}\n`;
      }
    }

    if (newVersions) {
      ctx.reply(
        `✅ *تمت إضافة إصدارات جديدة:*\n\n${newVersions}\n` +
        `📊 الإجمالي: ${Object.keys(PROTOCOL_MAP).length} إصدار\n\n` +
        `🔄 أعد تشغيل البوت للتطبيق`,
        { parse_mode: 'Markdown' }
      );
    } else {
      ctx.reply('✅ خريطة الإصدارات محدثة بالفعل');
    }

  } catch (error) {
    ctx.reply(`❌ خطأ: ${error.message}`);
  }
});

// تعيين إصدار سريع
bot.command('set130', (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.reply('❌ أضف السيرفر أولاً!');
  }

  servers[userId].version = '1.21.130';
  saveServers();

  ctx.reply(
    `✅ تم تعيين الإصدار إلى 1.21.130\n\n` +
    `🚀 *معلومات:*\n` +
    `• البروتوكول: ${PROTOCOL_MAP['1.21.130'] || 870}\n` +
    `• اضغط "🔧 تشغيل ذكي" للبدء\n\n` +
    `⚠️ إذا لم يعمل، سيحاول البوت إصداراً بديلاً تلقائياً`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('set124', (ctx) => {
  const userId = ctx.from.id;

  if (!servers[userId] || !servers[userId].ip) {
    return ctx.reply('❌ أضف السيرفر أولاً!');
  }

  servers[userId].version = '1.21.124';
  saveServers();

  ctx.reply('✅ تم تعيين الإصدار إلى 1.21.124 (مضمون)\nاضغط \"▶️ تشغيل البوت\"');
});

// الإحصائيات (قديم - يبقى كما هو)
bot.command('stats', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const stats = `📊 *إحصائيات البوت:*\n` +
    `👥 المستخدمين: ${users.length}\n` +
    `🌐 السيرفرات النشطة: ${Object.keys(servers).length}\n` +
    `🤖 البوتات النشطة: ${Object.keys(clients).length}\n` +
    `📀 أحدث إصدار: 1.21.130`;

  ctx.reply(stats, { parse_mode: 'Markdown' });
});

// البث (قديم - يبقى كما هو)
bot.command('broadcast', async (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) return ctx.reply('❌ أرسل الرسالة بعد الأمر');

  ctx.reply(`📢 إرسال لـ ${users.length} مستخدم...`);

  let sent = 0;
  for (let user of users) {
    try {
      await bot.telegram.sendMessage(user, `📢 إشعار:\n\n${message}`);
      sent++;
    } catch (err) {}
  }

  ctx.reply(`✅ تم الإرسال لـ ${sent}/${users.length} مستخدم`);
});

// معلومات المكتبة
bot.command('libinfo', (ctx) => {
  if (ctx.from.id !== ownerId) return;

  const latestVersions = Object.keys(PROTOCOL_MAP)
    .filter(v => v.startsWith('1.21.'))
    .sort()
    .reverse()
    .slice(0, 10);

  ctx.reply(
    `📦 *معلومات المكتبة:*\n\n` +
    `▫️ الإصدارات المدعومة: ${Object.keys(PROTOCOL_MAP).length}\n` +
    `▫️ أحدث 10 إصدارات:\n${latestVersions.join('\n')}\n\n` +
    `🔧 1.21.130 → بروتوكول: ${PROTOCOL_MAP['1.21.130'] || '?'}`,
    { parse_mode: 'Markdown' }
  );
});

// ============== [تشغيل البوت] ==============
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

console.log('🔍 التحقق من الإصدارات المدعومة...');

const modernVersions = Object.keys(PROTOCOL_MAP)
  .filter(v => v.startsWith('1.21.1'))
  .sort()
  .reverse();

console.log(`📀 الإصدارات الحديثة المدعومة (1.21.1xx):`);
modernVersions.slice(0, 15).forEach(v => {
  console.log(`  ${v}: ${PROTOCOL_MAP[v]}`);
});

if (modernVersions.length === 0) {
  console.log('⚠️ لا توجد إصدارات 1.21.1xx في الخريطة!');
  console.log('💡 أضفها يدوياً إلى PROTOCOL_MAP');
}

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ['message', 'callback_query']
})
.then(() => {
  console.log('🚀 البوت يعمل الآن!');
  console.log('📀 الإصدارات المدعومة:', Object.keys(PROTOCOL_MAP).length);

  const latest = Object.keys(PROTOCOL_MAP)
    .filter(v => v.startsWith('1.21.1'))
    .sort()
    .reverse()[0];

  console.log(`🎯 أحدث إصدار: ${latest} (بروتوكول: ${PROTOCOL_MAP[latest]})`);
})
.catch((err) => {
  console.error('❌ خطأ في تشغيل البوت:', err.message);

  if (err.response?.error_code === 409) {
    console.error('\n💡 *الحل:*');
    console.error('1. اذهب إلى Railway Dashboard');
    console.error('2. أوقف الخدمة (Pause Service)');
    console.error('3. انتظر 30 ثانية');
    console.error('4. أعد التشغيل (Resume Service)');
  }
});
