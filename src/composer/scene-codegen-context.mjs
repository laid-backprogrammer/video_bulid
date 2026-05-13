#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonFile} from './json-utils.mjs';
import {buildSceneAssetsMarkdown, currentSceneAssetMentionText, filterMentionedSceneAssets, normalizeSceneAssets} from './scene-assets.mjs';
import {agentToolsMarkdown, codeWriterEditTools, mainAgentReadTools} from './scene-codegen/agent-tools.mjs';
import {applyRequiredSkillRules, createBaseSkillSelection, skillCatalogMarkdown, skillSelectionMarkdown} from './scene-codegen/skill-librarian.mjs';
import {readProjectStyleGuide, styleGuideMarkdown} from './scene-codegen/style-guide.mjs';

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, 'src/composer/script.json');
const OUT_DIR = path.join(ROOT, '.scene-codegen');

const sceneNumber = (sceneId) => {
  const match = String(sceneId).match(/(\d+)$/);
  if (!match) throw new Error(`Scene id must end with a number: ${sceneId}`);
  return match[1];
};

const readText = async (relPath) => {
  try {
    return await fs.readFile(path.join(ROOT, relPath), 'utf-8');
  } catch {
    return '';
  }
};

const fenced = (label, lang, content) => [
  `## ${label}`,
  '',
  `\`\`\`${lang}`,
  content.trimEnd(),
  '```',
  '',
].join('\n');

const compactText = (text = '', maxChars = 1400) => {
  const value = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (value.length <= maxChars) return value || '(none)';
  return `${value.slice(0, maxChars).trimEnd()}\n\n[truncated ${value.length - maxChars} chars]`;
};

const summarizeCues = (cues = []) => cues.map((cue) => ({
  id: cue.id,
  text: cue.text,
  startFrame: cue.startFrame,
  endFrame: cue.endFrame,
  words: (cue.words ?? []).map((word) => ({
    text: word.text,
    startFrame: word.startFrame,
    endFrame: word.endFrame,
  })),
  rawWords: (cue.rawWords ?? []).slice(0, 60).map((word) => ({
    text: word.text,
    startFrame: word.startFrame,
    endFrame: word.endFrame,
  })),
}));

const secondsFromFrames = (frames, fps) => Number((frames / fps).toFixed(3));

const extractHexColors = (text = '') => [...new Set(String(text).match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) ?? [])];

const compactSceneNotes = (text = '', {maxChars = 2200} = {}) => {
  const source = String(text || '').trim();
  if (source.length <= maxChars) return source;

  const stopPatterns = [
    /^##\s*\d+\.?\s*字幕词块高亮时间轴/im,
    /^##\s*\d+\.?\s*图层顺序/im,
    /^##\s*\d+\.?\s*Remotion\s*实现提示/im,
    /^##\s*\d+\.?\s*时长适配建议/im,
  ];
  const stopIndex = stopPatterns
    .map((pattern) => source.search(pattern))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  const body = stopIndex ? source.slice(0, stopIndex) : source;

  const lines = body
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const keepLine = (line) => (
    /^#{1,3}\s/.test(line)
    || /用户要求|本轮用户|画面结构|画面基调|媒体素材|素材|@asset_|@[\w-]+|必须|不要|不使用|一左一右|左侧|右侧|中间|中央|字幕|色彩|背景|标题|布局|位置|入画|reference|render|both|video|audio|避免|优先/.test(line)
  );

  const compact = [];
  for (const line of lines) {
    if (!keepLine(line)) continue;
    if (compact.includes(line)) continue;
    compact.push(line);
    if (compact.join('\n').length >= maxChars) break;
  }

  const result = compact.join('\n').slice(0, maxChars).trim();
  return result || source.slice(0, maxChars).trim();
};

