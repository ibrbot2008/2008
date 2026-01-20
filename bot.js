const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('bedrock-protocol');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// ===== حل مشكلة البورت =====
let port = 3000;
const server = http.createServer((req, res) => {
  res.write('Bot is Running!');
  res.end();
});

function startServer(portToTry) {
  server.listen(portToTry, () => {
    console.log(`✅ Server running on port ${portToTry}`);
    port = portToTry;
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${portToTry} is busy, trying ${portToTry + 1}`);
      startServer(portToTry + 1);
    } else {
      console.error('❌ Server error:', err.message);
    }
  });
}

startServer(3000);

// ============== [الإعدادات] ==============
const REQUIRED_CHANNEL = -1003499194538;
const botToken = '8198997283:AAHL_yWKazZf3Aa8OluwgjXV2goxtpwNPPQ';
const ownerId = 1421302016;

const DEFAULT_SUB_CHANNELS = [
  { id: REQUIRED_CHANNEL, url: 'https://t.me/+c7sbwOViyhNmYzAy', title: 'IBR Channel' }
];

const bot = new Telegraf(botToken);

// ============== [تخزين البيانات] ==============
let servers = {};
let users = [];
let clients = {};
let userMeta = {};
let bannedUsers = [];
let admins = [];
let subChannels = [];
let settings = { forceSubscription: true };
const DATA_DIR = './data';

// ============== [نظام النقاط الجديد] ==============
let pointsSystem = {
  points: {}, // userId: { balance: 100, totalEarned: 100, lastBonus: null }
  bonusLinks: {}, // referralCode: { points: 100, uses: 0, maxUses: 1, expiry: null }
  activeBots: {}, // userId: { startTime: timestamp, hours: 6, botCount: 1 }
  timers: {}, // userId: timerId
  linkCooldowns: {} // userId: { link1: timestamp, link2: timestamp }
};

// ============== [روابط المكافآت الافتراضية - كل رابط يستخدم مرة واحدة فقط] ==============
const DEFAULT_BONUS_LINKS = {
  'bonus_100_1': { points: 100, uses: 0, maxUses: 1, expiry: null, creator: 'system' },
  'bonus_100_2': { points: 100, uses: 0, maxUses: 1, expiry: null, creator: 'system' },
  'bonus_100_3': { points: 100, uses: 0, maxUses: 1, expiry: null, creator: 'system' },
  'bonus_100_4': { points: 100, uses: 0, maxUses: 1, expiry: null, creator: 'system' },
  'bonus_100_5': { points: 100, uses: 0, maxUses: 1, expiry: null, creator: 'system' }
};

// ============== [حالات لوحة الأدمن] ==============
const pendingBroadcast = new Map();
const pendingUserAction = new Map();
const pendingAdminAction = new Map();
const pendingSubAction = new Map();
const pendingPointsAction = new Map();

// ============== [خريطة الإصدارات] ==============
const PROTOCOL_MAP = {
  '1.21.140': 880, '1.21.139': 879, '1.21.138': 878, '1.21.137': 877,
  '1.21.136': 876, '1.21.135': 875, '1.21.134': 874, '1.21.133': 873,
  '1.21.132': 872, '1.21.131': 871, '1.21.130': 870,
  '1.21.124.2': 860, '1.21.124': 860, '1.21.123': 859,
  '1.21.120': 859, '1.21.111': 844, '1.21.100': 827,
  '1.21.93': 819, '1.21.90': 818, '1.21.80': 800,
  '1.21.72': 786, '1.21.70': 786, '1.21.60': 776,
  '1.21.50': 766, '1.21.42': 748, '1.21.30': 729,
  '1.21.20': 712, '1.21.2': 686, '1.21.0': 685,
  '1.20.80': 671, '1.20.71': 662, '1.20.61': 649,
  '1.20.50': 630, '1.20.40': 622, '1.20.30': 618,
  '1.20.15': 594, '1.20.10': 594, '1.20.0': 589,
  '1.19.80': 582, '1.19.70': 575, '1.19.63': 568,
  '1.19.62': 567, '1.19.60': 567, '1.19.50': 560,
  '1.19.40': 557, '1.19.30': 554, '1.19.21': 545,
  '1.19.20': 544, '1.19.10': 534, '1.19.1': 527
};

// ============== [دوال نظام النقاط] ==============
function initPointsSystem() {
  try {
    ensureDataDir();
    const pointsPath = path.join(DATA_DIR, 'points_system.json');
    if (fs.existsSync(pointsPath)) {
      const data = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
      pointsSystem = { ...pointsSystem, ...data };
    }
    
    // دمج الروابط الافتراضية
    for (const [code, link] of Object.entries(DEFAULT_BONUS_LINKS)) {
      if (!pointsSystem.bonusLinks[code]) {
        pointsSystem.bonusLinks[code] = link;
      }
    }
    
    // إعادة ضبط استخدامات الروابط كل 24 ساعة (اختياري)
    resetUsedLinksDaily();
  } catch (error) {
    console.log('📂 خطأ في تحميل نظام النقاط:', error.message);
  }
}

function savePointsSystem() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'points_system.json');
    const tempFilePath = filePath + '.tmp';
    
    // الكتابة إلى ملف مؤقت أولاً
    fs.writeFileSync(tempFilePath, JSON.stringify(pointsSystem, null, 2));
    
    // استبدال الملف القديم بالمؤقت
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ نظام النقاط بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ نظام النقاط:', error.message);
  }
}

function getUserPoints(userId) {
  if (!pointsSystem.points[userId]) {
    pointsSystem.points[userId] = { 
      balance: 100, 
      totalEarned: 100, 
      lastBonus: null,
      firstJoin: new Date().toISOString(),
      usedLinks: {} // رابط: تاريخ الاستخدام
    };
    savePointsSystem();
  }
  return pointsSystem.points[userId];
}

function addPoints(userId, amount, source = 'bonus') {
  const userPoints = getUserPoints(userId);
  userPoints.balance += amount;
  userPoints.totalEarned += amount;
  if (source === 'bonus') {
    userPoints.lastBonus = new Date().toISOString();
  }
  savePointsSystem();
  return userPoints.balance;
}

function deductPoints(userId, amount) {
  const userPoints = getUserPoints(userId);
  if (userPoints.balance >= amount) {
    userPoints.balance -= amount;
    savePointsSystem();
    return true;
  }
  return false;
}

function checkBonusLink(userId, referralCode) {
  const link = pointsSystem.bonusLinks[referralCode];
  if (!link) return null;
  
  // التحقق من الصلاحية
  if (link.expiry && new Date() > new Date(link.expiry)) return null;
  
  // التحقق من الحد الأقصى للاستخدامات
  if (link.uses >= link.maxUses) return null;
  
  // التحقق من أن المستخدم لم يستخدم الرابط من قبل
  const userPoints = getUserPoints(userId);
  if (userPoints.usedLinks && userPoints.usedLinks[referralCode]) {
    // إذا مر 24 ساعة يمكنه استخدامه مرة أخرى
    const lastUse = new Date(userPoints.usedLinks[referralCode]);
    const hoursDiff = (new Date() - lastUse) / (1000 * 60 * 60);
    if (hoursDiff < 24) return null; // لم تمر 24 ساعة
  }
  
  return link;
}

function useBonusLink(userId, referralCode) {
  const link = pointsSystem.bonusLinks[referralCode];
  if (!link) return false;
  
  // زيادة عدد استخدامات الرابط
  link.uses = (link.uses || 0) + 1;
  
  // تسجيل استخدام المستخدم للرابط
  const userPoints = getUserPoints(userId);
  if (!userPoints.usedLinks) userPoints.usedLinks = {};
  userPoints.usedLinks[referralCode] = new Date().toISOString();
  
  savePointsSystem();
  return link;
}

function resetUsedLinksDaily() {
  // هذه الوظيفة يمكن تفعيلها يدوياً من لوحة الأدمن
  const now = new Date();
  const resetTime = new Date();
  resetTime.setHours(0, 0, 0, 0);
  
  // إذا كانت الساعة 12 صباحاً، أعد ضبط استخدامات الروابط
  if (now.getHours() === 0 && now.getMinutes() < 5) {
    for (const code in pointsSystem.bonusLinks) {
      if (pointsSystem.bonusLinks[code].creator === 'system') {
        pointsSystem.bonusLinks[code].uses = 0;
      }
    }
    
    // مسح سجلات استخدام المستخدمين للروابط
    for (const userId in pointsSystem.points) {
      if (pointsSystem.points[userId].usedLinks) {
        pointsSystem.points[userId].usedLinks = {};
      }
    }
    
    savePointsSystem();
    console.log('🔄 تم إعادة ضبط استخدامات الروابط اليومية');
  }
}

function createActiveBot(userId, botCount = 1) {
  const startTime = Date.now();
  pointsSystem.activeBots[userId] = {
    startTime: startTime,
    hours: 6,
    botCount: botCount,
    endTime: startTime + (6 * 60 * 60 * 1000),
    active: true
  };
  
  // إعداد مؤقت للإيقاف بعد 6 ساعات
  if (pointsSystem.timers[userId]) {
    clearTimeout(pointsSystem.timers[userId]);
  }
  
  pointsSystem.timers[userId] = setTimeout(() => {
    autoStopUserBots(userId);
  }, 6 * 60 * 60 * 1000);
  
  savePointsSystem();
}

function removeActiveBot(userId) {
  if (pointsSystem.timers[userId]) {
    clearTimeout(pointsSystem.timers[userId]);
    delete pointsSystem.timers[userId];
  }
  if (pointsSystem.activeBots[userId]) {
    pointsSystem.activeBots[userId].active = false;
  }
  delete pointsSystem.activeBots[userId];
  savePointsSystem();
}

function checkActiveBot(userId) {
  const activeBot = pointsSystem.activeBots[userId];
  if (!activeBot || !activeBot.active) return null;
  
  const now = Date.now();
  if (now >= activeBot.endTime) {
    removeActiveBot(userId);
    return null;
  }
  
  const remainingMs = activeBot.endTime - now;
  const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);
  
  return {
    ...activeBot,
    remainingHours: remainingHours
  };
}

function canStartBot(userId) {
  // المالك يستطيع دائماً
  if (userId === ownerId) return { canStart: true, reason: 'owner' };
  
  // التحقق من وجود بوت نشط
  const activeBot = checkActiveBot(userId);
  if (activeBot) {
    return { 
      canStart: false, 
      reason: `⛔ لديك بوت نشط بالفعل!\n\n⏰ المتبقي: ${activeBot.remainingHours} ساعة\n\nيرجى الانتظار حتى ينتهي الوقت أو إيقاف البوت الحالي.`,
      remainingHours: activeBot.remainingHours
    };
  }
  
  // التحقق من النقاط
  const userPoints = getUserPoints(userId);
  if (userPoints.balance < 100) {
    return { 
      canStart: false, 
      reason: `❌ نقاطك غير كافية!\n\nتحتاج 100 نقطة، لديك ${userPoints.balance} نقطة فقط.\n\n🎯 اربط السيرفر واضغط على /points لمعرفة طرق زيادة النقاط.`,
      neededPoints: 100 - userPoints.balance
    };
  }
  
  return { canStart: true, reason: 'success' };
}

function autoStopUserBots(userId) {
  // إيقاف جميع اتصالات المستخدم
  Object.keys(clients).forEach(key => {
    if (key.startsWith(userId + '_')) {
      try {
        clients[key].end();
        console.log(`⏰ تلقائي: إيقاف بوت ${key} بعد 6 ساعات`);
      } catch (err) {}
      delete clients[key];
    }
  });
  
  // إرسال إشعار للمستخدم
  bot.telegram.sendMessage(userId, 
    '⏰ *انتهت المدة!*\n\n' +
    'تم إيقاف البوت تلقائياً بعد 6 ساعات من التشغيل.\n' +
    '💰 يمكنك تشغيله مرة أخرى بـ 100 نقطة.\n\n' +
    '📥 أرسل IP السيرفر وPort للبدء من جديد.',
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  
  removeActiveBot(userId);
}

// ============== [دالة للحصول على أقرب إصدار مدعوم] ==============
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

  return '1.21.124';
}

// ============== [وظائف الملفات] ==============
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`✅ تم إنشاء مجلد البيانات: ${DATA_DIR}`);
    }
  } catch (error) {
    console.log('❌ خطأ في إنشاء مجلد البيانات:', error.message);
  }
}

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.log(`❌ خطأ في قراءة ${filePath}:`, e.message);
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

    if (!Array.isArray(subChannels)) subChannels = DEFAULT_SUB_CHANNELS;
    subChannels = subChannels
      .filter(ch => ch && (typeof ch.id === 'string' || typeof ch.id === 'number'))
      .map(ch => ({ id: ch.id, url: ch.url || '', title: ch.title || '' }));

    if (!settings || typeof settings !== 'object') settings = { forceSubscription: true };
    if (typeof settings.forceSubscription !== 'boolean') settings.forceSubscription = true;

    if (!admins.includes(ownerId)) admins.unshift(ownerId);

    console.log('✅ تم تحميل البيانات بنجاح');
  } catch (error) {
    console.log('📂 خطأ في تحميل البيانات:', error.message);
  }
}

function saveServers() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'servers.json');
    const tempFilePath = filePath + '.tmp';
    
    // الكتابة إلى ملف مؤقت أولاً
    fs.writeFileSync(tempFilePath, JSON.stringify(servers, null, 2));
    
    // استبدال الملف القديم بالمؤقت
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ السيرفرات بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ السيرفرات:', error.message);
  }
}

function saveUsers() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'users.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(users, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ المستخدمين بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ المستخدمين:', error.message);
  }
}

function saveUserMeta() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'users_meta.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(userMeta, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ بيانات المستخدمين الإضافية بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ بيانات المستخدمين الإضافية:', error.message);
  }
}

function saveBans() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'banned.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(bannedUsers, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ قائمة الحظر بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ قائمة الحظر:', error.message);
  }
}

function saveAdmins() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'admins.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(admins, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ قائمة المسؤولين بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ قائمة المسؤولين:', error.message);
  }
}

function saveSubChannels() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'sub_channels.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(subChannels, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ قنوات الاشتراك بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ قنوات الاشتراك:', error.message);
  }
}

function saveSettings() {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, 'settings.json');
    const tempFilePath = filePath + '.tmp';
    
    fs.writeFileSync(tempFilePath, JSON.stringify(settings, null, 2));
    fs.renameSync(tempFilePath, filePath);
    console.log('✅ تم حفظ الإعدادات بنجاح');
  } catch (error) {
    console.log('❌ خطأ في حفظ الإعدادات:', error.message);
  }
}

// ============== [فحص الاشتراك] ==============
async function checkSubscription(ctx) {
  try {
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
    console.log('❌ خطأ في فحص الاشتراك:', err.message);
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

function buildVersionKeyboard(isOwnerUser, userId) {
  const userPoints = getUserPoints(userId);
  const activeBot = checkActiveBot(userId);
  
  let pointsStatus = `💰 نقاطك: ${userPoints.balance}`;
  if (activeBot) {
    pointsStatus += ` | ⏳ بوت نشط (${activeBot.remainingHours} ساعة)`;
  } else if (userPoints.balance < 100) {
    pointsStatus += ` | 💸 تحتاج ${100 - userPoints.balance} نقطة للتشغيل`;
  }
  
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
    [Markup.button.callback('💰 نقاطي وإحصائياتي', 'my_points_stats')]
  ];
  
  if (isOwnerUser) {
    rows.push([Markup.button.callback('🛠 لوحة الأدمن', 'admin_panel')]);
  }
  
  return {
    reply_markup: Markup.inlineKeyboard(rows),
    caption: pointsStatus
  };
}

async function showMainMenu(ctx) {
  const isOwnerUser = ctx?.from?.id === ownerId;
  const userId = ctx?.from?.id;
  const keyboardConfig = buildVersionKeyboard(isOwnerUser, userId);
  
  const message = `🎮 *أهلاً بك في بوت Minecraft by IBR!*\n\n` +
                 `*${keyboardConfig.caption}*\n\n` +
                 `اختر إصدار اللعبة:`;
  
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboardConfig.reply_markup
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...keyboardConfig.reply_markup
      });
    }
  } catch (error) {
    console.log('❌ خطأ في عرض القائمة الرئيسية:', error.message);
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...keyboardConfig.reply_markup
      });
    } catch (e) {}
  }
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
  } catch (e) {
    console.log('❌ خطأ في safeAnswerCbQuery:', e.message);
  }
}

async function safeEditOrReply(ctx, text, extra = {}) {
  const extraPlain = { ...(extra || {}) };
  if (extraPlain.parse_mode) delete extraPlain.parse_mode;

  if (ctx?.callbackQuery) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (e1) {
      console.log('❌ خطأ في تعديل الرسالة:', e1.message);
      try {
        await ctx.editMessageText(text, extraPlain);
        return;
      } catch (e2) {
        console.log('❌ خطأ في تعديل الرسالة بدون parse_mode:', e2.message);
        try {
          await ctx.reply(text, extra);
        } catch (e3) {
          console.log('❌ خطأ في إرسال رد جديد:', e3.message);
          try {
            await ctx.reply(text, extraPlain);
          } catch (e4) {
            console.log('❌ خطأ في إرسال رد جديد بدون parse_mode:', e4.message);
          }
        }
      }
    }
  } else {
    try {
      await ctx.reply(text, extra);
    } catch (e3) {
      console.log('❌ خطأ في إرسال الرسالة:', e3.message);
      try {
        await ctx.reply(text, extraPlain);
      } catch (e4) {
        console.log('❌ خطأ في إرسال الرسالة بدون parse_mode:', e4.message);
      }
    }
  }
}

async function renderAdminPanel(ctx) {
  const totalUsers = users.length;
  const totalServers = Object.keys(servers).filter(uid => servers[uid]?.ip).length;
  const activeBots = Object.keys(clients).length;
  
  const totalPoints = Object.values(pointsSystem.points).reduce((sum, user) => sum + user.balance, 0);
  const totalEarned = Object.values(pointsSystem.points).reduce((sum, user) => sum + user.totalEarned, 0);
  const activeBotsCount = Object.keys(pointsSystem.activeBots).filter(uid => pointsSystem.activeBots[uid]?.active).length;

  const text =
    `🛠️ *لوحة تحكم المالك*\n\n` +
    `📊 *إحصائيات مباشرة:*\n` +
    `👥 المستخدمين: *${totalUsers}*\n` +
    `🌐 السيرفرات: *${totalServers}*\n` +
    `🤖 البوتات النشطة: *${activeBots}*\n` +
    `💰 إجمالي النقاط: *${totalPoints}*\n` +
    `📈 إجمالي الأرباح: *${totalEarned}*\n` +
    `⏳ البوتات النشطة بالنظام: *${activeBotsCount}*\n\n` +
    `اختر إجراء من الأزرار بالأسفل:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📢 إذاعة للكل', 'admin_broadcast')],
    [Markup.button.callback('📊 الإحصائيات (تفصيل)', 'admin_stats')],
    [Markup.button.callback('👤 إدارة المستخدمين', 'admin_users')],
    [Markup.button.callback('💰 إدارة النقاط', 'admin_points')],
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
      if (ctx?.message?.text === '/start') {
        try { await ctx.reply('🚫 تم حظرك من استخدام البوت.'); } catch (e) {}
      }
      return;
    }
  } catch (e) {
    console.log('❌ خطأ في middleware:', e.message);
  }
  return next();
});

