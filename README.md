# NapCat Channel Plugin for Clawdbot

NapCat 频道插件，为 [Clawdbot](https://github.com/moltbot/moltbot) 提供 QQ 个人号（基于 OneBot 11 协议）支持。

本插件基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 或其他兼容 OneBot 11 (原 CQHTTP) 协议的实现。

## 功能特性

- **WebSocket/HTTP 双向支持**：
  - HTTP 模式：用于高性能消息发送和**文件下载**（强烈推荐，尤其是分离部署时）。
  - WebSocket 模式：用于实时消息接收和事件监听。
- **消息类型支持**：
  - **文本消息**：群聊和私聊文本收发。
  - **图片消息**：支持双向图片传输。
  - **文件消息**：支持**文件接收**（支持文档、压缩包等）和发送。
    - 接收时：自动通过 NapCat 专用接口 (`/get_group_file_url` 或 `/get_private_file_url`) 获取下载直链，支持跨容器/远程下载。
    - 发送时：根据文件类型自动选择 `image` 或 `file` 类型发送。
- **管理员控制**：支持通过 `adminUins` 配置白名单，仅允许特定用户触发机器人。
- **灵活部署**：完美支持 Docker 等容器化分离部署场景。

## 前置要求

1. 已安装并运行 [Clawdbot](https://github.com/moltbot/moltbot)。
2. 已部署 NapCat 或其他 OneBot 11 兼容端。
   - **必须开启 WebSocket 服务**（用于接收消息）。
   - **必须开启 HTTP 服务**（用于获取文件下载链接，否则无法接收文件）。

## 安装

```bash
# 进入插件目录
cd /home/pokers/clawd/plugins-workspaces/napcat-channel

# 安装依赖
npm install

# 构建
npm run build
```

作为本地插件安装到 Clawdbot：

```bash
clawdbot plugins install -l /home/pokers/clawd/plugins-workspaces/napcat-channel
clawdbot plugins enable napcat-channel
```

## 配置

在 Clawdbot 配置文件 (`~/.clawdbot/clawdbot.json`) 中添加配置。

### 标准配置 (WS + HTTP)

为了获得完整的文件收发能力，请务必同时配置 `wsUrl` 和 `httpUrl`：

```json
{
  "channels": {
    "napcat-channel": {
      "wsUrl": "ws://127.0.0.1:3001",
      "httpUrl": "http://127.0.0.1:3000",
      "token": "your-access-token",
      "adminUins": [
        123456789
      ]
    }
  }
}
```

- **wsUrl**: NapCat 的正向 WebSocket 地址。
- **httpUrl**: NapCat 的 HTTP API 地址（用于获取文件直链）。
- **token**: 访问令牌（可选，若 NapCat 配置了则必填）。
- **adminUins**: 管理员 QQ 号列表（可选，配置后仅响应白名单用户）。

## 使用

配置完成后，重启 Clawdbot Gateway：

```bash
clawdbot gateway restart
```

### 文件传输说明

- **发送文件**：直接回复文件路径（或使用 Clawdbot 的 `MEDIA:` 语法），插件会自动判断文件类型并发送。
- **接收文件**：当收到群文件或私聊文件时，插件会自动调用 NapCat 的专用接口获取下载链接。只要 `httpUrl` 配置正确且 NapCat HTTP 服务可访问，即可在 Clawdbot 中直接读取和解析文件内容。

## 项目结构

```
napcat-channel/
├── package.json            # NPM 包配置
├── tsconfig.json           # TypeScript 配置
├── clawdbot.plugin.json    # Clawdbot 插件声明
├── index.ts                # 插件入口
└── src/
    ├── channel.ts          # 核心逻辑：消息收发、文件 URL 解析
    ├── runtime.ts          # WebSocket 运行时与事件分发
    ├── types.ts            # OneBot 11 类型定义
    ├── sdk-types.ts        # Clawdbot SDK 类型声明
    └── api/
        └── client.ts       # API 客户端 (HTTP 请求封装)
```

## 常见问题

**Q: 为什么我收到的文件无法解析？**
A: 请检查是否配置了 `httpUrl`。在 Docker 等分离部署环境中，NapCat 返回的默认文件路径通常是容器内路径，外部无法访问。必须通过 HTTP 接口 (`/get_group_file_url` 等) 获取可供下载的直链。

**Q: 发送文件时文件名是乱码/UUID？**
A: 插件已优化发送逻辑，在发送非图片文件时会自动带上原始文件名。但最终显示效果仍取决于接收端（QQ）的处理。

## 许可证

MIT
