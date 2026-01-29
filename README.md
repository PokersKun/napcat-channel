# NapCat Channel Plugin for Clawdbot

NapCat 频道插件，为 [Clawdbot](https://github.com/moltbot/moltbot) 提供 QQ 个人号（基于 OneBot 11 协议）支持。

本插件基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 或其他兼容 OneBot 11 (原 CQHTTP) 协议的实现。

## 功能特性

- **WebSocket/HTTP 双向支持**：
  - HTTP 模式：用于高性能消息发送（可选，推荐配置）。
  - WebSocket 模式：用于实时消息接收和事件监听，并在 HTTP 未配置时自动降级用于发送消息。
- **灵活部署**：支持正向 WebSocket 连接。
- **消息类型**：支持群聊消息和私聊消息。
- **管理员控制**：支持通过 `adminUins` 配置白名单，仅允许特定用户触发机器人。
- **多媒体支持**：支持发送图片消息。
- **集成 Clawdbot**：无缝对接 Clawdbot AI 回复系统。

## 前置要求

1. 已安装并运行 [Clawdbot](https://github.com/moltbot/moltbot)。
2. 已部署 NapCat 或其他 OneBot 11 兼容端（如 Go-CQHTTP）。
   - NapCat 需要开启 WebSocket 服务。
   - 推荐同时开启 HTTP 服务以获得更好的发送性能。

## 安装

```bash
# 进入插件目录
cd /home/pokers/clawd/plugins-workspaces/napcat-channel

# 安装依赖
npm install

# 构建
npm run build
```

如果作为本地插件安装到 Clawdbot：

```bash
clawdbot plugins install -l /home/pokers/clawd/plugins-workspaces/napcat-channel
clawdbot plugins enable napcat-channel
```

## 配置

在 Clawdbot 配置文件 (`~/.clawdbot/clawdbot.json`) 中添加配置。

### 最小配置 (仅 WebSocket)

适用于只有 WebSocket 端口的情况：

```json
{
  "channels": {
    "napcat-channel": {
      "wsUrl": "ws://127.0.0.1:3001",
      "token": "your-access-token"
    }
  }
}
```

### 推荐配置 (WS + HTTP)

适用于同时开启了 HTTP 和 WS 的标准部署，性能更佳：

```json
{
  "channels": {
    "napcat-channel": {
      "wsUrl": "ws://127.0.0.1:3001",
      "httpUrl": "http://127.0.0.1:3000",
      "token": "your-access-token"
    }
  }
}
```

### 私有化配置 (管理员白名单)

仅允许特定 QQ 号触发机器人：

```json
{
  "channels": {
    "napcat-channel": {
      "wsUrl": "ws://127.0.0.1:3001",
      "httpUrl": "http://127.0.0.1:3000",
      "adminUins": [
        123456789,
        987654321
      ]
    }
  }
}
```

或使用命令行配置：

```bash
clawdbot config set channels.napcat-channel.wsUrl "ws://127.0.0.1:3001"
clawdbot config set channels.napcat-channel.httpUrl "http://127.0.0.1:3000"
```

## 使用

配置完成后，重启 Clawdbot Gateway：

```bash
clawdbot gateway restart
```

查看状态：

```bash
clawdbot channels status
```

在 QQ 群中 @机器人 或私聊机器人即可触发 AI 回复。

## 项目结构

```
napcat-channel/
├── package.json            # NPM 包配置
├── tsconfig.json           # TypeScript 配置
├── clawdbot.plugin.json    # Clawdbot 插件声明
├── index.ts                # 插件入口
└── src/
    ├── channel.ts          # ChannelPlugin 实现与配置解析
    ├── runtime.ts          # WebSocket 运行时与事件分发
    ├── types.ts            # OneBot 11 类型定义
    ├── sdk-types.ts        # Clawdbot SDK 类型声明
    └── api/
        └── client.ts       # API 客户端 (支持 HTTP 与 WS 降级)
```

## API 说明

### OneBot 11 事件支持

| 事件类型 | post_type | 说明 |
|----------|-----------|------|
| 群消息 | `message` (group) | 监听群聊消息，支持 @ 触发 |
| 私聊消息 | `message` (private) | 监听私聊消息 |
| 生命周期 | `meta_event` (lifecycle) | 监听连接状态 |

### 内部路由

Clawdbot 内部使用以下格式标识会话：

- **群聊**: `napcat-channel:group:{group_id}`
- **私聊**: `napcat-channel:private:{user_id}`

## 开发与调试

```bash
# 开启 TypeScript 监听构建
npm run watch
```

调试时建议查看控制台日志：

- `[NapCat] WebSocket connected` - 连接成功
- `[NapCat] Received ...` - 收到消息日志
- `[NapCat] Sending reply ...` - 发送回复日志

## 注意事项

1. **Token 鉴权**：如果 NapCat 配置了 `access_token`，必须在插件配置中填写 `token` 字段，否则连接会被拒绝。
2. **消息过滤**：默认情况下，机器人会响应所有接收到的私聊和群聊 @ 消息。建议在生产环境配置 `adminUins` 以限制使用权限。
3. **WS 降级**：当未配置 `httpUrl` 时，发送消息会通过 WebSocket 的 API 调用（带 `echo` 字段）实现。

## 许可证

MIT