const buildCueTimelineMarkdown = (cues = [], fps) => {
  if (!Array.isArray(cues) || cues.length === 0) {
    return [
      `fps: ${fps}`,
      'No aligned captions are available.',
    ].join('\n');
  }

  return [
    `fps: ${fps}`,
    ...cues.map((cue, index) => {
      const words = (cue.words ?? []).map((word) => (
        `${word.text}@${word.startFrame}-${word.endFrame}f/${secondsFromFrames(word.startFrame, fps)}-${secondsFromFrames(word.endFrame, fps)}s`
      )).join(' ');
      return [
        `cue ${index + 1} | ${cue.id} | ${cue.startFrame}-${cue.endFrame}f | ${secondsFromFrames(cue.startFrame, fps)}-${secondsFromFrames(cue.endFrame, fps)}s`,
        `text: ${cue.text || '(empty)'}`,
        `words: ${words || '(none)'}`,
      ].join('\n');
    }),
  ].join('\n\n');
};

const buildPackageDependencies = async () => Object.keys(await readJsonFile(path.join(ROOT, 'package.json')).then((packageJson) => ({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
})).catch(() => ({}))).sort();

const buildSceneSummary = (context) => ({
  sceneId: context.sceneId,
  fps: context.fps,
  targetFile: context.targetFile,
  scene: {
    text: context.scene?.text,
    designNotes: context.scene?.designNotes,
    tuningNotes: context.scene?.tuningNotes,
    assetCount: context.scene?.assets?.length ?? 0,
    withheldUnmentionedAssetCount: context.scene?.withheldUnmentionedAssetCount ?? 0,
    assets: (context.scene?.assets ?? []).map((asset) => ({
      name: asset.name,
      alias: asset.alias,
      assetType: asset.assetType,
      role: asset.role,
      notes: asset.notes,
      mimeType: asset.mimeType,
    })),
    briefColors: context.scene?.briefColors ?? [],
  },
  projectStyle: context.projectStyle ? {
    strength: context.projectStyle.strength,
    theme: context.projectStyle.theme,
    palette: context.projectStyle.palette,
    continuity: context.projectStyle.continuity,
    freedom: context.projectStyle.freedom,
  } : null,
  alignment: context.alignment ? {
    durationInFrames: context.alignment.durationInFrames,
    durationInSeconds: context.alignment.durationInSeconds,
    cueCount: context.alignment.cueCount,
    wordCount: (context.alignment.cues ?? []).reduce((sum, cue) => sum + (cue.words?.length ?? 0), 0),
    cuePreview: (context.alignment.cues ?? []).slice(0, 6).map((cue) => ({
      id: cue.id,
      text: cue.text,
      startFrame: cue.startFrame,
      endFrame: cue.endFrame,
    })),
  } : null,
});

