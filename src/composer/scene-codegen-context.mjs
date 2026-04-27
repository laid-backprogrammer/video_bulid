#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonFile} from './json-utils.mjs';
import {buildSceneAssetsMarkdown, normalizeSceneAssets} from './scene-assets.mjs';

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

const selectedRuleFiles = [
  'skills/SKILL.md',
  'skills/rules/timing.md',
  'skills/rules/animations.md',
  'skills/rules/sequencing.md',
  'skills/rules/transitions.md',
  'skills/rules/text-animations.md',
  'skills/rules/charts.md',
  'skills/rules/display-captions.md',
  'skills/rules/assets.md',
  'skills/rules/images.md',
  'skills/rules/fonts.md',
  'skills/rules/measuring-text.md',
];

export async function buildSceneCodegenContext(sceneId) {
  const number = sceneNumber(sceneId);
  const script = await readJsonFile(SCRIPT_PATH);
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);

  const fps = script.fps ?? 30;
  const captionsRel = `public/captions/${sceneId}.json`;
  const captions = await readJsonFile(path.join(ROOT, captionsRel)).catch(() => null);
  const generatedSceneRel = `src/scenes/generated/Scene${number}.generated.tsx`;
  const briefColors = extractHexColors([scene.designNotes, scene.tuningNotes].filter(Boolean).join('\n'));
  const sceneAssets = normalizeSceneAssets(scene.assets, {
    includeStaticFilePath: true,
    includeAbsolutePath: true,
    root: ROOT,
  });
  const skillSummary = selectedRuleFiles.map((file) => `- ${file}`).join('\n');
  const cueTimelineMarkdown = buildCueTimelineMarkdown(captions?.cues ?? [], fps);

  const context = {
    sceneId,
    fps,
    targetFile: generatedSceneRel,
    allowedWriteFiles: [generatedSceneRel],
    forbiddenWriteGlobs: [
      'server.mjs',
      'editor/**',
      'src/Root.tsx',
      'src/scenes/Scene*.tsx',
      'package*.json',
    ],
    validationCommands: [
      'npx tsc --noEmit',
      'npm run editor:build',
    ],
    packageDependencies: Object.keys(await readJsonFile(path.join(ROOT, 'package.json')).then((packageJson) => ({
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    })).catch(() => ({}))).sort(),
    scene: {
      text: scene.text,
      designNotes: scene.designNotes ?? '',
      tuningNotes: scene.tuningNotes ?? '',
      briefColors,
      assets: sceneAssets,
    },
    alignment: captions ? {
      audioFile: captions.audioFile,
      durationInFrames: captions.durationInFrames,
      durationInSeconds: secondsFromFrames(captions.durationInFrames, fps),
      alignmentSource: captions.alignmentSource,
      wordTimingSource: captions.wordTimingSource,
      cueCount: Array.isArray(captions.cues) ? captions.cues.length : 0,
      cues: summarizeCues(captions.cues),
    } : null,
  };

  const sections = [
    '# Remotion Scene Codegen Task',
    '',
    'Use the provided context in this exact priority order:',
    '1. `scene.designNotes` visual brief',
    '2. `scene.tuningNotes` fine-tuning instructions',
    '3. `scene.assets` user images, separated into render materials and visual references',
    '4. Timestamped captions in `alignment.cues[].words[]`',
    '5. File contract, available imports, and local references',
    '6. Skill rule files as an implementation cookbook',
    '',
    'You are editing one Remotion scene only. Follow the file/interface contract and preserve the exported component name.',
    '',
    'Be visually creative. The constraints are about where you may write and how timing data must be used, not about making the visual content conservative.',
    'Use the narration, design notes, and word-level timestamps as anchors for an original Remotion scene.',
    'The creative brief in scene.designNotes and scene.tuningNotes is primary. Translate it into bespoke Remotion visuals, not a generic title/caption template.',
    'Treat this as a fresh design pass driven by the brief and aligned captions, not as an incremental edit of a pre-existing generic layout.',
    'Use the included skill rules as an effects cookbook. Pick animation, text reveal, transition, chart/diagram, shape, or asset patterns that match the brief. Do not copy package imports from examples unless the package exists in package.json.',
    'Use `render` images as visible Remotion materials only when they support the scene. Use `reference` images only to match visual direction; do not place reference-only images into the rendered frame. Use `both` images for either purpose.',
    'Do not hard-code uploaded image ids, filenames, or `public/assets/scenes/...` paths from design notes or examples. Pick images from `assets` at runtime by role, derive the staticFile path from `asset.file`, and render no image if the asset has been deleted.',
    'Scene length and cue count vary. Do not assume the scene is short, do not assume there are only one or two cues, and do not build a first-sentence-only intro. The main visual timeline must respond to every cue in Task JSON.',
    'Do not hard-code narration text, fixed cue title arrays, or fixed sentence arrays. Derive displayed narration and beat state from cues/cue.text/cue.words at runtime. Generic colors, shapes, and layout constants are fine.',
    '',
    'Important import path rule: the target file is inside src/scenes/generated. Imports from src/types, src/hooks, and src/components must go up two levels, for example ../../types, ../../hooks/useSceneProgress, and ../../components/Background. If you copy imports from src/scenes/SceneX.tsx, add one extra ../.',
    'Important TypeScript style rule: if a style object is stored in a variable, annotate it as React.CSSProperties so CSS literal fields such as textAlign and position keep valid narrow types.',
    '',
    fenced('Scene Narration (Primary)', 'text', scene.text || '(empty)'),
    fenced('Visual Design Brief (Primary)', 'md', scene.designNotes || 'No design notes provided.'),
    fenced('Fine-tuning Notes (Primary)', 'md', scene.tuningNotes || 'No tuning notes provided.'),
    fenced('User Image Assets and Visual References (Primary)', 'md', buildSceneAssetsMarkdown(sceneAssets, {root: ROOT})),
    fenced('Timestamped Subtitle Timeline (Primary)', 'md', cueTimelineMarkdown),
    fenced('Skills Included', 'md', skillSummary),
    fenced('Task JSON', 'json', JSON.stringify(context, null, 2)),
    fenced('Generated Scene Contract', 'md', await readText('src/scenes/generated/CONTRACT.md')),
    fenced('Types', 'ts', await readText('src/types.ts')),
    fenced('useSceneProgress Hook', 'ts', await readText('src/hooks/useSceneProgress.ts')),
    fenced('Caption Overlay Reference', 'tsx', await readText('src/components/Captions.tsx')),
    fenced('Background Components Reference', 'tsx', await readText('src/components/Background.tsx')),
    ...await Promise.all(selectedRuleFiles.map(async (file) => fenced(`Rule: ${file}`, file.endsWith('.md') ? 'md' : 'tsx', await readText(file)))),
  ];

  return {
    context,
    markdown: sections.join('\n'),
    jsonOut: path.join(OUT_DIR, `${sceneId}.codegen.json`),
    mdOut: path.join(OUT_DIR, `${sceneId}.codegen.md`),
  };
}

export async function writeSceneCodegenContext(sceneId, {log = true} = {}) {
  const result = await buildSceneCodegenContext(sceneId);
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
