/**
 * 网易云音乐自动签到脚本
 * 
 * @description 支持青龙面板的全自动签到脚本（增加云贝先查后签逻辑、修复风控假死）
 * @version 1.3.2 (Fix & Optimize)
 * @license MIT
 */

const https = require('https');
const crypto = require('crypto');

// 环境变量解析（兼容纯 Token 与完整 Cookie 串）
const rawEnvCookie = process.env.NETEASE_MUSIC_U || '';

if (!rawEnvCookie) {
    console.log('❌ 请设置环境变量 NETEASE_MUSIC_U');
    process.exit(1);
}

let musicU = rawEnvCookie.trim();
const uMatch = rawEnvCookie.match(/MUSIC_U=([^;]+)/);
if (uMatch) musicU = uMatch[1];

const csrfMatch = rawEnvCookie.match(/__csrf=([^;]+)/);
const csrfToken = csrfMatch ? csrfMatch[1] : '';

// 提取或生成 deviceId，对抗风控假死
const deviceIdMatch = rawEnvCookie.match(/deviceId=([^;]+)/);
let deviceId = deviceIdMatch ? deviceIdMatch[1] : '';
if (!deviceId) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 32; i++) {
        deviceId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
}

let notify;
try {
    notify = require('./sendNotify');
} catch (e) {
    notify = {
        sendNotify: async (title, content) => {
            console.log(`📢 ${title}\n${content}`);
        }
    };
}

// 加密配置
const presetKey = '0CoJUm6Qyw8W8jud';
const iv = '0102030405060708';
const publicKey = '010001';
const modulus = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';

function aesEncrypt(text, key) {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    return cipher.update(text, 'utf8', 'base64') + cipher.final('base64');
}

function modPow(base, exp, mod) {
    let res = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp % 2n === 1n) res = (res * base) % mod;
        base = (base * base) % mod;
        exp = exp / 2n;
    }
    return res;
}

function rsaEncrypt(text, pubKey, mod) {
    const reversedText = text.split('').reverse().join('');
    const hexText = Buffer.from(reversedText).toString('hex');
    const base = BigInt('0x' + hexText);
    const exp = BigInt('0x' + pubKey);
    const m = BigInt('0x' + mod);
    return modPow(base, exp, m).toString(16).padStart(256, '0');
}

function generateSecretKey(size) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < size; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function encryptRequest(data) {
    const payload = { ...data };
    if (!('csrf_token' in payload)) payload.csrf_token = csrfToken;
    const text = JSON.stringify(payload);
    const secretKey = generateSecretKey(16);
    const params = aesEncrypt(aesEncrypt(text, presetKey), secretKey);
    const encSecKey = rsaEncrypt(secretKey, publicKey, modulus);
    return { params, encSecKey };
}

function request(hostname, path, data = {}, extra = {}) {
    return new Promise((resolve) => {
        const encrypted = encryptRequest(data);
        const postData = `params=${encodeURIComponent(encrypted.params)}&encSecKey=${encodeURIComponent(encrypted.encSecKey)}`;

        const os = extra.os || 'android'; 
        // 升级 App 版本号，避免低版本被风控静默拦截
        const appver = extra.appver || (os === 'android' ? '9.0.70' : '3.0.0');

        const options = {
            hostname: hostname,
            port: 443,
            path: path,
            method: 'POST',
            timeout: 15000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                // 注入设备ID模拟真实环境
                'Cookie': `MUSIC_U=${musicU}; __csrf=${csrfToken}; os=${os}; appver=${appver}; deviceId=${deviceId};`,
                'User-Agent': os === 'android'
                    ? `NeteaseMusic/${appver} (Android 12; Pixel 6)`
                    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://music.163.com/',
                'Origin': 'https://music.163.com'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve({ code: -1, body });
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ code: -1, message: '请求超时' });
        });

        req.on('error', (err) => {
            resolve({ code: -1, message: err.message });
        });

        req.write(postData);
        req.end();
    });
}

// ================= 接口方法定义 =================

async function getUserInfo() {
    return await request('music.163.com', '/weapi/nuser/account/get', {});
}

async function dailySign(type = 0) {
    const os = type === 0 ? 'android' : 'pc';
    return await request('music.163.com', '/weapi/point/dailyTask', { type }, { os });
}