// ============== [تحميل البيانات] ==============
loadData();
initPointsSystem();

// ============== [معالجة الأخطاء العالمية] ==============
process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير معالج:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ وعد مرفوض غير معالج:', reason);
});

// ============== [أوامر نظام النقاط] ==============
bot.action('my_points_stats', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  const userId = ctx.from.id;
  const userPoints = getUserPoints(userId);
  const activeBot = checkActiveBot(userId);
  
  let message = `💰 *نظام النقاط*\n\n`;
  message += `🏦 الرصيد الحالي: *${userPoints.balance} نقطة*\n`;
  message += `📈 إجمالي ما ربحته: *${userPoints.totalEarned} نقطة*\n\n`;
  
  if (activeBot) {
    message += `🤖 *بوت نشط:*\n`;
    message += `⏰ المدة: 6 ساعة\n`;
    message += `⏳ المتبقي: ${activeBot.remainingHours} ساعة\n`;
    message += `🤖 عدد البوتات: ${activeBot.botCount}\n\n`;
  } else {
    message += `🔋 *لا يوجد بوت نشط*\n`;
    message += `لتشغيل بوت جديد: تحتاج *100 نقطة*\n\n`;
  }
  
  message += `📋 *طرق زيادة النقاط:*\n`;
  message += `• اطلب الروابط من قناة البوت\n`;
  message += `• كل رابط يعطيك 100 نقطة\n`;
  message += `• كل رابط يستخدم مرة واحدة\n`;
  message += `• الروابط تتجدد كل 24 ساعة\n\n`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 قناة البوت للروابط', 'https://t.me/+c7sbwOViyhNmYzAy')],
    [Markup.button.callback('🤖 تشغيل بوت جديد (100 نقطة)', 'start_bot_with_points')],
    [Markup.button.callback('📊 إحصائيات مفصلة', 'detailed_stats')],
    [Markup.button.callback('🔙 رجوع', 'back_to_main')]
  ]);
  
  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.log('❌ خطأ في my_points_stats:', error.message);
    await safeAnswerCbQuery(ctx, '❌ حدث خطأ، يرجى المحاولة مرة أخرى', { show_alert: true });
  }
});

