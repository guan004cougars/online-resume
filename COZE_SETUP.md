# Coze 接入说明

## 1. 准备环境变量

复制一份配置文件：

```bash
cp .env.example .env
```

然后填写：

- `COZE_API_URL`
- `COZE_PAT`
- `COZE_BOT_ID`
- `APP_LLM_BASE_URL`
- `APP_LLM_API_KEY`
- `APP_LLM_MODEL`

说明：

- `COZE_API_URL`：从扣子 Playground / Open API 页面复制的真实请求地址
- `COZE_PAT`：你的新 PAT，不要直接写进前端
- `COZE_BOT_ID`：你的智能体 bot_id
- `APP_LLM_*`：用于 Coze 失败时的本地兜底模型，建议配置为 OpenAI 兼容接口

## 2. 启动本地服务

```bash
cd /Users/kaixiangguan/Desktop/在线JL
node server.js
```

默认访问地址：

```txt
http://127.0.0.1:8788
```

说明：

- 要先进入 `在线JL` 目录，再执行 `node server.js`
- `http://127.0.0.1:8788` 是浏览器地址，不是终端命令
- 也可以在终端执行下面这句，自动用浏览器打开：

```bash
open http://127.0.0.1:8788
```

## 3. 当前实现说明

- 前端聊天框仍然使用原来的网页 UI
- 前端现在请求 `POST /api/chat`
- `server.js` 会先把消息转发给 Coze
- 如果 Coze 返回失败，`server.js` 会自动切到本地模型兜底
- 简历问答的系统提示词只在本地兜底时注入，不会直接传给 Coze

## 4. 你还需要提供什么

如果联调失败，通常是因为扣子的真实请求格式和当前代理假设不完全一致。

这时请从扣子官方页面拿到以下任意一种发给我：

1. Playground 自动生成的 `curl`
2. Open API 页面里的请求示例
3. 请求 URL + Header + Body 示例

我就可以把 `server.js` 里的 Coze 请求体改成完全可用的正式版本。
