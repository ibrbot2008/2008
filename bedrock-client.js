const bedrock = require('bedrock-protocol');
const readline = require('readline');

// إنشاء واجهة للإدخال
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// دالة لسؤال المستخدم
function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// قائمة الإصدارات المدعومة
const SUPPORTED_VERSIONS = {
    '1.21.131': 871,
    '1.21.130': 870,
    '1.21.124': 860,
    '1.21.123': 859,
    '1.21.120': 859,
    '1.21.111': 844,
    '1.21.100': 827,
    "1.21.90": 818,
    "1.21.80": 800,
    "1.21.70": 786,
    "1.21.60": 776,
    "1.21.50": 766,
    "1.21.42": 748,
    "1.21.30": 729,
    "1.21.20": 712,
    "1.21.2": 686,
    "1.21.0": 685,
    "1.20.80": 671,
    "1.20.71": 662,
    "1.20.61": 649,
    "1.20.50": 630,
    "1.20.40": 622,
    "1.20.30": 618,
    "1.20.10": 594,
    "1.20.0": 589,
    "1.19.80": 582,
    "1.19.70": 575,
    "1.19.63": 568,
    "1.19.50": 560,
    "1.19.30": 554,
    "1.19.20": 544,
    "1.19.1": 527,
    "1.18.30": 503,
    "1.18.0": 475,
    "1.17.10": 448,
    "1.16.201": 422
};

async function startClient() {
    console.log('🎮 ================================');
    console.log('🎮   Minecraft Bedrock Bot Client');
    console.log('🎮 ================================\n');

    try {
        // الحصول على البيانات من المستخدم
        const serverIp = await askQuestion('🌐 أدخل IP السيرفر: ');
        const serverPort = parseInt(await askQuestion('🔌 أدخل البورت (default: 19132): ') || '19132');
        const username = await askQuestion('🤖 أدخل اسم البوت: ');
        
        // عرض قائمة الإصدارات
        console.log('\n📋 الإصدارات المدعومة:');
        Object.keys(SUPPORTED_VERSIONS).forEach((version, index) => {
            if (index % 3 === 0) process.stdout.write('\n');
            process.stdout.write(`${version.padEnd(12)} `);
        });
        
        const version = await askQuestion('\n\n🎮 أدخل نسخة السيرفر (مثال: 1.20.80): ');
        
        if (!SUPPORTED_VERSIONS[version]) {
            console.log(`❌ الإصدار ${version} غير مدعوم.`);
            console.log('ℹ️ جاري استخدام الإصدار 1.20.80 كإفتراضي...');
            version = '1.20.80';
        }

        rl.close();
        
        console.log(`\n🚀 جاري الاتصال بـ ${serverIp}:${serverPort}...`);
        connectToServer(serverIp, serverPort, username, version);
        
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        rl.close();
        process.exit(1);
    }
}

let hasRetried = false;

function connectToServer(serverIp, serverPort, username, version) {
    console.log(`🔗 محاولة الاتصال...`);

    try {
        const client = bedrock.createClient({
            host: serverIp,
            port: serverPort,
            username: username,
            version: version,
            offline: true,
            connectTimeout: 10000,
            skipPing: false
        });

        client.on('spawn', () => {
            console.log(`✅ ${username} متصل بنجاح!`);
            console.log('📊 معلومات الاتصال:');
            console.log(`   📍 السيرفر: ${serverIp}:${serverPort}`);
            console.log(`   🤖 اسم البوت: ${username}`);
            console.log(`   🎮 الإصدار: ${version}`);
            console.log('\n💡 اضغط Ctrl+C لإيقاف البوت\n');
        });

        client.on('disconnect', (packet) => {
            console.log(`🔌 ${username} تم فصله. السبب: ${packet.reason}`);
            
            const reason = packet.reason.toLowerCase();
            const isKick = reason.includes('kick') || reason.includes('ban');

            if (isKick && !hasRetried) {
                hasRetried = true;
                console.log('🔄 تم طرد البوت. جاري إعادة الاتصال بعد 5 ثواني...');
                setTimeout(() => connectToServer(serverIp, serverPort, username, version), 5000);
            } else {
                if (isKick) console.log('❌ تم إعادة المحاولة مسبقاً. الخروج...');
                else console.log('👋 الخروج من البرنامج.');
                process.exit(0);
            }
        });

        client.on('error', (err) => {
            console.error(`⚠️ خطأ: ${err.message}`);
            
            if (!hasRetried) {
                hasRetried = true;
                console.log('🔄 جاري إعادة الاتصال بعد 5 ثواني...');
                setTimeout(() => connectToServer(serverIp, serverPort, username, version), 5000);
            } else {
                console.error('❌ فشلت محاولة إعادة الاتصال. الخروج...');
                process.exit(1);
            }
        });

        // إرسال رسالة في الشات كل دقيقة
        setInterval(() => {
            try {
                client.queue('text', {
                    type: 'chat',
                    needs_translation: false,
                    source_name: username,
                    message: '🤖 البوت شغال باستمرار!',
                    xuid: '',
                    platform_chat_id: ''
                });
                console.log('💬 تم إرسال رسالة في الشات');
            } catch (e) {
                // تجاهل الأخطاء في إرسال الرسائل
            }
        }, 60000);

    } catch (error) {
        console.error(`❌ فشل إنشاء الاتصال: ${error.message}`);
        
        if (!hasRetried) {
            hasRetried = true;
            console.log('🔄 جاري إعادة المحاولة بعد 5 ثواني...');
            setTimeout(() => connectToServer(serverIp, serverPort, username, version), 5000);
        } else {
            console.error('❌ فشلت محاولة إعادة الاتصال. الخروج...');
            process.exit(1);
        }
    }
}

// إغلاق نظيف
process.on('SIGINT', () => {
    console.log('\n👋 تم إيقاف البوت. مع السلامة!');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 تم إنهاء البوت.');
    process.exit(0);
});

// تشغيل الواجهة
if (require.main === module) {
    startClient();
}

// تصدير الدالة للاستخدام من ملفات أخرى
module.exports = { connectToServer };