bot.action('detailed_stats', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  const userId = ctx.from.id;
  const userPoints = getUserPoints(userId);
  const activeBot = checkActiveBot(userId);
  
  let message = `📊 *إحصائيات مفصلة*\n\n`;
  message += `👤 *معلومات المستخدم:*\n`;
  message += `🆔 المعرف: ${userId}\n`;
  message += `🏦 الرصيد: ${userPoints.balance} نقطة\n`;
  message += `📈 إجمالي الأرباح: ${userPoints.totalEarned} نقطة\n`;
  
  if (userPoints.firstJoin) {
    const joinDate = new Date(userPoints.firstJoin).toLocaleString('ar-SA');
    message += `📅 الانضمام: ${joinDate}\n`;
  }
  
  message += `\n🤖 *حالة البوت:*\n`;
  
  if (activeBot) {
    const startTime = new Date(activeBot.startTime).toLocaleString('ar-SA');
    const endTime = new Date(activeBot.endTime).toLocaleString('ar-SA');
    
    message += `✅ نشط\n`;
    message += `⏰ بدأ: ${startTime}\n`;
    message += `⏳ ينتهي: ${endTime}\n`;
    message += `⏱️ المتبقي: ${activeBot.remainingHours} ساعة\n`;
    message += `🤖 العدد: ${activeBot.botCount} بوت\n`;
  } else {
    message += `❌ غير نشط\n`;
    message += `💡 تحتاج 100 نقطة للتشغيل\n`;
  }
  
  message += `\n📋 *معلومات النظام:*\n`;
  message += `🎯 تكلفة التشغيل: 100 نقطة\n`;
  message += `⏰ مدة التشغيل: 6 ساعات\n`;
  message += `🔄 يمكن تجديد التشغيل بعد انتهاء المدة\n`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🤖 تشغيل بوت جديد', 'start_bot_with_points')],
    [Markup.button.callback('🔙 رجوع', 'my_points_stats')]
  ]);
  
  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.log('❌ خطأ في detailed_stats:', error.message);
  }
});