async function loadSceneCodegenState(sceneId, {skillSelection: providedSkillSelection = null} = {}) {
  const number = sceneNumber(sceneId);
  const script = await readJsonFile(SCRIPT_PATH);
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  const styleGuide = await readProjectStyleGuide(ROOT);

  const fps = script.fps ?? 30;
  const captionsRel = `public/captions/${sceneId}.json`;
  const captions = await readJsonFile(path.join(ROOT, captionsRel)).catch(() => null);
  const generatedSceneRel = `src/scenes/generated/Scene${number}.generated.tsx`;
  const briefColors = extractHexColors([scene.designNotes, scene.tuningNotes].filter(Boolean).join('\n'));
  const allSceneAssets = normalizeSceneAssets(scene.assets, {
    includeStaticFilePath: true,
    includeAbsolutePath: true,
    root: ROOT,
  });
  const assetMentionText = currentSceneAssetMentionText(scene);
  const sceneAssets = normalizeSceneAssets(filterMentionedSceneAssets(allSceneAssets, assetMentionText), {
    includeStaticFilePath: true,
    includeAbsolutePath: true,
    root: ROOT,
  });
  const withheldUnmentionedAssetCount = Math.max(0, allSceneAssets.length - sceneAssets.length);
  const cueTimelineMarkdown = buildCueTimelineMarkdown(captions?.cues ?? [], fps);
  const alignment = captions ? {
    audioFile: captions.audioFile,
    durationInFrames: captions.durationInFrames,
    durationInSeconds: secondsFromFrames(captions.durationInFrames, fps),
    alignmentSource: captions.alignmentSource,
    wordTimingSource: captions.wordTimingSource,
    cueCount: Array.isArray(captions.cues) ? captions.cues.length : 0,
    cues: summarizeCues(captions.cues),
  } : null;
  const sceneContext = {
    text: scene.text,
    designNotes: compactSceneNotes(scene.designNotes ?? ''),
    tuningNotes: compactSceneNotes(scene.tuningNotes ?? '', {maxChars: 2600}),
    rawDesignNotesLength: String(scene.designNotes ?? '').length,
    rawTuningNotesLength: String(scene.tuningNotes ?? '').length,
    noteCompactionPolicy: 'Long design/tuning notes are compacted before codegen to preserve user intent without flooding Code Writer with implementation noise.',
    briefColors,
    assets: sceneAssets,
    assetMentionPolicy: 'Only assets explicitly @mentioned in the current tuningNotes are included in codegen context. If there are no tuningNotes, designNotes are used as the asset mention source.',
    withheldUnmentionedAssetCount,
  };
  const skillSelection = applyRequiredSkillRules(providedSkillSelection ?? createBaseSkillSelection(), {sceneAssets});
  const renderableAssets = sceneAssets.filter((asset) => asset.role === 'render' || asset.role === 'both');
  const visualAssets = renderableAssets.filter((asset) => asset.assetType !== 'audio');
  const audioAssets = renderableAssets.filter((asset) => asset.assetType === 'audio');
  const requiredAssets = renderableAssets.map((asset) => ({
    name: asset.name,
    id: asset.id,
    alias: asset.alias,
    mention: `@${asset.alias}`,
    assetType: asset.assetType,
    role: asset.role,
    notes: asset.notes,
    mustUse: true,
    expectedUse: asset.assetType === 'audio'
      ? 'timed Remotion Audio layer'
      : asset.assetType === 'video'
        ? 'visible Remotion Video layer'
        : 'visible Remotion Img layer',
    selectionRule: `Select this asset by explicit id or alias first: asset.id === '${asset.id}' or asset.alias === '${asset.alias}'. Do not select it only by assetType or role.`,
  }));
  const mediaAssetRequirement = renderableAssets.length > 0 ? {
    required: true,
    assetCount: renderableAssets.length,
    visualAssetCount: visualAssets.length,
    audioAssetCount: audioAssets.length,
    allowedAliases: renderableAssets.map((asset) => asset.alias),
    allowedIds: renderableAssets.map((asset) => asset.id),
    requiredAssets,
    rule: 'Use every required asset listed here. Select assets by explicit id or alias first, then verify assetType/role for rendering. Do not select uploaded media only by assetType or role.',
    assets: renderableAssets.map((asset) => ({
      name: asset.name,
      alias: asset.alias,
      assetType: asset.assetType,
      role: asset.role,
      notes: asset.notes,
    })),
  } : {required: false, assetCount: 0, visualAssetCount: 0, audioAssetCount: 0};

  const allowedWriteFiles = [generatedSceneRel];
  const validationCommands = [
    'npx tsc --noEmit',
    'npm run editor:build',
    `npx remotion still PreviewScene .scene-codegen/smoke/${sceneId}.frame-0.png --props .scene-codegen/smoke/${sceneId}.props.json --frame 0`,
  ];

  const context = {
    sceneId,
    fps,
    targetFile: generatedSceneRel,
    allowedWriteFiles,
    forbiddenWriteGlobs: [
      'server.mjs',
      'editor/**',
      'src/Root.tsx',
      'src/scenes/Scene*.tsx',
      'package*.json',
    ],
    validationCommands,
    packageDependencies: await buildPackageDependencies(),
    scene: sceneContext,
    projectStyle: styleGuide,
    alignment,
    skillSelection,
    mediaAssetRequirement,
    renderAssetRequirement: mediaAssetRequirement,
    agentTools: {
      mainAgentReadTools,
      codeWriterEditTools,
    },
  };

  return {
    number,
    script,
    rawScene: scene,
    scene,
    styleGuide,
    fps,
    captions,
    generatedSceneRel,
    briefColors,
    sceneAssets,
    allSceneAssets,
    assetMentionText,
    withheldUnmentionedAssetCount,
    renderableAssets,
    visualAssets,
    audioAssets,
    cueTimelineMarkdown,
    alignment,
    sceneContext,
    skillSelection,
    allowedWriteFiles,
    validationCommands,
    context,
  };
}

