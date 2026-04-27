# 重构计划文档

## 目标

把当前“编辑器 + 服务端 + 代码生成 + Remotion 运行时”这条链路拆成边界清晰的模块，降低 `App.tsx`、`server.mjs`、`scene-agent.mjs` 这类大文件的耦合度，让每一层只承担单一职责。

## 现状

当前最重的耦合点是：

- `editor/src/App.tsx`：页面状态、步骤流转、弹框、轮询、SSE、素材上传、配置编辑全部混在一起。
- `server.mjs`：配置、素材、TTS、ASR、设计、微调、codegen、pipeline、render、manifest 都在一个入口里。
- `src/composer/scene-agent.mjs`：参数解析、上下文构建、prompt 组装、LLM 调用、代码提取、守卫校验、修复、写文件都挤在同一个脚本里。
- `src/Root.tsx`：总体还算清楚，但 metadata、scene registry 和 manifest 读取还可以进一步收敛。

## 拆分原则

1. UI 只负责渲染和触发动作，不直接组织业务流程。
2. 服务端 route 只做参数校验和响应，不承载复杂业务编排。
3. 代码生成链拆成 `context / prompt / generate / validate / repair / io` 六个部分。
4. 运行时组件保持薄层，不把编辑器逻辑带进 Remotion Root。
5. 先拆高耦合入口，再拆共享底层，最后整理产物层。

## 模块边界

### 前端

建议把 `editor/src/App.tsx` 拆成以下模块：

- `editor/src/app/AppShell.tsx`
- `editor/src/features/script/`
- `editor/src/features/audio/`
- `editor/src/features/design/`
- `editor/src/features/preview/`
- `editor/src/features/render/`
- `editor/src/features/scenes/`
- `editor/src/components/ui/`
- `editor/src/services/api/`
- `editor/src/hooks/`

职责划分：

- `AppShell` 只负责布局、路由式步骤切换、全局状态装配。
- `features/*` 负责各自面板、弹框和局部交互。
- `services/api` 负责 `fetch`、SSE、multipart 上传。
- `hooks` 负责轮询和状态同步。

### 服务端

建议把 `server.mjs` 拆成：

- `src/server/routes/config.mjs`
- `src/server/routes/scene-assets.mjs`
- `src/server/routes/llm.mjs`
- `src/server/routes/codegen.mjs`
- `src/server/routes/tts.mjs`
- `src/server/routes/asr.mjs`
- `src/server/routes/pipeline.mjs`
- `src/server/routes/render.mjs`
- `src/server/state/*.mjs`
- `src/server/services/*.mjs`
- `src/server/lib/*.mjs`

职责划分：

- `routes` 只保留 HTTP 层。
- `services` 负责业务编排。
- `state` 负责内存状态和快照。
- `lib` 负责通用解析、SSE、manifest、路径工具。

### Composer

建议把 `src/composer/scene-agent.mjs` 拆成：

- `src/composer/scene-agent/args.mjs`
- `src/composer/scene-agent/context.mjs`
- `src/composer/scene-agent/prompts.mjs`
- `src/composer/scene-agent/generator.mjs`
- `src/composer/scene-agent/validator.mjs`
- `src/composer/scene-agent/repair.mjs`
- `src/composer/scene-agent/io.mjs`

职责划分：

- `args` 处理 CLI 参数。
- `context` 处理上下文读取和打包。
- `prompts` 处理 system/user prompt。
- `generator` 处理 OpenAI 调用。
- `validator` 处理本地 guards。
- `repair` 处理失败后的修复循环。
- `io` 处理目标文件写入和失败回滚。

### 运行时

建议把 `src/Root.tsx` 里的运行时逻辑拆成：

- `src/runtime/scene-registry.ts`
- `src/runtime/manifest.ts`
- `src/runtime/metadata.ts`

这样 `Root.tsx` 只负责 composition 注册和组合渲染。

## 实施顺序

### 第一阶段

先拆前端，不改后端接口。

- 把 `App.tsx` 拆成多个 feature 组件。
- 把 `fetch`、SSE、上传逻辑抽到 `services/api`。
- 把轮询逻辑抽到专用 hooks。
- 保留现有 UI 行为不变。

### 第二阶段

拆服务端入口。

- 按领域拆 route。
- 把状态对象抽到 `state`。
- 把 LLM 和素材相关 helper 抽到 `services`。
- 保持现有 API 路径兼容。

### 第三阶段

重构 codegen 内核。

- 先拆上下文和 prompt。
- 再拆生成和验证。
- 最后把修复逻辑和 IO 归位。

### 第四阶段

整理 Remotion runtime。

- 抽 manifest 和 metadata 工具。
- 收紧 scene registry。
- 让 `Root.tsx` 只做 composition 装配。

## 验收标准

每一阶段完成后，至少满足下面几项：

- `npx tsc --noEmit` 通过。
- `npm run editor:build` 通过。
- 关键 API 路由行为不变。
- 现有场景仍可渲染。
- 新拆分模块的职责边界清楚，不互相引用内部实现。

## 风险点

- `App.tsx` 拆分时最容易出现 props 传递膨胀，必须优先收敛成 hooks 和 feature 组件。
- `server.mjs` 拆分时最容易出现状态重复，必须先统一状态源，再拆 route。
- `scene-agent.mjs` 拆分时最容易破坏 prompt 兼容性，应该先保留旧接口，后迁移内部实现。

## 推荐优先级

1. `editor/src/App.tsx`
2. `server.mjs`
3. `src/composer/scene-agent.mjs`
4. `src/Root.tsx`
5. `src/scenes/generated/*`