bot.action('back_to_main', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  await showMainMenu(ctx);
});

bot.action('start_bot_with_points', async (ctx) => {
  const userId = ctx.from.id;
  
  const check = canStartBot(userId);
  
  if (!check.canStart) {
    return safeAnswerCbQuery(ctx, check.reason, { show_alert: true });
  }
  
  if (!servers[userId] || !servers[userId].ip) {
    await safeAnswerCbQuery(ctx, '❌ أضف السيرفر أولاً!', { show_alert: true });
    return ctx.reply('📥 أرسل IP السيرفر وPort:\nمثال:\nplay.server.com:19132');
  }
  
  await safeAnswerCbQuery(ctx, '🤖 جاري التحقق من النقاط...');
  
  const deducted = deductPoints(userId, 100);
  if (!deducted) {
    return safeAnswerCbQuery(ctx, '❌ نقاطك غير كافية!', { show_alert: true });
  }
  
  createActiveBot(userId, 1);
  
  try {
    await ctx.editMessageText(`✅ *تم خصم 100 نقطة*\n💰 رصيدك الجديد: ${getUserPoints(userId).balance}\n⏰ سيشتغل البوت لمدة 6 ساعات\n\n🎮 اختر إصدار اللعبة:`, {
      parse_mode: 'Markdown',
      ...buildVersionKeyboard(userId === ownerId, userId).reply_markup
    });
  } catch (error) {
    console.log('❌ خطأ في start_bot_with_points:', error.message);
  }
});

// ============== [لوحة الأدمن للنقاط] ==============
bot.action('admin_points', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  
  const totalPoints = Object.values(pointsSystem.points).reduce((sum, user) => sum + user.balance, 0);
  const totalEarned = Object.values(pointsSystem.points).reduce((sum, user) => sum + user.totalEarned, 0);
  const activeBotsCount = Object.keys(pointsSystem.activeBots).filter(uid => pointsSystem.activeBots[uid]?.active).length;
  const totalUsersWithPoints = Object.keys(pointsSystem.points).length;
  
  const text =
    `💰 *إدارة نظام النقاط*\n\n` +
    `📊 *الإحصائيات:*\n` +
    `👥 مستخدمين بالنقاط: *${totalUsersWithPoints}*\n` +
    `🏦 إجمالي النقاط: *${totalPoints}*\n` +
    `📈 إجمالي الأرباح: *${totalEarned}*\n` +
    `⏳ بوتات نشطة: *${activeBotsCount}*\n\n` +
    `اختر الإجراء:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة نقاط لمستخدم', 'admin_add_points')],
    [Markup.button.callback('➖ خصم نقاط من مستخدم', 'admin_remove_points')],
    [Markup.button.callback('📋 عرض أعلى الرصيد', 'admin_top_points')],
    [Markup.button.callback('🎁 إدارة روابط المكافآت', 'admin_bonus_links')],
    [Markup.button.callback('🔄 إعادة تعيين الروابط', 'admin_reset_links')],
    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
  ]);

  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_add_points', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  
  pendingPointsAction.set(ownerId, { action: 'add' });
  
  const text = `➕ *إضافة نقاط*\n\n` +
    `أرسل الـID والنقاط بهذا الشكل:\n` +
    `\`123456789 100\`\n\n` +
    `مثال: لإضافة 100 نقطة للمستخدم 123456789`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_points_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_points')]
  ]);
  
  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_remove_points', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  
  pendingPointsAction.set(ownerId, { action: 'remove' });
  
  const text = `➖ *خصم نقاط*\n\n` +
    `أرسل الـID والنقاط بهذا الشكل:\n` +
    `\`123456789 50\`\n\n` +
    `مثال: لخصم 50 نقطة من المستخدم 123456789`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_points_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_points')]
  ]);
  
  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_points_cancel', async (ctx) => {
  if (!isOwner(ctx)) return;
  pendingPointsAction.delete(ownerId);
  await safeAnswerCbQuery(ctx, 'تم الإلغاء ✅');
  await renderAdminPanel(ctx);
});