export async function buildSkillSelectionContext(sceneId) {
  const state = await loadSceneCodegenState(sceneId, {
    skillSelection: createBaseSkillSelection(),
  });
  const summary = buildSceneSummary(state.context);
  const context = {
    sceneId,
    fps: state.fps,
    targetFile: state.generatedSceneRel,
    sceneSummary: summary,
    projectStyle: state.styleGuide,
    skillCatalog: skillCatalogMarkdown(),
    agentTools: {
      mainAgentReadTools,
    },
  };

  const sections = [
    '# Remotion Skill Selection Context',
    '',
    'Main Agent task: inspect this compact scene summary and choose only the conditional skill/rule documents that materially improve this scene.',
    'Base rules for timing, animation, sequencing, and captions are already injected. Do not select conditional rules by keyword alone; select by semantic need.',
    '',
    fenced('Scene Summary', 'json', JSON.stringify(summary, null, 2)),
    fenced('Project Visual Style (Soft Guide)', 'md', styleGuideMarkdown(state.styleGuide)),
    fenced('User Media Assets and Visual References (Summary)', 'md', buildSceneAssetsMarkdown(state.sceneAssets, {root: ROOT, mentionText: state.assetMentionText, requireMention: true})),
    fenced('Available Skill Catalog', 'md', skillCatalogMarkdown()),
    fenced('Main Agent Read Tools', 'md', agentToolsMarkdown({
      allowedWriteFiles: state.allowedWriteFiles,
      validationCommands: state.validationCommands,
    })),
  ];

  return {
    context,
    markdown: sections.join('\n'),
  };
}

