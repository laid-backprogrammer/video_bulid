# AGENTS.md — agent-discussion-video

> 本文件面向 AI Coding Agent。若你是第一次接触本项目，请先完整阅读本文件，再修改任何代码。

---

## 项目概述

`agent-discussion-video` 是一个基于 **Remotion**（React 视频合成框架）的 AI 驱动短视频流水线项目。核心工作流为：

1. **文案编辑** — 在 Web 编辑器中编写/修改每段场景文案。
2. **语音合成（TTS）** — 调用 LipVoice API 将文案转为配音音频。
3. **时间轴对齐（ASR）** — 调用 Whisper API 对音频做逐字/逐句时间轴对齐，生成 `cues`/`words` 级字幕数据。
4. **场景代码生成** — 由 LLM（OpenAI 或外部 CLI）根据 `designNotes` / `tuningNotes` 和精确时间轴，自动生成 Remotion 场景 TSX 代码。
5. **视频渲染** — 在 Remotion Studio 或命令行中渲染最终视频。

整个流程通过本地 **Express 服务器**（`server.mjs`，端口 3456）和 **Vite 前端编辑器**（`editor/`，开发端口 3457，代理到 3456）进行管理。



---

## 技术栈

| 层级 | 技术 |
|---|---|
| 视频框架 | Remotion 4.x (`remotion`, `@remotion/cli`, `@remotion/player`, `@remotion/transitions`, `@remotion/captions`, `@remotion/media`) |
| UI 框架 | React 18.2 + TypeScript 5.3 |
| 编辑器构建 | Vite 5.x + `@vitejs/plugin-react` |
| 后端 / 流水线 | Node.js (ES Modules `.mjs`) + Express 5.x + `cors` |
| 动画驱动 | Remotion 内置 `useCurrentFrame`、`interpolate`、`spring`、`Easing` |
| TTS | LipVoice OpenAPI (`openapi.lipvoice.cn`) |
| ASR / 对齐 | OpenAI Whisper API（兼容格式） |
| 代码生成 | OpenAI Chat Completions（流式/非流式）或外部 CLI Agent |
| 媒体处理 | 内置 FFmpeg（通过 `@remotion/compositor`） |

---

## 目录结构