bot.action('admin_bonus_links', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  
  let message = `🎁 *إدارة روابط المكافآت*\n\n`;
  let linkNumber = 1;
  
  for (const [code, link] of Object.entries(pointsSystem.bonusLinks)) {
    const usedCount = link.uses || 0;
    const maxUses = link.maxUses || 1;
    const creator = link.creator || 'system';
    const expiry = link.expiry ? new Date(link.expiry).toLocaleString('ar-SA') : 'لا نهائي';
    
    message += `${linkNumber}. *${code}*\n`;
    message += `   🎯 النقاط: ${link.points}\n`;
    message += `   📊 الاستخدامات: ${usedCount}/${maxUses}\n`;
    message += `   👤 المنشئ: ${creator}\n`;
    message += `   ⏰ الانتهاء: ${expiry}\n`;
    message += `   🔗 https://t.me/IBR_Atrenos_bot?start=${code}\n\n`;
    
    linkNumber++;
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ إنشاء رابط جديد', 'admin_create_bonus_link')],
    [Markup.button.callback('🗑️ حذف رابط', 'admin_delete_bonus_link')],
    [Markup.button.callback('✏️ تعديل رابط', 'admin_edit_bonus_link')],
    [Markup.button.callback('🔄 تحديث', 'admin_bonus_links')],
    [Markup.button.callback('🔙 رجوع', 'admin_points')]
  ]);
  
  await safeEditOrReply(ctx, message, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_create_bonus_link', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  
  pendingPointsAction.set(ownerId, { action: 'create_link' });
  
  const text = `➕ *إنشاء رابط جديد*\n\n` +
    `أرسل تفاصيل الرابط بهذا الشكل:\n` +
    `\`اسم_الرابط 100 5\`\n\n` +
    `مثال: لإنشاء رابط باسم bonus_new يعطي 100 نقطة ويمكن استخدامه 5 مرات\n\n` +
    `⚠️ ملاحظة: اسم الرابط يجب أن يكون فريداً ولا يحتوي على مسافات`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_points_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_bonus_links')]
  ]);
  
  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_delete_bonus_link', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  
  pendingPointsAction.set(ownerId, { action: 'delete_link' });
  
  const text = `🗑️ *حذف رابط*\n\n` +
    `أرسل اسم الرابط الذي تريد حذفه:\n\n` +
    `الروابط المتاحة:\n` +
    Object.keys(pointsSystem.bonusLinks).map(code => `• ${code}`).join('\n');
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'admin_points_cancel')],
    [Markup.button.callback('🔙 رجوع', 'admin_bonus_links')]
  ]);
  
  await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_reset_links', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  
  for (const code in pointsSystem.bonusLinks) {
    if (pointsSystem.bonusLinks[code].creator === 'system') {
      pointsSystem.bonusLinks[code].uses = 0;
    }
  }
  
  for (const userId in pointsSystem.points) {
    if (pointsSystem.points[userId].usedLinks) {
      pointsSystem.points[userId].usedLinks = {};
    }
  }
  
  savePointsSystem();
  
  await safeAnswerCbQuery(ctx, '✅ تم إعادة تعيين جميع الروابط');
  await ctx.editMessageText(`✅ *تم إعادة تعيين الروابط*\n\n` +
    `• تم إعادة تعيين استخدامات جميع الروابط النظامية\n` +
    `• تم مسح سجلات استخدام المستخدمين\n` +
    `• الروابط الآن جاهزة للاستخدام مجدداً`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 تحديث القائمة', 'admin_bonus_links')],
      [Markup.button.callback('🔙 رجوع', 'admin_points')]
    ])
  });
});

bot.action('admin_top_points', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  
  const topUsers = Object.entries(pointsSystem.points)
    .sort(([, a], [, b]) => b.balance - a.balance)
    .slice(0, 10);
  
  let message = `🏆 *أعلى 10 رصيد*\n\n`;
  
  if (topUsers.length === 0) {
    message += `لا توجد بيانات عن النقاط.`;
  } else {
    topUsers.forEach(([userId, data], index) => {
      const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      const name = userMeta[userId]?.first_name || `مستخدم ${userId}`;
      const username = userMeta[userId]?.username ? `@${userMeta[userId]?.username}` : 'بدون معرف';
      message += `${rank} ${name} (${username})\n`;
      message += `   🆔 ${userId}\n`;
      message += `   💰 ${data.balance} نقطة\n`;
      message += `   📈 ${data.totalEarned} إجمالي\n\n`;
    });
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'admin_top_points')],
    [Markup.button.callback('🔙 رجوع', 'admin_points')]
  ]);
  
  await safeEditOrReply(ctx, message, { parse_mode: 'Markdown', ...keyboard });
});

// ============== [لوحة الأدمن الأساسية] ==============
bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) return;
  await renderAdminPanel(ctx);
});

bot.action('admin_panel', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await renderAdminPanel(ctx);
});

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

bot.action('admin_settings', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  
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
});

bot.action('settings_toggle_force', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  settings.forceSubscription = !settings.forceSubscription;
  saveSettings();
  await safeAnswerCbQuery(ctx, '✅ تم الحفظ');
  await renderAdminPanel(ctx);
});

// ============== [إدارة قنوات الاشتراك] ==============
async function showSubChannelsPage(ctx, page = 1) {
  if (!Array.isArray(subChannels)) subChannels = [];
  const perPage = 5;
  const total = subChannels.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const start = (safePage - 1) * perPage;
  const slice = subChannels.slice(start, start + perPage);

  let msg = `📌 *إدارة قنوات الاشتراك* (صفحة ${safePage}/${totalPages})\n`;
  msg += `إجمالي القنوات: *${total}*\n\n`;

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

  if (!Array.isArray(subChannels)) subChannels = [];
  const index = parseInt(ctx.match[1], 10);
  const backPage = parseInt(ctx.match[2], 10) || 1;

  if (Number.isNaN(index) || index < 0 || index >= subChannels.length) {
    await safeAnswerCbQuery(ctx, '❌ عنصر غير موجود', { show_alert: true });
    return showSubChannelsPage(ctx, backPage);
  }

  const removed = subChannels.splice(index, 1)[0];
  saveSubChannels();

  await safeAnswerCbQuery(ctx, `✅ تم حذف: ${removed?.title || removed?.id || 'القناة'}`);
  const totalPages = Math.max(1, Math.ceil(subChannels.length / 5));
  const newPage = Math.min(backPage, totalPages);
  await showSubChannelsPage(ctx, newPage);
});

// ============== [عرض جميع السيرفرات] ==============
async function showAllServersPage(ctx, page = 1) {
  if (!isOwner(ctx)) return;
  
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
  
  const perPage = 10;
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

bot.action('admin_all_servers', async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  await showAllServersPage(ctx, 1);
});

bot.action(/admin_all_servers:(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return safeAnswerCbQuery(ctx, '❌ غير مصرح', { show_alert: true });
  await safeAnswerCbQuery(ctx);
  const page = parseInt(ctx.match[1], 10) || 1;
  await showAllServersPage(ctx, page);
});

