# Codex UI Lite

Codex UI Lite 是一个面向 Codex 的轻量中文项目管理、Markdown 文件编辑和远程终端界面。它可以作为网页端使用，也可以通过 Capacitor 打包成 Android APK，在手机上连接当前电脑的 Codex 工作环境。

> 非官方项目。它不是 OpenAI 或 Codex 官方产品，也不复制 ClaudeCodeUI 的源码；当前实现是围绕“项目管理、文件读取编辑、终端远程控制”做的轻量版本。

## 功能

- 从当前电脑的 Codex 桌面端工作区读取项目列表。
- 通过账号密码登录，不使用扫码或配对码。
- 打开项目后可查看项目文件夹。
- 支持读取和编辑 Markdown 文件。
- 一个项目可打开多个终端窗口。
- 刷新网页或手机端页面不会关闭后端终端，会自动重连并回放最近输出缓存。
- 可打包 Android APK，手机端作为远程控制界面使用。

## 架构

- `apps/server`: Node.js API、账号密码登录、项目读取、Markdown 文件接口和终端 WebSocket。
- `apps/client`: React/Vite 中文界面，并通过 Capacitor 打包 Android。
- `packages/shared`: 前后端共用的 TypeScript API 类型。

APK 只是客户端。项目文件、终端进程和 `codex` CLI 都运行在可信电脑上的后端服务中。

## 快速启动

```bash
npm install
npm run build
npm run dev
```

默认地址：

- 网页端: `http://localhost:5177`
- 服务端: `http://localhost:4177`

首次打开时会进入管理员账号设置页，创建用户名和密码后自动登录。之后网页端和手机端都使用这个账号密码登录。

## 服务端配置

复制示例配置：

```bash
cp apps/server/.env.example apps/server/.env
```

可用配置：

```bash
PORT=4177
HOST=0.0.0.0
DATA_DIR=./data
CODEX_COMMAND=codex
AUTH_DISABLED=false
```

## Android APK

本地环境需要：

- Node.js 20+
- JDK 17 或更高
- Android Studio
- Android SDK Platform 36
- Android SDK Build-Tools、Platform-Tools、Command-line Tools

构建 Debug APK：

```bash
npm run android:debug
```

APK 输出位置：

```text
apps/client/android/app/build/outputs/apk/debug/app-debug.apk
```

手机端安装后填写电脑后端地址，例如 `http://192.168.0.108:4177`，再输入账号密码登录。手机和电脑需要处在同一个局域网，或后端地址能被手机访问。

## GitHub Actions

仓库内置两个 workflow：

- `CI`: 推送或 PR 时运行类型检查和构建。
- `Android Debug APK`: 手动触发，构建并上传 Debug APK artifact。

## 安全说明

- 不要提交 `data/`、`apps/server/data/`、`.env`、日志文件、签名证书或 `google-services.json`。
- 后端会暴露本机项目文件和终端能力，只建议在可信局域网或受保护网络中使用。
- 公开部署前建议启用反向代理 HTTPS，并限制访问来源。

## License

MIT