```
.
├── src/                          # Remotion 源码
│   ├── index.ts                  # 注册 RemotionRoot
│   ├── Root.tsx                  # 定义 Composition：AgentDiscussion（完整视频）+ PreviewScene（单段预览）
│   ├── types.ts                  # 共享类型：WordCue, SegmentCue, SceneData, AgentDiscussionProps
│   ├── components/
│   │   ├── Background.tsx        # 粒子背景 + GlowText + Subtitle 组件
│   │   └── Captions.tsx          # CaptionOverlay：按帧高亮当前 cue/words 的字幕层
│   ├── hooks/
│   │   ├── useAnimation.ts       # useFadeIn / useScaleIn / useSlideIn / usePulse / useTypewriter / useInterpolate
│   │   └── useSceneProgress.ts   # 场景级进度工具：at / isAfter / isBefore / isBetween
│   ├── scenes/
│   │   ├── Scene1.tsx … Scene8.tsx      # 基础场景（fallback / 旧版）
│   │   └── generated/
│   │       ├── CONTRACT.md       # 生成场景的接口契约与约束
│   │       ├── index.ts          # 导出 Scene1Generated … Scene8Generated
│   │       └── Scene{1..8}.generated.tsx   # LLM 生成的场景代码（**仅允许修改这些文件**）
│   └── composer/                 # Node.js 流水线脚本
│       ├── script.json           # 项目核心配置：文案、TTS/LLM/API 参数、scenes 数组
│       ├── pipeline.mjs          # CLI：一键 TTS → ASR → manifest
│       ├── runner.mjs            # 带状态追踪的 pipeline 运行器（供 server 调用）
│       ├── voice-synthesis.mjs   # LipVoice TTS 任务创建/轮询/下载
│       ├── voice-alignment.mjs   # Whisper 转录 + 时间轴估算 + MP3/WAV 时长解析
│       ├── json-utils.mjs        # readJsonFile / parseJsonText
│       ├── scene-agent.mjs       # LLM 场景代码生成 Agent（含校验、修复、回退逻辑）
│       └── scene-codegen-context.mjs  # 构造生成 prompt 上下文（skills + 类型 + 组件引用）
├── editor/                       # Vite React 编辑器 UI
│   ├── src/
│   │   ├── App.tsx               # 主界面（约 1700 行）：脚本编辑、TTS/ASR/生成/渲染控制
│   │   └── main.tsx              # ReactDOM entry
│   ├── vite.config.ts            # Vite 配置，代理 /api → localhost:3456
│   └── dist/                     # 构建产物（由 server.mjs 托管）
├── public/                       # 静态资源（Remotion + Editor 共用）
│   ├── scenes-manifest.json      # 运行时清单：fps + scenes（audioFile/captionsFile/durationInFrames/cues）
│   ├── voiceover/                # TTS 生成的音频（scene1.mp3 等）
│   └── captions/                 # ASR 生成的对齐字幕 JSON（scene1.json 等）
├── skills/                       # Remotion 最佳实践技能库
│   ├── SKILL.md                  # 技能索引
│   └── rules/                    # 各专题规则（animations、transitions、text-animations、charts…）
├── output/                       # 视频渲染输出目录
├── server.mjs                    # Express 后端：API + 静态文件 + SSE + 渲染子进程管理
├── start.mjs                     # 统一启动脚本：同时启动 Editor Server + Remotion Studio
├── package.json
├── tsconfig.json                 # baseUrl + paths: `@/*` → `src/*`
└── vite.config.ts                # 根目录 Vite 配置（Remotion 用）
```

---

## 关键配置

### `package.json` 脚本

| 命令 | 作用 |
|---|---|
| `npm start` | 运行 `node start.mjs`，同时启动 Editor Server + Remotion Studio |
| `npm run dev` | 仅启动 Remotion Studio（`remotion studio`） |
| `npm run build` | 渲染完整视频：`remotion render AgentDiscussion output/video.mp4` |
| `npm run editor:build` | 构建编辑器 UI：`cd editor && npx vite build` |
| `npm run editor:serve` | 启动 Editor 后端：`node server.mjs` |
| `npm run editor` | 先 build 再 serve |
| `npm run scene:context` | 为指定场景构造生成上下文：`node src/composer/scene-codegen-context.mjs <sceneId>` |
| `npm run scene:agent` | 生成单场景 Remotion 代码：`node src/composer/scene-agent.mjs <sceneId>` |
| `npm run scene:check` | 类型检查 + 编辑器构建：`npx tsc --noEmit && npm run editor:build` |
| `npm run upgrade` | 升级 Remotion 版本 |

### `src/composer/script.json`

这是项目的“单一数据源”，包含：

- `fps`: 视频帧率（默认 30）
- `scenes`: 场景数组，每个场景有 `id`、`text`（文案）、`designNotes`（视觉设计方案）、`tuningNotes`（微调备注）
- TTS 参数：`ttsBaseUrl`、`ttsSign`、`ttsAudioId`、`ttsSpeed`、`ttsStyle`、`ttsGenre`、`ttsExt`、`ttsVoiceName`…
- 转录参数：`transcribeBaseUrl`、`transcribeModel`、`transcribeApiKey`
- LLM 参数：`llmBaseUrl`、`llmModel`、`llmApiKey`
- 代码生成参数：`codegenProvider`（`openai` 或 `external-cli`）、`codegenCliCommand`

**注意**：`script.json` 中可能包含 API Key 等敏感信息，请勿提交到公共仓库。

---

## 代码组织原则

### Remotion 侧

- **动画必须帧驱动**：所有动画由 `useCurrentFrame()` 驱动，使用 `interpolate`、`spring`、`Easing`。
- **禁止 CSS 动画/过渡**：CSS transitions、animations、Tailwind 动画类在 Remotion 渲染中无法正确工作。
- **Composition 定义在 `Root.tsx`**：
  - `AgentDiscussion` — 完整视频，读取 `public/scenes-manifest.json` 动态计算时长与场景数据。
  - `PreviewScene` — 单场景预览，同样依赖 manifest。
- **场景组件映射**：`SCENE_COMPONENTS` 将 `scene1` … `scene8` 映射到 `Scene1Generated` … `Scene8Generated`。

### 生成场景契约（`src/scenes/generated/CONTRACT.md`）

生成场景文件（`SceneX.generated.tsx`）必须遵守以下硬性约束：

1. **仅修改 `SceneX.generated.tsx`**，不可改动 `Root.tsx`、server、editor、package 或其他场景文件。
2. **导出名称**：必须导出 `Scene{X}Generated`，props 为 `{ cues: SegmentCue[]; durationInFrames: number }`。
3. **使用 `durationInFrames` 和 `cues[].words[]` 驱动 timing**。
4. **多 cue 场景必须处理完整 `cues` 数组**：使用 `cues.map` / `find` / `findIndex` / `reduce` 等运行时逻辑；不能仅用 `CaptionOverlay`，也不能只围绕 `cues[0]` 构建画面。
5. **禁止硬编码文案**：不要硬编码 narration text、cue title arrays、sentence arrays。运行时从 `cues`、`cue.text`、`cue.words` 获取。
6. **视觉设计必须响应 `designNotes` / `tuningNotes`**：不是套用通用标题模板，而是根据创意简报实现具体的视觉隐喻、图表、UI、空间布局。
7. **导入路径规则**：生成文件在 `src/scenes/generated`，因此外部导入必须用 `../../types`、`../../hooks/useSceneProgress`、`../../components/Background` 等。
8. **样式变量类型**：提取为常量的 style 对象必须标注为 `React.CSSProperties`。
9. **禁止网络和浏览器 API**：不可使用 `fetch`、`localStorage`、`document`、`window`、`fs`、`require`。
10. **修改后必须执行**：`npx tsc --noEmit && npm run editor:build`。

### 编辑器侧

- `editor/src/App.tsx` 是一个单文件大组件（~1700 行），包含所有 UI 逻辑和状态管理。
- 所有服务端通信通过 `fetch` 到 `/api/*`，由 Vite dev server 代理到 Express（`server.mjs`）。

---

## 开发与调试流程

### 本地启动完整工作流

```bash
npm install
npm start
```

启动后会同时运行：
- Editor / 控制台：`http://localhost:3456`
- Remotion Studio：`http://localhost:3000`

### 单独启动（排查问题时）

```bash
# 1. 启动后端 API + 静态文件
node server.mjs

# 2. 另开终端启动 Remotion Studio
npx remotion studio

# 3. 如需单独开发编辑器前端
cd editor && npx vite
```

### 单场景代码生成（CLI）

```bash
# 使用 OpenAI 生成 scene2
npm run scene:agent -- scene2 --provider openai --repairs 2

# 使用外部 CLI 生成
npm run scene:agent -- scene2 --provider external-cli --cli-command "kimi --print --final-message-only --prompt {prompt}"

# 仅构造上下文，不生成
npm run scene:context -- scene2
```

### 类型检查与构建验证

```bash
npm run scene:check
```

### 渲染视频

```bash
# 完整视频
npm run build

# 单场景预览（通过 Editor UI 或 server API 触发）
```

---

## 测试策略

本项目**未集成 Jest/Vitest 等单元测试框架**。质量保证依赖以下层级：

1. **TypeScript 编译检查**：`npx tsc --noEmit` — 所有代码必须零类型错误。
2. **编辑器构建检查**：`npm run editor:build` — Vite 构建必须成功。
3. **场景代码生成校验**：`scene-agent.mjs` 内置本地 guards：
   - 检查导出名、类型引用、导入路径、是否硬编码文案、是否处理多 cue、是否使用未安装包、是否包含浏览器/Node API 等。
   - 校验失败会自动进入 Repair 流程（最多 3 次）。
   - 若最终仍失败，会恢复之前通过的版本，并保存失败候选到 `.scene-codegen/`。
4. **运行时预览**：在 Remotion Studio 中预览单帧/单场景，确认动画与字幕同步。

---

## 安全与敏感信息

- `src/composer/script.json` 存储了 API Key（`ttsSign`、`transcribeApiKey`、`llmApiKey`）。**不要将其提交到版本控制**；`.gitignore` 中未显式忽略它，需格外注意。
- `server.mjs` 启用了全局 `cors()`，仅在本地开发环境使用，不要直接暴露到公网。
- 编辑器上传声音克隆参考音频时，文件大小限制为 50MB，通过 multipart 解析器处理。
- 环境变量 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 可作为 script.json 中 API 配置的降级来源。

---

## 常见问题与排查

| 现象 | 可能原因 | 解决 |
|---|---|---|
| `npm start` 后 Studio 报连接错误 | Editor Server 尚未完成启动 | `start.mjs` 已内置 2s 延迟；如仍失败，手动分别启动 `server.mjs` 和 `remotion studio` |
| 场景预览黑屏/无内容 | `scenes-manifest.json` 中该场景 durationInFrames 为 0 或 cues 为空 | 先执行 TTS + ASR，再 Rebuild Manifest |
| 生成代码类型错误 | LLM 可能使用了错误的相对导入路径 | 检查 `.scene-codegen/*.codegen.error.txt`，确认导入是否使用了 `../../` |
| 中文显示为乱码（mojibake） | 外部 CLI 或 LLM 返回编码异常 | `scene-agent.mjs` 会自动检测 `looksLikeMojibake` 并回退到 fallback blueprint |
| TTS 任务超时 | LipVoice 服务端排队或文案过长 | 单次文案不得超过 5000 字符；检查 `server.mjs` 日志中的 taskId |
| ASR 失败 | 未配置 `transcribeApiKey` 或 `OPENAI_API_KEY` | 配置 script.json 中的 `transcribeApiKey`，或设置环境变量 `OPENAI_API_KEY`；未配置时会降级为文案估算时间轴 |

---

## 扩展与修改指南

- **新增场景**：在 `script.json` 的 `scenes` 数组追加 `{id: "scene9", text: "..."}`，并在 `Root.tsx` 的 `SCENE_COMPONENTS` 和 `fallbackScenes` 中注册对应映射。
- **修改基础视觉组件**：`src/components/Background.tsx` 和 `src/components/Captions.tsx` 是所有场景的共享依赖；修改后需重新构建编辑器并检查所有生成场景是否仍通过类型检查。
- **新增动画 hook**：建议在 `src/hooks/useAnimation.ts` 中添加，并在 `scene-codegen-context.mjs` 的 `selectedRuleFiles` 中引用，确保 LLM 在生成时能看到新 hook。
- **调整流水线逻辑**：`voice-synthesis.mjs` 和 `voice-alignment.mjs` 是独立的纯函数模块，修改后可直接用 `node src/composer/pipeline.mjs` 测试。
- **修改编辑器 UI**：`editor/src/App.tsx` 是单文件应用，直接修改即可；注意同步更新 `editor/src/main.tsx` 如果有入口变更。

---

> 最后更新：基于当前代码库实际内容整理。如有架构变更，请同步更新本文件。