// ============== [عرض جميع المستخدمين] ==============
async function showAllUsersPage(ctx, page = 1) {
  if (!isOwner(ctx)) return;
  
  const set = new Set(Array.isArray(users) ? users : []);
  Object.keys(userMeta || {}).forEach(id => set.add(Number(id)));
  Object.keys(servers || {}).forEach(id => set.add(Number(id)));

  const list = Array.from(set)
    .filter(id => typeof id === 'number' && !Number.isNaN(id))
    .map(id => {
      const meta = userMeta?.[String(id)] || {};
      const hasServer = !!(servers?.[String(id)]?.ip || servers?.[id]?.ip);
      const isBanned = bannedUsers.includes(id);
      const userPoints = pointsSystem.points[id] || { balance: 0 };
      return {
        id,
        name: meta.first_name || '',
        username: meta.username || '',
        joinedAt: meta.joinedAt || null,
        hasServer,
        isBanned,
        points: userPoints.balance || 0
      };
    });

  list.sort((a, b) => {
    const da = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
    const db = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
    if (da !== db) return db - da;
    return b.id - a.id;
  });

  const perPage = 12;
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
      msg += `   💰 ${u.points} نقطة\n`;
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

// ============== [بداية البوت مع نظام النقاط] ==============
bot.start(async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    const referralCode = args.length > 1 ? args[1] : null;
    const userId = ctx.from.id;
    
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
      } catch (err) {
        console.log('❌ خطأ في إرسال إشعار للمالك:', err.message);
      }
    } else {
      if (!userMeta[String(userId)]) {
        userMeta[String(userId)] = { 
          first_name: user.first_name || '', 
          username: user.username || '', 
          joinedAt: new Date().toISOString() 
        };
        saveUserMeta();
      }
    }

    // معالجة روابط المكافآت
    if (referralCode) {
      const link = checkBonusLink(userId, referralCode);
      if (link) {
        const userPoints = getUserPoints(userId);
        
        if (link.uses < link.maxUses) {
          useBonusLink(userId, referralCode);
          addPoints(userId, link.points, 'referral');
          
          await ctx.reply(`🎉 *مبروك!*\n\nلقد حصلت على ${link.points} نقطة مجانية!\n💰 رصيدك الحالي: ${getUserPoints(userId).balance} نقطة`, {
            parse_mode: 'Markdown'
          });
        } else {
          await ctx.reply(`⚠️ *عذراً*\n\nهذا الرابط استنفد جميع استخداماته أو قمت باستخدامه مسبقاً.`, {
            parse_mode: 'Markdown'
          });
        }
      } else {
        await ctx.reply(`❌ *رابط غير صالح*\n\nهذا الرابط غير موجود أو تم استخدامه من قبل.`, {
          parse_mode: 'Markdown'
        });
      }
    }

    return showMainMenu(ctx);
  } catch (error) {
    console.log('❌ خطأ في أمر /start:', error.message);
    await ctx.reply('❌ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
  }
});

// ============== [زر التحقق من الاشتراك] ==============
bot.action('check_sub', async (ctx) => {
  try {
    const isSub = await checkSubscription(ctx);

    if (!isSub) {
      await ctx.answerCbQuery('❌ لم تشترك بعد!', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('✅ تم التحقق بنجاح!', { show_alert: true });
    
    // محاولة حذف الرسالة القديمة
    try { 
      await ctx.deleteMessage(); 
    } catch (e) {
      // تجاهل الخطأ إذا كانت الرسالة غير موجودة
    }
    
    // إرسال رسالة جديدة
    await showMainMenu(ctx);
  } catch (error) {
    console.log('❌ خطأ في check_sub:', error.message);
    try {
      await ctx.answerCbQuery('❌ حدث خطأ، يرجى المحاولة مرة أخرى', { show_alert: true });
    } catch (e) {}
  }
});

// ============== [استقبال النصوص] ==============
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (text.startsWith('/')) return;

    // ===== معالجة النقاط من لوحة الأدمن =====
    if (userId === ownerId) {
      const pa = pendingPointsAction.get(ownerId);
      if (pa) {
        pendingPointsAction.delete(ownerId);
        
        if (pa.action === 'create_link') {
          const parts = text.trim().split(' ');
          if (parts.length < 2) {
            return ctx.reply('❌ صيغة غير صحيحة. استخدم: اسم_الرابط نقاط عدد_الاستخدامات');
          }
          
          const linkName = parts[0];
          const points = parseInt(parts[1], 10) || 100;
          const maxUses = parseInt(parts[2], 10) || 1;
          
          if (pointsSystem.bonusLinks[linkName]) {
            return ctx.reply('❌ هذا الرابط موجود بالفعل!');
          }
          
          pointsSystem.bonusLinks[linkName] = {
            points: points,
            uses: 0,
            maxUses: maxUses,
            expiry: null,
            creator: 'admin'
          };
          
          savePointsSystem();
          
          return ctx.reply(`✅ *تم إنشاء رابط جديد*\n\n` +
            `🔗 الرابط: https://t.me/IBR_Atrenos_bot?start=${linkName}\n` +
            `🎯 النقاط: ${points}\n` +
            `📊 الحد الأقصى: ${maxUses} استخدام\n\n` +
            `شارك هذا الرابط مع المستخدمين!`, {
            parse_mode: 'Markdown'
          });
        }
        
        if (pa.action === 'delete_link') {
          const linkName = text.trim();
          if (!pointsSystem.bonusLinks[linkName]) {
            return ctx.reply('❌ هذا الرابط غير موجود!');
          }
          
          delete pointsSystem.bonusLinks[linkName];
          savePointsSystem();
          
          return ctx.reply(`✅ تم حذف الرابط: ${linkName}`);
        }
        
        const parts = text.trim().split(' ');
        if (parts.length !== 2) {
          return ctx.reply('❌ صيغة غير صحيحة. استخدم: ID عدد_النقاط');
        }
        
        const targetId = parseInt(parts[0], 10);
        const points = parseInt(parts[1], 10);
        
        if (Number.isNaN(targetId) || Number.isNaN(points)) {
          return ctx.reply('❌ القيم يجب أن تكون أرقاماً');
        }
        
        if (pa.action === 'add') {
          addPoints(targetId, points, 'admin_add');
          const newBalance = getUserPoints(targetId).balance;
          return ctx.reply(`✅ تم إضافة ${points} نقطة للمستخدم ${targetId}\n💰 الرصيد الجديد: ${newBalance}`);
        } else if (pa.action === 'remove') {
          const userPoints = getUserPoints(targetId);
          if (userPoints.balance >= points) {
            deductPoints(targetId, points);
            const newBalance = getUserPoints(targetId).balance;
            return ctx.reply(`✅ تم خصم ${points} نقطة من المستخدم ${targetId}\n💰 الرصيد الجديد: ${newBalance}`);
          } else {
            return ctx.reply(`❌ رصيد المستخدم ${targetId} غير كافي: ${userPoints.balance} فقط`);
          }
        }
      }
      
      // ===== البث =====
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
          } catch (err) {
            console.log(`❌ خطأ في إرسال للمستخدم ${uid}:`, err.message);
          }
        }

        await ctx.reply(`✅ تم الإرسال لـ ${sent}/${users.length} مستخدم`);
        return;
      }

      // ===== إدارة مستخدم =====
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

          Object.keys(clients).forEach(key => {
            if (key.startsWith(targetId + '_')) {
              try { clients[key].end(); } catch (e) {}
              delete clients[key];
            }
          });

          removeActiveBot(targetId);
          
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
          const userPoints = getUserPoints(targetId);
          const activeBot = checkActiveBot(targetId);

          const name = meta.first_name || 'بدون اسم';
          const username = meta.username ? `@${meta.username}` : 'بدون معرف';
          const joined = meta.joinedAt ? new Date(meta.joinedAt).toLocaleString() : 'غير معروف';
          const banned = bannedUsers.includes(targetId) ? 'نعم 🚫' : 'لا ✅';

          let msg = `ℹ️ *معلومات المستخدم*\n\n`;
          msg += `🆔 ID: *${targetId}*\n`;
          msg += `👤 الاسم: *${name}*\n`;
          msg += `🔗 المعرف: *${username}*\n`;
          msg += `📅 الانضمام: *${joined}*\n`;
          msg += `🚫 محظور: *${banned}*\n`;
          msg += `💰 النقاط: *${userPoints.balance}*\n`;
          msg += `📈 الإجمالي: *${userPoints.totalEarned}*\n\n`;

          if (s && s.ip) {
            msg += `🌐 السيرفر:\n`;
            msg += `• ${s.ip}:${s.port}\n`;
            msg += `• إصدار: ${s.version || 'غير محدد'}\n\n`;
          } else {
            msg += `🌐 السيرفر: لا يوجد\n\n`;
          }

          msg += `🤖 اتصالات نشطة: *${activeForUser.length}*\n`;
          if (activeBot) {
            msg += `⏳ بوت نشط: نعم (${activeBot.remainingHours} ساعة متبقية)\n`;
          } else {
            msg += `⏳ بوت نشط: لا\n`;
          }

          return ctx.reply(msg, { parse_mode: 'Markdown' });
        }
      }
      
      // ===== إضافة قناة اشتراك =====
      const sa = pendingSubAction.get(ownerId);
      if (sa) {
        pendingSubAction.delete(ownerId);

        const raw = text.trim();
        const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
        if (parts.length < 1) return ctx.reply('❌ صيغة غير صحيحة.');

        let idPart = parts[0];
        let urlPart = parts[1] || '';
        let titlePart = parts[2] || '';

        let idVal = idPart;
        if (/^-?\d+$/.test(idPart)) {
          idVal = parseInt(idPart, 10);
        } else {
          if (!idPart.startsWith('@') && /^[A-Za-z0-9_]{5,}$/.test(idPart)) idVal = '@' + idPart;
        }

        if (!urlPart && typeof idVal === 'string' && idVal.startsWith('@')) {
          urlPart = `https://t.me/${idVal.replace('@','')}`;
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
          const userPoints = getUserPoints(userId);
          const activeBot = checkActiveBot(userId);
          
          let pointsInfo = `💰 نقاطك: ${userPoints.balance}`;
          if (activeBot) {
            pointsInfo += ` | ⏳ بوت نشط (${activeBot.remainingHours} ساعة متبقية)`;
          } else if (userPoints.balance < 100) {
            pointsInfo += ` | 💸 تحتاج ${100 - userPoints.balance} نقطة للتشغيل`;
          } else {
            pointsInfo += ` | ✅ يمكنك التشغيل`;
          }

          ctx.reply(
            `✅ تم حفظ السيرفر!\n` +
            `🌐 IP: ${ip}\n` +
            `🔌 Port: ${port}\n` +
            `📀 الإصدار: ${version}\n` +
            `${pointsInfo}`,
            Markup.inlineKeyboard([
              [Markup.button.callback('▶️ تشغيل البوت (100 نقطة)', 'run_bot_with_check')],
              [Markup.button.callback('🔧 تشغيل ذكي (100 نقطة)', 'run_smart_with_check')],
              [Markup.button.callback('🛑 إيقاف البوت', 'stop_bot')],
              [Markup.button.callback('🗑️ حذف السيرفر', 'del_server')],
              [Markup.button.url('📢 قناة البوت للروابط', 'https://t.me/+c7sbwOViyhNmYzAy')],
              [Markup.button.callback('💰 نقاطي', 'my_points_stats')]
            ])
          );
        } else {
          ctx.reply('❌ Port يجب أن يكون رقم!');
        }
      }
    }
  } catch (error) {
    console.log('❌ خطأ في معالجة النص:', error.message);
  }
});