export async function buildSceneCodegenContext(sceneId, {skillSelection: providedSkillSelection = null} = {}) {
  const state = await loadSceneCodegenState(sceneId, {skillSelection: providedSkillSelection});
  const {
    rawScene: scene,
    styleGuide,
    fps,
    sceneAssets,
    assetMentionText,
    renderableAssets,
    cueTimelineMarkdown,
    skillSelection,
    allowedWriteFiles,
    validationCommands,
    context,
  } = state;

  const sections = [
    '# Remotion Scene Codegen Task',
    '',
    'Use the provided context in this exact priority order:',
    '1. `scene.tuningNotes` latest fine-tuning instructions and user overrides',
    '2. `scene.designNotes` visual brief, only where not superseded by tuningNotes',
    '3. `scene.assets` user media, filtered to assets explicitly @mentioned in the current asset mention source',
    '4. Timestamped captions in `alignment.cues[].words[]`',
    '5. File contract, available imports, and local references',
    '6. Project Visual Style as a soft continuity guide',
    '7. Selected skill rule files as an implementation cookbook',
    '',
    'You are editing one Remotion scene only. Follow the file/interface contract and preserve the exported component name.',
    'The main agent may read scene data, skill rules, and stable references to decide what capabilities matter. The code writer subagent may edit only the target generated scene file.',
    '',
    renderableAssets.length
      ? `Hard media requirement: this scene has ${renderableAssets.length} @mentioned uploaded media asset(s). Use each according to assetType and user notes; videos/images are visual layers and audio is a timed Audio layer. Do not leave this to repair.`
      : 'Hard media requirement: no @mentioned uploaded media assets are currently available for insertion.',
    '',
    'Be visually creative. The constraints are about where you may write and how timing data must be used, not about making the visual content conservative.',
    'Use the narration, design notes, and word-level timestamps as anchors for an original Remotion scene.',
    'Use Project Visual Style as a soft continuity guide only. It should preserve cross-scene feel without blocking a scene-specific brief, uploaded reference, or user tuning request.',
    'Latest tuningNotes override older designNotes when they conflict. Treat designNotes as the base brief and tuningNotes as the current user correction layer.',
    'The effective creative brief is scene.tuningNotes plus the non-conflicting parts of scene.designNotes. Translate it into bespoke Remotion visuals, not a generic title/caption template.',
    'Treat this as a fresh design pass driven by the brief and aligned captions, not as an incremental edit of a pre-existing generic layout.',
    'Use the selected skill rules as capability references, not as a rigid template. Choose the visual system that best satisfies the brief. Do not copy package imports from examples unless the package exists in package.json.',
    'Only use uploaded media assets that are explicitly @mentioned in the current asset mention source and listed in scene.assets. Do not use other runtime assets even if they are present in the props.',
    'Use image `render`/`both` assets as visible Remotion Img materials. Use image `reference` assets only to match visual direction; do not place reference-only images into the rendered frame.',
    'Use video assets as visible Remotion Video materials from @remotion/media. Use audio assets as timed Remotion Audio layers from @remotion/media for click sounds, music, or SFX.',
    'Do not hard-code uploaded media filenames or `public/assets/scenes/...` paths from design notes or examples. Pick media from `assets` at runtime by the explicitly @mentioned asset id or alias first, then check role/type, derive the staticFile path from `asset.file`, and render no media if the asset was deleted.',
    'Never select media with only `asset.assetType === "image"` or only `asset.role === "render"` from the runtime assets prop. That can accidentally pull unmentioned assets into the scene.',
    'Scene length and cue count vary. Do not assume the scene is short, do not assume there are only one or two cues, and do not build a first-sentence-only intro. The main visual timeline must respond to every cue in Task JSON.',
    'Do not hard-code narration text, fixed cue title arrays, or fixed sentence arrays. Derive displayed narration and beat state from cues/cue.text/cue.words at runtime. Generic colors, shapes, and layout constants are fine.',
    '',
    'Important import path rule: the target file is inside src/scenes/generated. Imports from src/types, src/hooks, and src/components must go up two levels, for example ../../types, ../../hooks/useSceneProgress, and ../../components/Background. If you copy imports from src/scenes/SceneX.tsx, add one extra ../.',
    'Important TypeScript style rule: if a style object is stored in a variable, annotate it as React.CSSProperties so CSS literal fields such as textAlign and position keep valid narrow types.',
    '',
    fenced('Scene Narration (Primary)', 'text', scene.text || '(empty)'),
    fenced('Fine-tuning Notes (Highest Priority User Overrides)', 'md', compactText(scene.tuningNotes || 'No tuning notes provided.', 1000)),
    fenced('Visual Design Brief (Base Brief, Superseded By Tuning Notes)', 'md', compactText(scene.designNotes || 'No design notes provided.', 1200)),
    fenced('User Media Assets and Visual References (Primary)', 'md', buildSceneAssetsMarkdown(sceneAssets, {root: ROOT, mentionText: assetMentionText, requireMention: true})),
    fenced('Media Asset Requirement (Hard)', 'json', JSON.stringify(context.mediaAssetRequirement, null, 2)),
    fenced('Timestamped Subtitle Timeline (Primary)', 'md', compactText(cueTimelineMarkdown, 1800)),
    fenced('Project Visual Style (Soft Guide)', 'md', compactText(styleGuideMarkdown(styleGuide), 700)),
    fenced('Skill Selection Trace', 'md', skillSelectionMarkdown(skillSelection)),
    fenced('Agent Tool Boundaries', 'md', agentToolsMarkdown({allowedWriteFiles, validationCommands})),
    fenced('Task JSON', 'json', compactText(JSON.stringify(context, null, 2), 3200)),
    fenced('Generated Scene Contract', 'md', compactText(await readText('src/scenes/generated/CONTRACT.md'), 1600)),
    fenced('Types', 'ts', compactText(await readText('src/types.ts'), 1400)),
    fenced('useSceneProgress Hook', 'ts', compactText(await readText('src/hooks/useSceneProgress.ts'), 1200)),
    fenced('Caption Overlay Reference', 'tsx', compactText(await readText('src/components/Captions.tsx'), 900)),
    fenced('Background Components Reference', 'tsx', compactText(await readText('src/components/Background.tsx'), 900)),
    ...await Promise.all(skillSelection.selectedRuleFiles.slice(0, 2).map(async (file) => fenced(`Rule: ${file}`, file.endsWith('.md') ? 'md' : 'tsx', compactText(await readText(file), 1200)))),
  ];

  return {
    context,
    markdown: sections.join('\n'),
    jsonOut: path.join(OUT_DIR, `${sceneId}.codegen.json`),
    mdOut: path.join(OUT_DIR, `${sceneId}.codegen.md`),
  };
}

