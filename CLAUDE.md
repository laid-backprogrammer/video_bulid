# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run commands from the `remotion/` directory.

- `npm install` — install dependencies.
- `npm start` — run `node start.mjs`, starting the Express editor server on port 3456 and Remotion Studio on port 3000.
- `npm run dev` — start only Remotion Studio.
- `npm run editor:build` — build the editor UI from `editor/` into `editor/dist`.
- `npm run editor:serve` — serve the editor/API with `node server.mjs`.
- `npm run editor` — build the editor, then serve it.
- `npm run build` — render the full `AgentDiscussion` composition to `output/video.mp4`.
- `npm run scene:check` — run the normal validation path: `npx tsc --noEmit && npm run editor:build`.
- `npm run scene:context -- scene2` — print codegen context for one scene.
- `npm run scene:agent -- scene2 --provider openai --repairs 2` — generate one scene with the OpenAI-compatible provider.
- `npm run scene:agent -- scene2 --provider external-cli --cli-command "kimi --print --final-message-only --prompt {prompt}"` — generate one scene through an external CLI.
- `node src/composer/runner.mjs scene1` — run TTS, ASR alignment, and manifest generation for one scene; omit the scene id to process all included scenes.
- `node src/composer/pipeline.mjs` — lower-level CLI for the TTS → ASR → manifest pipeline.

There is no Jest/Vitest test setup and no lint script in `package.json`. Use `npm run scene:check` plus Remotion/editor preview as the normal verification path. There is no single-test command because no test runner is configured.

## High-level architecture

This is a Remotion-based AI short-video pipeline. The workflow is: edit scene copy in the local web editor, synthesize voiceover with LipVoice, align captions/timing with a Whisper-compatible API, generate Remotion scene TSX with an LLM or external CLI, preview, then render the final video.

`src/Root.tsx` defines two Remotion compositions:

- `AgentDiscussion` renders the full video using `public/scenes-manifest.json`, generated scene components, audio, captions, and fade transitions.
- `PreviewScene` renders one scene for editor preview and is also used by the server-side preview render path.

`src/composer/script.json` is the main authoring/config source for fps, scenes, copy, design/tuning notes, asset metadata, TTS config, transcription config, and codegen config. Generated runtime assets are written under `public/voiceover`, `public/captions`, `public/assets/scenes`, and summarized in `public/scenes-manifest.json`.

`server.mjs` is the local Express backend. It serves `editor/dist`, exposes `/api/*` endpoints for script editing, TTS, ASR, manifest rebuilding, scene design/codegen, asset upload/management, render jobs, and keeps in-memory status/log state for long-running tasks. Server helpers are split under `src/server/`:

- `paths.mjs` centralizes root-relative paths and public/output locations.
- `script-store.mjs` reads/writes `script.json` and preserves scene assets during config updates.
- `manifest-service.mjs` builds `public/scenes-manifest.json` from script, audio, captions, and asset state.
- `media-store.mjs` locates generated audio/caption/render artifacts.
- `render-service.mjs` starts Remotion CLI renders for full video or `PreviewScene` and tracks progress.
- `multipart-utils.mjs` parses editor uploads.

`editor/` is a Vite React app. `editor/src/App.tsx` holds the main editor workflow and state orchestration; `editor/src/app/workflow.ts` defines the visible steps (`script`, `audio`, `design`, `preview`, `render`). Editor hooks poll/stream server state for TTS, pipeline, codegen, and render progress. `editor/vite.config.ts` uses `../public` as `publicDir` and proxies `/api` to `localhost:3456`.

`src/composer/` contains the Node pipeline modules:

- `runner.mjs` orchestrates per-scene TTS, ASR alignment, and manifest writes with progress tracking.
- `voice-synthesis.mjs` integrates LipVoice TTS.
- `voice-alignment.mjs` integrates Whisper-compatible transcription and audio duration logic.
- `scene-agent.mjs` generates, validates, repairs, and falls back scene code.
- `scene-codegen-context.mjs` builds prompt context used by scene codegen.
- `scene-codegen/` contains helper modules for agent tools, skill/rule selection, prompts, and style guidance.
- `scene-assets.mjs` normalizes uploaded scene asset records and render/reference roles.

`src/scenes/generated/SceneX.generated.tsx` files are the generated Remotion scenes used by `Root.tsx`. `src/scenes/SceneX.tsx` files are fallback/older base scenes. Shared rendering helpers live in `src/components`; frame-driven animation utilities live in `src/hooks`.

`skills/` contains the local Remotion best-practice rule library that codegen context can include. If scene generation behavior changes, check `skills/SKILL.md`, `skills/rules/*`, and the rule selection in `src/composer/scene-codegen-context.mjs` / `src/composer/scene-codegen/skill-librarian.mjs`.

## Generated scene constraints

Before editing generated scenes, read `src/scenes/generated/CONTRACT.md`. Key rules:

- For a requested generated scene, edit only that `SceneX.generated.tsx` file unless the user explicitly asks for broader changes.
- Export `SceneXGenerated` with props `{ cues: SegmentCue[]; durationInFrames: number; assets?: SceneAsset[] }`.
- Drive timing from `durationInFrames` and `cues[].words[]`; do not assume fixed scene duration, cue count, or beat count.
- Do not hard-code narration text, cue title arrays, sentence arrays, uploaded asset ids, filenames, or `public/assets/scenes/...` paths.
- For multi-cue scenes, the main visuals must process the full `cues` array with runtime logic; captions alone are not enough.
- Use uploaded assets only when explicitly referenced by alias/asset id in `designNotes` or `tuningNotes` and present in `scene.assets`; respect asset roles (`render`, `reference`, `both`).
- Generated files live one directory deeper than base scenes, so local imports usually start with `../../`.
- Use Remotion frame-driven animation (`useCurrentFrame`, `interpolate`, `spring`, `Easing`), not CSS animations/transitions.
- After scene changes, run `npx tsc --noEmit` and `npm run editor:build` or `npm run scene:check`.

## Sensitive configuration

`src/composer/script.json` may contain API credentials such as `ttsSign`, `transcribeApiKey`, and `llmApiKey`. Environment variables such as `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` may also be used as fallbacks by pipeline code.