// ============== [أزرار التشغيل مع التحقق من النقاط] ==============
bot.action('run_bot_with_check', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    const check = canStartBot(userId);
    
    if (!check.canStart) {
      return safeAnswerCbQuery(ctx, check.reason, { show_alert: true });
    }
    
    if (!servers[userId] || !servers[userId].ip) {
      return safeAnswerCbQuery(ctx, '❌ أضف السيرفر أولاً!', { show_alert: true });
    }

    const { ip, port, version = '1.21.124' } = servers[userId];
    const protocol = PROTOCOL_MAP[version] || 860;

    await safeAnswerCbQuery(ctx, '🚀 جاري التشغيل...');
    
    const deducted = deductPoints(userId, 100);
    if (!deducted) {
      return safeAnswerCbQuery(ctx, '❌ خطأ في خصم النقاط!', { show_alert: true });
    }
    
    createActiveBot(userId, 1);
    
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
        bot.telegram.sendMessage(userId, 
          `🔥 *تم تشغيل البوت بنجاح!*\n\n` +
          `⏰ المدة: 6 ساعات\n` +
          `💰 تم خصم 100 نقطة\n` +
          `🏦 الرصيد الجديد: ${getUserPoints(userId).balance}\n\n` +
          `⚠️ البوت سيتوقف تلقائياً بعد 6 ساعات`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      });

      client.on('disconnect', (reason) => {
        removeActiveBot(userId);
        delete clients[clientKey];
      });

      client.on('error', (err) => {
        let errorMsg = `❌ خطأ: ${err.message}\n💰 تم استرجاع 100 نقطة`;
        
        addPoints(userId, 100, 'refund_error');
        removeActiveBot(userId);
        
        bot.telegram.sendMessage(userId, errorMsg).catch(() => {});
        delete clients[clientKey];
      });

    } catch (error) {
      addPoints(userId, 100, 'refund_catch');
      removeActiveBot(userId);
      ctx.reply(`❌ خطأ: ${error.message}\n💰 تم استرجاع 100 نقطة`);
    }
  } catch (error) {
    console.log('❌ خطأ في run_bot_with_check:', error.message);
    await safeAnswerCbQuery(ctx, '❌ حدث خطأ، يرجى المحاولة مرة أخرى', { show_alert: true });
  }
});

// ============== [تشغيل ذكي] ==============
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

    let lastError = null;

    for (const version of versionsToTry) {
      const protocol = PROTOCOL_MAP[version];
      if (!protocol) continue;

      try {
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
        }

      } catch (error) {
        lastError = error.message;
        continue;
      }
    }

    return {
      success: false,
      error: lastError || 'فشل جميع المحاولات',
      requestedVersion
    };

  } catch (error) {
    return {
      success: false,
      error: 'حدث خطأ داخلي',
      requestedVersion
    };
  }
}

