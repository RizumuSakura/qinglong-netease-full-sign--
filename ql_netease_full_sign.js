/**
 * 网易云音乐自动签到脚本
 * 
 * @description 支持青龙面板的全自动签到脚本（修复云贝余额、任务防误报、旧版签到降级）
 * @version 1.2.0
 * @license MIT
 */

const https = require('https');
const crypto = require('crypto');

// 环境变量解析（兼容 MUSIC_U 纯 Token 与整串 Cookie）
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

        const os = extra.os || 'pc';
        const appver = extra.appver || (os === 'android' ? '8.9.70' : '2.10.6');

        const options = {
            hostname: hostname,
            port: 443,
            path: path,
            method: 'POST',
            timeout: 15000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Cookie': `MUSIC_U=${musicU}; __csrf=${csrfToken}; os=${os}; appver=${appver};`,
                'User-Agent': os === 'android'
                    ? 'NeteaseMusic/8.9.70 (Android 12; Pixel 6)'
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

// 接口定义
async function getUserInfo() {
    return await request('music.163.com', '/weapi/nuser/account/get', {});
}

// 旧版普通签到（已下线，保留仅作兼容测试）
async function dailySign(type = 0) {
    const os = type === 0 ? 'android' : 'pc';
    return await request('music.163.com', '/weapi/point/dailyTask', { type }, { os });
}

// 云贝打卡
async function yunbeiSign() {
    return await request('music.163.com', '/weapi/pointmall/user/sign', {});
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

// 完成/领取云贝任务
async function yunbeiTaskFinish(period, userTaskId, depositCode) {
    return await request('music.163.com', '/weapi/usertool/task/point/receive', {
        period: String(period),
        userTaskId: String(userTaskId),
        depositCode: depositCode ? String(depositCode) : ''
    });
}

// 云贝余额标准接口
async function getYunbeiInfo() {
    // 优先使用云贝商城端点
    let res = await request('music.163.com', '/weapi/pointmall/user/info', {});
    if (res.code === 200 && (res.data?.balance !== undefined || res.data?.userPoint !== undefined)) {
        return res;
    }
    // 降级使用移动端接口
    return await request('music.163.com', '/weapi/v1/user/info', {}, { os: 'android' });
}

// 黑胶乐签
async function vipSign() {
    return await request('interface3.music.163.com', '/weapi/vip-center-bff/task/sign', {});
}

// VIP 任务列表与领取
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

async function main() {
    console.log('🎵 网易云音乐完整签到');
    console.log('时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    console.log('='.repeat(50));

    let message = '';

    try {
        // 1. 登录验证
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

        // 2. 旧版普通签到（废弃接口降级展示）
        console.log('\n📝 旧版普通签到（官方已下线积分系统，仅作连通测试）...');
        const androidSign = await dailySign(0);
        if (androidSign.code === 200) {
            console.log(`   ℹ️ 安卓端已连通（旧积分系统已清退，返回 ${androidSign.point || 0} 积分）`);
        } else if (androidSign.code === -2) {
            console.log('   ℹ️ 安卓端今日已签过');
        }

        const pcSign = await dailySign(1);
        if (pcSign.code === 200) {
            console.log(`   ℹ️ PC端已连通（获得 ${pcSign.point || 0} 积分）`);
        } else if (pcSign.code === 403 || pcSign.code === -2) {
            console.log('   ℹ️ PC端旧签到接口已被网易云官方下线关闭 (403)');
        }

        // 3. 云贝签到
        console.log('\n☁️ 云贝签到...');
        const yunbei = await yunbeiSign();
        if (yunbei.code === 200) {
            const gain = yunbei.point || yunbei.data?.point || (typeof yunbei.data === 'number' ? yunbei.data : 0);
            if (gain > 0) {
                console.log(`   ✅ 云贝签到成功！+${gain}云贝`);
                message += `✅ 云贝签到成功 (+${gain}云贝)\n`;
            } else if (yunbei.data === false) {
                console.log('   ⚠️ 云贝今日已签到');
                message += '⚠️ 云贝今日已签到\n';
            } else {
                console.log('   ✅ 云贝签到成功');
                message += '✅ 云贝签到成功\n';
            }
        } else if (yunbei.code === -2 || yunbei.msg?.includes('重复') || yunbei.message?.includes('已签到')) {
            console.log('   ⚠️ 云贝今日已签到');
            message += '⚠️ 云贝今日已签到\n';
        } else {
            console.log(`   ⚠️ 云贝签到状态：${yunbei.msg || yunbei.message || '未知'}`);
        }

        // 3.1 连签奖励
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
                else console.log('   ℹ️ 暂无连签奖励可领');
            }
        } catch (e) {}

        // 3.2 云贝日常任务
        console.log('\n📋 云贝日常任务...');
        try {
            const tasks = await yunbeiTaskTodo();
            if (tasks.code === 200 && Array.isArray(tasks.data)) {
                let taskCount = 0;
                for (const task of tasks.data) {
                    // 仅当任务已完成且未实际领取时调用
                    if (task.completed && !task.received) {
                        const finish = await yunbeiTaskFinish(task.period, task.userTaskId || task.taskId, task.depositCode);
                        // 网易云以 finish.data === true 判定真实领取成功
                        if (finish.code === 200 && (finish.data === true || finish.data?.success)) {
                            console.log(`   ✅ [${task.taskName}] 领取成功，+${task.taskPoint || 0}云贝`);
                            taskCount++;
                        }
                    }
                }
                if (taskCount > 0) message += `✅ 云贝任务领取×${taskCount}\n`;
                else console.log('   ℹ️ 暂无可领取的日常任务奖励');
            }
        } catch (e) {}

        // 3.3 准确获取云贝余额
        try {
            const info = await getYunbeiInfo();
            let balance = null;
            if (info.code === 200) {
                if (typeof info.data?.balance === 'number') balance = info.data.balance;
                else if (typeof info.data?.userPoint?.balance === 'number') balance = info.data.userPoint.balance;
                else if (typeof info.userPoint?.balance === 'number') balance = info.userPoint.balance;
            }
            if (balance !== null) {
                console.log(`   💰 云贝当前真实余额：${balance}`);
                message += `☁️ 云贝余额：${balance}\n`;
            } else {
                console.log(`   ⚠️ 无法解析云贝余额字段`);
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

        // 5. VIP 成长任务
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

        // 6. VIP 状态与一键奖励
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
            console.log('   ✅ VIP任务奖励领取成功！');
            message += '✅ VIP任务奖励已领取\n';
        } else {
            console.log('   ℹ️ 暂无可领取的VIP奖励');
        }

        console.log('\n' + '='.repeat(50));
        console.log('🎉 所有流程执行完毕！');
        message += '\n🎉 签到完成！';

    } catch (error) {
        console.log(`\n❌ 运行错误：${error.message}`);
        message = `❌ 签到出错：${error.message}`;
    }

    await notify.sendNotify('🎵 网易云音乐签到', message);
}

main();
