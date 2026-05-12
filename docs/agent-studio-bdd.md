# Agent Studio BDD：分段协作式视频编辑 Agent

## Summary

Agent Studio 第一阶段聚焦“分段协作”，不是一次性全自动生产。用户围绕当前 scene 和 Agent 结对讨论文案、画面、素材用途与修改意见；素材按 scene 隔离。用户通过 `@alias` 指定本段要用的图片、视频、BGM 或音效。本段敲定后，系统在后台执行 TTS、ASR、视觉方案、Remotion 代码生成和单段预览渲染，用户可以马上切到下一段继续交互。

自动模式暂缓实现，避免在素材意图和代码安全边界尚未稳定前让系统跨段失控执行。

## Execution Modes

- **分段协作模式（默认）**：Agent 只围绕当前段提供建议和可确认动作；用户敲定当前段后，该段进入后台生成，界面切到下一段继续沟通。
- **建议模式**：Agent 只分析、规划和给建议，不写配置，不上传素材，不调用 TTS、ASR、代码生成或渲染。
- **自动模式（后续）**：未来再支持从输入自动跑到完整预览稿；当前阶段不作为主界面入口。

## Feature: 用户选择当前段并结对推进

```gherkin
Given 用户打开 Agent Studio
When 项目中存在多个 scene
Then 对话框上方显示当前段和场景切换条
And 用户可以在 scene1、scene2、scene3 等片段之间切换
And 对话输入始终绑定到当前选中的 scene
And 默认执行模式是“分段协作模式”
```

## Scenario: 分段协作生成一块视频

```gherkin
Given 当前模式是分段协作模式
And 用户选中 scene2
And 用户围绕 scene2 提供文案、修改意见和素材描述
When Agent 回复制作建议
Then Agent 只基于 scene2 的文案、状态、素材和最近对话生成建议
And 不把其他 scene 的素材或反馈混入 scene2
When 用户点击“敲定本段并后台生成”
Then 系统保存 scene2 文案
And 将 scene2 的待入库素材写入 scene2
And 后台依次执行 scene2 的 TTS、ASR、视觉方案、Remotion 代码生成和单段预览渲染
And 界面可以切到下一段继续对话
And scene2 完成后在对话中提示用户可打开预览验收
```

## Scenario: 当前段后台生成时继续编辑下一段

```gherkin
Given scene2 正在后台生成
When 用户切换到 scene3
Then 用户仍可在对话框输入 scene3 的想法
And 用户可为 scene3 添加待确认素材
And scene2 的后台生成状态显示在进度或场景条中
And 系统不允许同时启动另一段生成流水线
And scene3 的素材不会写入 scene2
```

## Feature: 每段素材隔离

```gherkin
Given 用户选中 scene1
When 用户上传图片、视频、BGM 或音效
Then 素材先作为 scene1 的待入库素材
And 系统为素材生成可 @ 指定的 alias
And 素材抽屉只展示 scene1 的入库素材和待入库素材
When 用户切换到 scene2
Then scene1 的待入库素材不会出现在 scene2 的素材列表中
And scene2 的生成上下文不包含 scene1 素材
```

## Scenario: 使用 @ 指定素材

```gherkin
Given 当前段存在素材 @logo、@demoClip 和 @clickSfx
When 用户输入“把 @logo 作为开头主视觉，@demoClip 插到中段，@clickSfx 在按钮出现时播放”
Then Agent 将 @logo、@demoClip 和 @clickSfx 写入当前段制作建议
And 视觉方案生成时只把被 @ 提及的素材放进 Remotion 生成上下文
And 未 @ 提及的素材不会被代码生成器泛化选择
```

## Scenario: 未说明素材用途时追问或保守处理

```gherkin
Given 用户上传一张图片但没有说明用途
When 文件名或上下文能明确判断它是风格参考
Then Agent 可标注为风格参考并说明判断
When 文件名和上下文无法判断它是画面素材还是风格参考
Then Agent 只针对这张图片追问用途
And 不阻塞其他已明确素材的制作计划
```

## Scenario: 修改文案并重新生成语音

```gherkin
Given 用户打开当前段预览
And 用户点击“修改”
When 用户编辑文案并点击“保存并重做语音+预览”
Then 系统保存当前段新文案
And 强制重新执行当前段 TTS
And 基于新语音重新执行 ASR 时间轴对齐
And 刷新视觉方案、Remotion 代码和单段预览
And 修改失败时保留上一版可用代码和产物
```

## Feature: 建议模式不产生副作用

```gherkin
Given 当前模式是建议模式
When 用户输入文案、方向或素材用途
Then Agent 只输出脚本方案、素材使用建议、画面风格和制作计划
And 不写入项目配置
And 不上传素材
And 不调用 TTS、ASR、代码生成或渲染
And 用户可以切回分段协作模式继续制作
```

## Feature: 安全生成与防崩溃

```gherkin
Given Agent 准备生成 Remotion 场景代码
Then 系统必须提供精确上下文：sceneId、文案、cues、words、durationInFrames、素材用途、用户反馈和设计约束
And 生成代码只能修改对应 SceneX.generated.tsx
And 不允许修改 Root、server、editor、package 或其他无关文件
And 不允许使用浏览器 API、Node API、网络请求或未安装依赖
And 生成后必须通过本地 guard、TypeScript 检查和渲染预检
And 失败时保留上一版可用代码，并在对话中解释失败原因
```

## UI Requirements

- 主视觉保持一个干净的 Agent 对话框。
- 当前段选择、模式选择和“敲定本段并后台生成”靠近输入框，但不抢主对话注意力。
- 进度、预览、素材清单和日志默认折叠为抽屉。
- 素材抽屉按当前 scene 展示，入库素材和待入库素材分开。
- 每个素材显示可插入的 `@alias`。
- 预览抽屉内保留“通过”“修改”“重新生成”，其中“修改”必须支持编辑文案并重新生成语音、字幕和预览。

## Acceptance Tests

- 用户上传素材时，素材只挂到当前选中的 scene。
- 用户切换 scene 后，素材抽屉只显示新 scene 的素材。
- 用户能点击素材的“插入 @alias”把素材引用写入对话框。
- 用户敲定当前段后，该段后台执行 TTS、ASR、视觉方案、代码生成和单段预览渲染。
- 当前段后台生成时，用户可以切换到下一段继续输入和添加待确认素材。
- 系统不会同时启动两段后台生成流水线。
- 建议模式下不会产生文件写入、素材上传、TTS、ASR、代码生成或渲染动作。
- 生成失败不会覆盖上一版可用 Remotion 代码，也不会导致页面崩溃。