bot.action('run_smart_with_check', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    const check = canStartBot(userId);
    
    if (!check.canStart) {
      return safeAnswerCbQuery(ctx, check.reason, { show_alert: true });
    }

    if (!servers[userId] || !servers[userId].ip) {
      return safeAnswerCbQuery(ctx, '❌ أضف السيرفر أولاً!', { show_alert: true });
    }

    const { ip, port, version = '1.21.124' } = servers[userId];

    await safeAnswerCbQuery(ctx, '🤖 جاري التشغيل الذكي...');
    
    const deducted = deductPoints(userId, 100);
    if (!deducted) {
      return safeAnswerCbQuery(ctx, '❌ خطأ في خصم النقاط!', { show_alert: true });
    }
    
    createActiveBot(userId, 1);

    ctx.reply(`🔍 بدء الاتصال الذكي:\n${ip}:${port}\nالإصدار المطلوب: ${version}\n💰 تم خصم 100 نقطة`)
      .catch(() => {});

    setTimeout(async () => {
      try {
        const result = await smartConnect(ip, port, version, userId);

        if (result.success) {
          const clientKey = `${userId}_main`;
          clients[clientKey] = result.client;

          ctx.reply(`${result.message}\n⏰ المدة: 6 ساعات\n🏦 الرصيد الجديد: ${getUserPoints(userId).balance}`).catch(() => {});

          result.client.on('join', () => {
            bot.telegram.sendMessage(userId,
              `🔥 *تم دخول البوت!*\n\n` +
              `▫️ الإصدار المستخدم: ${result.versionUsed}\n` +
              `▫️ البروتوكول: ${result.protocolUsed}\n` +
              `▫️ الحالة: ${result.versionUsed === result.requestedVersion ? 'مباشر' : 'بديل'}\n` +
              `⏰ المدة: 6 ساعات\n` +
              `⚠️ البوت سيتوقف تلقائياً بعد 6 ساعات`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          });

          result.client.on('disconnect', (reason) => {
            removeActiveBot(userId);
            delete clients[clientKey];
          });

          result.client.on('error', (err) => {
            addPoints(userId, 100, 'refund_smart_error');
            removeActiveBot(userId);
            delete clients[clientKey];
          });

        } else {
          addPoints(userId, 100, 'refund_smart_fail');
          removeActiveBot(userId);
          
          ctx.reply(
            `❌ فشل الاتصال\n\n` +
            `خطأ: ${result.error}\n` +
            `💰 تم استرجاع 100 نقطة`
          ).catch(() => {});
        }

      } catch (error) {
        console.error('🔥 خطأ في run_smart:', error.message);
        addPoints(userId, 100, 'refund_smart_catch');
        removeActiveBot(userId);
      }
    }, 100);
  } catch (error) {
    console.log('❌ خطأ في run_smart_with_check:', error.message);
    await safeAnswerCbQuery(ctx, '❌ حدث خطأ، يرجى المحاولة مرة أخرى', { show_alert: true });
  }
});

// ============== [أزرار البوت الأساسية] ==============
bot.action(/ver_(.+)/, (ctx) => {
  try {
    const version = ctx.match[1];
    const userId = ctx.from.id;

    ctx.answerCbQuery(`✅ تم اختيار ${version}`);

    servers[userId] = servers[userId] || {};
    servers[userId].version = version;
    saveServers();

    ctx.reply(`✅ الإصدار: ${version}\n\n📥 أرسل IP السيرفر وPort:\nمثال:\nplay.server.com:19132`);
  } catch (error) {
    console.log('❌ خطأ في اختيار الإصدار:', error.message);
  }
});

bot.action('stop_bot', (ctx) => {
  try {
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

    removeActiveBot(userId);
    
    ctx.answerCbQuery(`🛑 تم إيقاف ${stopped} بوت`);
    ctx.reply(`✅ تم إيقاف ${stopped} بوت`);
  } catch (error) {
    console.log('❌ خطأ في stop_bot:', error.message);
  }
});

bot.action('del_server', (ctx) => {
  try {
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

      removeActiveBot(userId);
      
      ctx.answerCbQuery('🗑️ تم الحذف');
      ctx.reply('✅ تم حذف السيرفر وإيقاف البوتات');
    } else {
      ctx.answerCbQuery('❌ لا يوجد سيرفر');
    }
  } catch (error) {
    console.log('❌ خطأ في del_server:', error.message);
  }
});

// ============== [أوامر جديدة للنقاط] ==============
bot.command('points', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userPoints = getUserPoints(userId);
    const activeBot = checkActiveBot(userId);
    
    let message = `💰 *نقاطك*\n\n`;
    message += `🏦 الرصيد الحالي: *${userPoints.balance} نقطة*\n`;
    message += `📈 إجمالي ما ربحته: *${userPoints.totalEarned} نقطة*\n\n`;
    
    if (activeBot) {
      message += `🤖 *بوت نشط*\n`;
      message += `⏰ المتبقي: ${activeBot.remainingHours} ساعة\n`;
      message += `⏱️ المدة: 6 ساعات\n\n`;
    }
    
    message += `🎯 *تكلفة التشغيل:* 100 نقطة\n`;
    message += `⏰ *مدة التشغيل:* 6 ساعات\n\n`;
    message += `🔗 *للحصول على نقاط:*\n`;
    message += `• تابع قناة البوت للحصول على الروابط\n`;
    message += `• كل رابط يعطيك 100 نقطة\n`;
    message += `• الروابط تتجدد كل 24 ساعة`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('📢 قناة البوت للروابط', 'https://t.me/+c7sbwOViyhNmYzAy')],
      [Markup.button.callback('🤖 تشغيل بوت جديد', 'start_bot_with_points')],
      [Markup.button.callback('📊 إحصائيات مفصلة', 'detailed_stats')]
    ]);
    
    ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.log('❌ خطأ في أمر points:', error.message);
  }
});

bot.command('bonus', async (ctx) => {
  try {
    ctx.reply(`🎁 *للحصول على نقاط مجانية*\n\n` +
      `🔗 تابع قناة البوت للحصول على الروابط:\n` +
      `https://t.me/+c7sbwOViyhNmYzAy\n\n` +
      `💡 *كيفية الاستخدام:*\n` +
      `1. احصل على رابط من القناة\n` +
      `2. اضغط على الرابط\n` +
      `3. احصل على 100 نقطة مجانية\n` +
      `4. استخدم النقاط لتشغيل البوت لمدة 6 ساعات`, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.log('❌ خطأ في أمر bonus:', error.message);
  }
});

// ============== [إدارة الأخطاء] ==============
bot.catch((err, ctx) => {
  console.error('❌ خطأ غير معالج في البوت:', err.message);
  console.error(err.stack);
  try {
    ctx.reply('❌ حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.');
  } catch (e) {}
});

// ============== [تشغيل البوت] ==============
console.log('🔍 بدء تشغيل البوت...');
console.log('💰 نظام النقاط مفعل - كل بوت يكلف 100 نقطة لمدة 6 ساعات');
console.log('🔗 الروابط: كل رابط يستخدم مرة واحدة فقط');

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ['message', 'callback_query']
})
.then(() => {
  console.log('🚀 البوت يعمل الآن!');
  console.log('🎯 المميزات المضافة:');
  console.log('• نظام نقاط (100 نقطة للتشغيل)');
  console.log('• 5 روابط مكافآت (كل رابط يستخدم مرة واحدة)');
  console.log('• تشغيل لمدة 6 ساعات ثم توقف تلقائي');
  console.log('• لوحة أدمن كاملة مع جميع المميزات');
  console.log('• معالجة أخطاء محسنة');
  
  console.log('\n🔗 روابط المكافآت الجاهزة:');
  Object.keys(DEFAULT_BONUS_LINKS).forEach(code => {
    console.log(`  https://t.me/IBR_Atrenos_bot?start=${code}`);
  });
})
.catch((err) => {
  console.error('❌ خطأ في تشغيل البوت:', err.message);
});

// تمكين إيقاف البوت بشكل أنيق
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