// 检查今日云贝是否已签到（先查后签逻辑）
async function checkYunbeiSignToday() {
    try {
        const res = await request('music.163.com', '/weapi/pointmall/user/sign/today', {});
        if (res.code === 200 && res.data === true) {
            return true; // 确认今日已签到
        }
    } catch (e) {
        console.log(`   ⚠️ 检查云贝签到状态异常: ${e.message}`);
    }
    return false; // 未签到或异常时返回 false
}

// 执行云贝签到打卡
async function yunbeiSign() {
    // 强制加入 type: 0 参数
    return await request('music.163.com', '/weapi/pointmall/user/sign', { type: 0 });
}

// 云贝连签进度
async function yunbeiSignProgress() {
    return await request('music.163.com', '/weapi/pointmall/user/sign/progress', {});
}

async function yunbeiSignLottery(userLotteryId) {
    return await request('music.163.com', '/weapi/pointmall/user/lottery/get', { userLotteryId: String(userLotteryId) });
}

// 云贝任务列表
async function yunbeiTaskTodo() {
    return await request('music.163.com', '/weapi/usertool/task/todo/query', {});
}

// 领取云贝任务
async function yunbeiTaskFinish(period, userTaskId, depositCode) {
    return await request('music.163.com', '/weapi/usertool/task/point/receive', {
        period: String(period),
        userTaskId: String(userTaskId),
        depositCode: depositCode ? String(depositCode) : ''
    });
}

// 获取云贝账户信息
async function getYunbeiInfo() {
    let res = await request('music.163.com', '/weapi/pointmall/user/info', {});
    if (res.code === 200 && res.data) return res;
    return await request('music.163.com', '/weapi/v1/user/info', {});
}

// 解析云贝余额
function parseYunbeiBalance(info) {
    if (!info || info.code !== 200) return null;
    const candidates = [
        info.data?.userPoint,
        info.data?.balance,
        info.data?.userPoint?.balance,
        info.userPoint?.balance,
        info.userPoint,
        info.data?.totalPoint,
        info.point
    ];
    for (const val of candidates) {
        if (typeof val === 'number') return val;
    }
    return null;
}

// 黑胶乐签与 VIP 成长任务
async function vipSign() {
    return await request('interface3.music.163.com', '/weapi/vip-center-bff/task/sign', {});
}

async function getVipMissionProgress() {
    return await request('interface3.music.163.com', '/weapi/middle/vip/mission/user/progress/list', {});
}

async function receiveVipMissionReward(userRewardId, userProgressId) {
    return await request('interface3.music.163.com', '/weapi/middle/vip/mission/user/reward/receive', {
        userRewardId: String(userRewardId),
        userProgressId: String(userProgressId)
    });
}

async function getVipGrowth() {
    return await request('music.163.com', '/weapi/vipnewcenter/app/level/growhpoint/basic', {});
}

async function receiveAllVipReward() {
    return await request('music.163.com', '/weapi/vipnewcenter/app/level/task/reward/getall', {});
}

// ================= 主执行流程 =================

