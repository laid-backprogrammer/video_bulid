# Agent Studio 软件实现报告

日期：2026-05-13

## 1. 本次实现范围

本次主要修复 Agent Studio 在 Kimi k2.6 流式调用、工具动作规划、场景重制流水线和前端交互上的稳定性问题，并完成 scene1 的端到端重制验证。

## 2. 核心改动

### 2.1 Kimi 流式对话适配

- Kimi k2.6 请求参数统一为：
  - `temperature: 1`
  - `max_tokens: 32768`
  - `top_p: 0.95`
  - `stream: true`
  - `thinking: {type: "enabled"}`
- 对需要结构化工具规划的请求增加 `response_format: {type: "json_object"}`。
- 服务端同时处理 `delta.reasoning_content` 和 `delta.content`。
- 修复 Kimi 在 JSON content 前连续输出空白 token 的问题：
  - UI token 不再显示前导空白。
  - 最终 JSON 会 trim 并抽取 `{...}` 后再进入 schema 解析。
- SSE 增加中断保护：
  - 前端 abort 后服务端停止 SSE 写入。
  - 上游 LLM fetch 也会收到 abort signal。

### 2.2 Agent 工具动作规划

- Agent 计划提示中增加 `available_actions` 和工具 schema。
- 当用户修改文案、要求重制、清理旧预览、或明确使用 `@alias` 素材时，强制选择 `rewrite_scene_pipeline`，避免只口头承诺、不实际写入配置。
- `rewrite_scene_pipeline` 会按顺序执行：
  - 写入文案
  - 写入/保留素材要求
  - 重新 TTS
  - 重新 ASR 对齐
  - 更新设计/微调要求
  - Remotion codegen
  - 渲染单段预览
- 当前 prompt 会覆盖旧 `tuningNotes`，避免旧的“不要使用素材”等约束继续污染新一轮生成。

### 2.3 前端交互

- Agent Studio 顶部新增：
  - `中断`
  - `清理上下文`
- `中断` 会取消当前 SSE、清空待执行动作，并将理解阶段置为 paused。
- `清理上下文` 只清空前端对话、附件草稿、日志和 trace，不删除项目文件、音频、字幕或预览产物。
- Agent 活动区新增限频 Kimi 思考流记录，避免大量 reasoning chunk 刷屏。

### 2.4 scene1 端到端修复

- scene1 文案已修正为：
  - `我来为大家介绍 Claude 和 Codex`
- scene1 两个素材已明确设为必须渲染：
  - `@截屏2026-04-28-17-07-23`：Claude 图标
  - `@截屏2026-04-28-17-07-54`：Codex 图标
- 重新生成后的 Remotion 场景代码通过 `assets.find(...id 或 alias...)` 精确选择素材，并使用 `Img + staticFile()` 渲染。
- 重新完成 TTS、ASR、manifest、codegen 和单段 MP4 预览。

## 3. 实测结果

### 3.1 命令校验

全部通过：

```bash
node --check server.mjs
npx tsc --noEmit
npm run editor:build
```

### 3.2 Kimi SSE 实测

通过本地 `/api/agent/plan/stream` 请求实测：

- 收到 `thinking` 事件：379 个。
- 收到最终 `token` 事件：1 个。
- 首个 token 不以空白开头。
- `done.text` 不以空白开头。
- 无 SSE error。

### 3.3 浏览器实测

测试地址：

```text
http://127.0.0.1:3460/agent-studio
```

已验证：

- 首屏布局正常，中文显示正常。
- scene 卡片、顶部按钮、输入区没有明显重叠。
- `进度`、`预览`、`素材`、`日志`、`文案修改` 面板可打开。
- 文案修改区显示新文案 `我来为大家介绍 Claude 和 Codex`。
- 预览面板可看到 Claude / Codex 图标左右并排，以及字幕和视频控件。
- `清理上下文` 按钮只清理对话上下文。
- `中断` 按钮可中断当前 Agent 响应，并清空待执行动作。

### 3.4 scene1 产物验证

- 新音频：
  - `public/voiceover/scene1.1778607375257.mp3`
- 新字幕：
  - `public/captions/scene1.json`
- manifest 中 scene1：
  - 文案：`我来为大家介绍 Claude 和 Codex`
  - 时长：112 frames
  - 词块：`我来 / 为大 / 家介绍 / Claude / 和 / Codex`
  - 素材数：2
- 新预览：
  - `output/scene1.preview.mp4`
  - 文件大小：360401 bytes
- codegen 烟测帧：
  - `.scene-codegen/smoke/scene1.frame-53.png`

## 4. 当前注意事项

- 我用于测试的服务端口是 `3460`。如果继续使用原来的 `3456`，需要重启 `node server.mjs` 才能加载本次服务端修改。
- `src/composer/script.json` 包含敏感配置，本报告未记录任何 API Key。
- 当前实现已解决“口头说改了但未真实写入”和“旧 tuningNotes 禁用素材导致图片不入画”的主要问题。
