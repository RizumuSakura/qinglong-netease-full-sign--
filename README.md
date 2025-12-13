# 🎵 网易云音乐自动签到

网易云音乐全自动签到脚本，支持青龙面板运行。

## ✨ 功能

- ✅ **普通签到** - PC端 + 安卓端
- ✅ **云贝签到** - 获取云贝
- ✅ **云贝签到进度** - 自动领取连续签到奖励
- ✅ **云贝日常任务** - 自动完成并领取云贝
- ✅ **黑胶乐签** - 每日+3成长值（VIP专属日历打卡）
- ✅ **VIP成长任务** - 自动领取已完成的日常任务奖励
- ✅ **VIP奖励领取** - 一键领取所有可领取的成长值

## � 青龙面板部署教程

> 具体部署请参考 [青龙面板官方项目](https://github.com/whyour/qinglong)

### 1. 安装青龙面板

如果还没有安装青龙面板，使用Docker安装：

```bash
docker run -dit \
  -v $PWD/ql/data:/ql/data \
  -p 5700:5700 \
  --name qinglong \
  --hostname qinglong \
  --restart unless-stopped \
  whyour/qinglong:latest
```

访问 `http://你的IP:5700` 完成初始化设置。

### 2. 添加脚本（订阅仓库）

1. 进入青龙面板 → 订阅管理
2. 点击 `新建订阅`
3. 填写：
   - 名称：`网易云签到`
   - 链接：`https://github.com/YiQing-House/qinglong-netease-full-sign--`
   - 定时规则：`0 9 * * *`
4. 点击确定，等待拉取完成

### 3. 添加环境变量

1. 进入青龙面板 → 环境变量
2. 点击 `新建变量`
3. 名称：`NETEASE_MUSIC_U`
4. 值：你的 MUSIC_U cookie值
5. 点击确定保存

**（可选）配置TG通知：**

| 变量名 | 说明 | 获取方式 |
|--------|------|----------|
| `TG_BOT_TOKEN` | 机器人Token | @BotFather 创建机器人获取 |
| `TG_USER_ID` | 你的用户ID | 给 @userinfobot 发消息获取 |

> ⚠️ 配置后需要先给机器人发一条消息，否则机器人无法主动给你发消息

### 4. 添加定时任务

1. 进入青龙面板 → 定时任务
2. 点击 `新建任务`
3. 填写：
   - 名称：`网易云音乐签到`
   - 命令：`task ql_netease_full_sign.js`
   - 定时规则：`0 9 * * *`（每天早上9点）
4. 保存后点击运行测试

## 🔑 获取 MUSIC_U

1. 浏览器登录 [网易云音乐](https://music.163.com/)
2. 按 F12 打开开发者工具
3. 切换到 Application/存储 → Cookies
4. 找到 `MUSIC_U` 字段，复制其值

## 📸 运行效果

```
🎵 网易云音乐完整签到
时间：20xx/xx/xx xx:xx:xx

🔐 检查登录状态...
   ✅ 用户：xxx

📝 普通签到...
   ✅ 安卓端签到成功！

☁️ 云贝签到...
   ✅ 云贝签到成功！

💎 黑胶乐签打卡...
   ✅ 黑胶乐签打卡成功！+3成长值

📊 VIP成长值...
   等级：黑胶·x
   成长值：xxxx

🎁 领取VIP任务奖励...
   ✅ VIP任务奖励领取成功！

🎉 所有签到任务完成！
```

## ⚠️ 免责声明

1. 本项目仅供学习交流使用，**请勿用于商业用途**
2. 使用本脚本造成的任何后果由使用者自行承担
3. 本项目不存储、不上传任何用户数据
4. 如有侵权请联系删除
5. 使用前请确认遵守[网易云音乐用户服务条款](https://st.music.163.com/official-terms/service)

## 🔒 安全说明

- 脚本**不会**收集或上传你的cookie信息
- MUSIC_U cookie 通过环境变量读取，**不会**硬编码在脚本中
- 建议定期更换cookie（重新登录获取新的）
- 请妥善保管你的cookie，不要泄露给他人

## 🙏 致谢

本项目参考了以下开源项目：

- [chaunsin/netease-cloud-music](https://github.com/chaunsin/netease-cloud-music) - Golang API实现
- [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) - Node.js API服务
- [whyour/qinglong](https://github.com/whyour/qinglong) - 青龙面板

感谢 **Claude Opus 4.5** 对本项目开发的支持 🤖

## 📄 许可证

[MIT License](LICENSE)