async function main() {
    console.log('🎵 网易云音乐自动签到');
    console.log('时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    console.log('='.repeat(50));

    let message = '';

    try {
        // 1. 登录状态验证
        console.log('\n🔐 检查登录状态...');
        const userInfo = await getUserInfo();
        const account = userInfo.account || userInfo.data?.account;
        const profile = userInfo.profile || userInfo.data?.profile;
        if (userInfo.code === 200 && (account || profile)) {
            const nickname = profile?.nickname || account?.userName || '用户';
            console.log(`   ✅ 用户：${nickname}`);
            message += `👤 用户：${nickname}\n`;
        } else {
            console.log('   ❌ 登录失败，请检查 MUSIC_U 是否有效');
            await notify.sendNotify('网易云签到失败', '登录失效，请更新 MUSIC_U');
            return;
        }

        // 2. 旧版普通签到
        console.log('\n📝 旧版普通签到（积分系统已清退，仅作通道连通）...');
        const androidSign = await dailySign(0);
        if (androidSign.code === 200) {
            console.log(`   ℹ️ 安卓端已打卡 (旧积分返回: ${androidSign.point || 0})`);
        } else if (androidSign.code === -2) {
            console.log('   ℹ️ 安卓端今日已签过');
        }

        const pcSign = await dailySign(1);
        if (pcSign.code === 200) {
            console.log(`   ℹ️ PC端已打卡 (旧积分返回: ${pcSign.point || 0})`);
        } else if (pcSign.code === 403 || pcSign.code === -2) {
            console.log('   ℹ️ PC端旧签到接口已由官方永久下线 (403)');
        }

        // 3. 云贝签到 (先查后签)
        console.log('\n☁️ 云贝签到...');
        try {
            const isSigned = await checkYunbeiSignToday();
            
            if (isSigned) {
                console.log('   ℹ️ 状态检查：云贝今日已签到，跳过请求。');
                message += '☁️ 云贝：今日已签到\n';
            } else {
                const yunbei = await yunbeiSign();
                const msg = yunbei.msg || yunbei.message || '';
                const isAlreadySigned = yunbei.code === -2 || 
                                        msg.includes('重复') || 
                                        msg.includes('已签到') || 
                                        msg.includes('已打卡') || 
                                        yunbei.data === false;

                if (yunbei.code === 200 && !isAlreadySigned) {
                    let point = 0;
                    if (typeof yunbei.point === 'number') point = yunbei.point;
                    else if (typeof yunbei.data === 'number') point = yunbei.data;
                    else if (typeof yunbei.data?.point === 'number') point = yunbei.data.point;
                    else if (typeof yunbei.data?.signPoint === 'number') point = yunbei.data.signPoint;

                    if (point > 0) {
                        console.log(`   ✅ 云贝签到成功！获得 ${point} 云贝`);
                        message += `✅ 云贝签到成功 (+${point}云贝)\n`;
                    } else {
                        console.log('   ⚠️ 云贝签到请求成功，但未返回云贝数量 (可能被风控静默)');
                        message += '⚠️ 云贝签到异常(0云贝)\n';
                    }
                } else if (isAlreadySigned) {
                    console.log('   ⚠️ 云贝今日已签到');
                    message += '⚠️ 云贝今日已签到\n';
                } else {
                    console.log(`   ⚠️ 云贝签到反馈：${msg || '接口返回异常'}`);
                }
            }
        } catch (e) {
            console.log(`   ⚠️ 云贝签到执行异常: ${e.message}`);
        }

        // 3.1 云贝连签进度奖励
        console.log('\n📅 云贝签到进度奖励...');
        try {
            const progress = await yunbeiSignProgress();
            if (progress.code === 200 && progress.data?.lotteryConfig) {
                let rewardCount = 0;
                for (const config of progress.data.lotteryConfig) {
                    const lotteryId = config.userLotteryId || config.baseLotteryId;
                    if (lotteryId && (config.baseLotteryStatus === 1 || config.status === 1)) {
                        const lottery = await yunbeiSignLottery(lotteryId);
                        if (lottery.code === 200) {
                            console.log(`   ✅ 连续签到${config.signDay || ''}天奖励领取成功`);
                            rewardCount++;
                        }
                    }
                }
                if (rewardCount > 0) message += `✅ 云贝连签奖励×${rewardCount}\n`;
                else console.log('   ℹ️ 暂无连签阶段奖励可领');
            }
        } catch (e) {}

        // 3.2 云贝日常任务
        console.log('\n📋 云贝日常任务...');
        try {
            const tasks = await yunbeiTaskTodo();
            if (tasks.code === 200 && Array.isArray(tasks.data)) {
                let taskCount = 0;
                for (const task of tasks.data) {
                    const isAdTask = task.taskName?.includes('特殊福利') || task.taskName?.includes('福利');
                    const isFinished = task.completed === true || task.status === 1;

                    if (isFinished && !task.received && !isAdTask) {
                        const finish = await yunbeiTaskFinish(task.period, task.userTaskId || task.taskId, task.depositCode);
                        const isRealSuccess = finish.code === 200 && 
                                              finish.data !== false && 
                                              finish.data !== null && 
                                              finish.data !== 0 &&
                                              !finish.msg?.includes('未完成');

                        if (isRealSuccess) {
                            console.log(`   ✅ [${task.taskName}] 领取成功，+${task.taskPoint || 0}云贝`);
                            taskCount++;
                        }
                    }
                }
                if (taskCount > 0) message += `✅ 云贝日常任务×${taskCount}\n`;
                else console.log('   ℹ️ 暂无可领取的日常任务奖励');
            }
        } catch (e) {}

        // 3.3 云贝当前余额获取
        try {
            const info = await getYunbeiInfo();
            const balance = parseYunbeiBalance(info);
            if (balance !== null) {
                console.log(`   💰 云贝当前可用余额：${balance}`);
                message += `☁️ 云贝余额：${balance}\n`;
            } else {
                console.log('   ⚠️ 未能解析到云贝余额');
            }
        } catch (e) {}

        // 4. 黑胶乐签打卡
        console.log('\n💎 黑胶乐签打卡...');
        const vipSignResult = await vipSign();
        if (vipSignResult.code === 200 && vipSignResult.data === true) {
            console.log('   ✅ 黑胶乐签打卡成功！+3成长值');
            message += '✅ 黑胶乐签成功 (+3成长值)\n';
        } else if (vipSignResult.code === 200 && vipSignResult.data === false) {
            console.log('   ⚠️ 黑胶乐签今日已打卡');
            message += '⚠️ 黑胶乐签已打卡\n';
        } else {
            console.log(`   ⚠️ 黑胶乐签：${vipSignResult.message || vipSignResult.msg || '非黑胶用户或已打卡'}`);
        }

        // 5. VIP 成长日常任务
        console.log('\n📋 VIP成长日常任务...');
        try {
            const missions = await getVipMissionProgress();
            if (missions.code === 200 && Array.isArray(missions.data)) {
                let missionCount = 0;
                let totalGrowth = 0;
                for (const mission of missions.data) {
                    if (mission.stageProgressDTOS) {
                        for (const stage of mission.stageProgressDTOS) {
                            if (stage.stageStatus === 100 && stage.userRewardId && stage.userProgressId) {
                                const claim = await receiveVipMissionReward(stage.userRewardId, stage.userProgressId);
                                if (claim.code === 200) {
                                    const taskName = mission.basicMissionDTO?.name || '任务';
                                    const worth = stage.worth || stage.rewardCount || 0;
                                    console.log(`   ✅ [${taskName}] +${worth}成长值`);
                                    missionCount++;
                                    totalGrowth += worth;
                                }
                            }
                        }
                    }
                }
                if (missionCount > 0) {
                    console.log(`   📈 共领取 ${missionCount} 个任务，+${totalGrowth}成长值`);
                    message += `✅ VIP任务×${missionCount} (+${totalGrowth})\n`;
                } else {
                    console.log('   ℹ️ 暂无可领取的VIP日常任务');
                }
            }
        } catch (e) {}

        // 6. VIP 成长值及批量奖励
        console.log('\n📊 VIP成长值...');
        const vipGrowth = await getVipGrowth();
        if (vipGrowth.code === 200 && vipGrowth.data) {
            const data = vipGrowth.data.userLevel || vipGrowth.data;
            console.log(`   等级：${data.levelName || 'Lv.' + (data.level ?? 0)}`);
            console.log(`   成长值：${data.growthPoint ?? 0}`);
            message += `\n💎 VIP等级：${data.levelName || 'Lv.' + (data.level ?? 0)}\n`;
            message += `📊 成长值：${data.growthPoint ?? 0}\n`;
        }

        const reward = await receiveAllVipReward();
        if (reward.code === 200 && reward.data?.result) {
            console.log('   ✅ VIP任务奖励一键领取成功！');
            message += '✅ VIP任务奖励已领取\n';
        } else {
            console.log('   ℹ️ 暂无可领取的VIP奖励');
        }

        console.log('\n' + '='.repeat(50));
        console.log('🎉 签到流程执行完成！');
        message += '\n🎉 签到完成！';

    } catch (error) {
        console.log(`\n❌ 运行错误：${error.message}`);
        message = `❌ 签到出错：${error.message}`;
    }

    await notify.sendNotify('🎵 网易云音乐签到', message);
}

main();