export async function buildRepairContextMarkdown({context, blueprint, validationError}) {
  const selectedRules = context.skillSelection?.selectedRuleFiles ?? [];
  const compactContext = {
    sceneId: context.sceneId,
    targetFile: context.targetFile,
    allowedWriteFiles: context.allowedWriteFiles,
    validationCommands: context.validationCommands,
    packageDependencies: context.packageDependencies,
    scene: {
      designNotes: context.scene?.designNotes,
      tuningNotes: context.scene?.tuningNotes,
      briefColors: context.scene?.briefColors,
      assetCount: context.scene?.assets?.length ?? 0,
      withheldUnmentionedAssetCount: context.scene?.withheldUnmentionedAssetCount ?? 0,
      assets: (context.scene?.assets ?? []).map((asset) => ({
        name: asset.name,
        alias: asset.alias,
        assetType: asset.assetType,
        role: asset.role,
        file: asset.file,
        notes: asset.notes,
      })),
    },
    alignment: context.alignment ? {
      durationInFrames: context.alignment.durationInFrames,
      durationInSeconds: context.alignment.durationInSeconds,
      cueCount: context.alignment.cueCount,
      cues: (context.alignment.cues ?? []).map((cue) => ({
        id: cue.id,
        text: cue.text,
        startFrame: cue.startFrame,
        endFrame: cue.endFrame,
        wordCount: cue.words?.length ?? 0,
      })),
    } : null,
    projectStyle: context.projectStyle,
    selectedRules,
  };

  return [
    '# Remotion Repair Context',
    '',
    'Repair only the failed generated scene file. Keep the existing visual brief and timing behavior unless the validation error requires a change.',
    'This is intentionally compact: rely on the validation error, current code, blueprint, and contract essentials instead of rereading the full codegen context.',
    '',
    fenced('Compact Task JSON', 'json', JSON.stringify(compactContext, null, 2)),
    fenced('Visual Director Blueprint', 'md', blueprint || '(none)'),
    fenced('Validation Error', 'text', String(validationError || '').slice(-12000)),
    fenced('Generated Scene Contract', 'md', await readText('src/scenes/generated/CONTRACT.md')),
  ].join('\n');
}

export async function writeSceneCodegenContext(sceneId, {log = true, skillSelection = null} = {}) {
  const result = await buildSceneCodegenContext(sceneId, {skillSelection});
  await fs.mkdir(OUT_DIR, {recursive: true});
  await fs.writeFile(result.jsonOut, JSON.stringify(result.context, null, 2), 'utf-8');
  await fs.writeFile(result.mdOut, result.markdown, 'utf-8');
  if (log) {
    console.log(`Wrote ${path.relative(ROOT, result.jsonOut)}`);
    console.log(`Wrote ${path.relative(ROOT, result.mdOut)}`);
  }
  return result;
}

async function main() {
  const sceneId = process.argv[2];
  if (!sceneId) {
    throw new Error('Usage: node src/composer/scene-codegen-context.mjs scene1');
  }
  await writeSceneCodegenContext(sceneId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
