#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {readJsonFile} from './json-utils.mjs';

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
}));

const selectedRuleFiles = [
  'skills/SKILL.md',
  'skills/rules/timing.md',
  'skills/rules/animations.md',
  'skills/rules/sequencing.md',
  'skills/rules/display-captions.md',
  'skills/rules/assets.md',
  'skills/rules/measuring-text.md',
];

async function main() {
  const sceneId = process.argv[2];
  if (!sceneId) {
    throw new Error('Usage: node src/composer/scene-codegen-context.mjs scene1');
  }

  const number = sceneNumber(sceneId);
  const script = await readJsonFile(SCRIPT_PATH);
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);

  const captionsRel = `public/captions/${sceneId}.json`;
  const captions = await readJsonFile(path.join(ROOT, captionsRel)).catch(() => null);
  const baseSceneRel = `src/scenes/Scene${number}.tsx`;
  const generatedSceneRel = `src/scenes/generated/Scene${number}.generated.tsx`;

  const context = {
    sceneId,
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
    scene: {
      text: scene.text,
      designNotes: scene.designNotes ?? '',
      tuningNotes: scene.tuningNotes ?? '',
    },
    alignment: captions ? {
      audioFile: captions.audioFile,
      durationInFrames: captions.durationInFrames,
      alignmentSource: captions.alignmentSource,
      wordTimingSource: captions.wordTimingSource,
      cues: summarizeCues(captions.cues),
    } : null,
  };

  const sections = [
    '# Remotion Scene Codegen Task',
    '',
    'You are editing one Remotion scene only. Follow the file/interface contract and preserve the exported component name.',
    '',
    'Be visually creative. The constraints are about where you may write and how timing data must be used, not about making the visual content conservative.',
    'Use the narration, design notes, and word-level timestamps as anchors for an original Remotion scene.',
    '',
    fenced('Task JSON', 'json', JSON.stringify(context, null, 2)),
    fenced('Generated Scene Contract', 'md', await readText('src/scenes/generated/CONTRACT.md')),
    fenced('Current Target File', 'tsx', await readText(generatedSceneRel)),
    fenced('Existing Base Scene Reference', 'tsx', await readText(baseSceneRel)),
    fenced('Types', 'ts', await readText('src/types.ts')),
    fenced('useSceneProgress Hook', 'ts', await readText('src/hooks/useSceneProgress.ts')),
    fenced('Caption Overlay Reference', 'tsx', await readText('src/components/Captions.tsx')),
    fenced('Background Components Reference', 'tsx', await readText('src/components/Background.tsx')),
    ...await Promise.all(selectedRuleFiles.map(async (file) => fenced(`Rule: ${file}`, file.endsWith('.md') ? 'md' : 'tsx', await readText(file)))),
  ];

  await fs.mkdir(OUT_DIR, {recursive: true});
  const jsonOut = path.join(OUT_DIR, `${sceneId}.codegen.json`);
  const mdOut = path.join(OUT_DIR, `${sceneId}.codegen.md`);
  await fs.writeFile(jsonOut, JSON.stringify(context, null, 2), 'utf-8');
  await fs.writeFile(mdOut, sections.join('\n'), 'utf-8');
  console.log(`Wrote ${path.relative(ROOT, jsonOut)}`);
  console.log(`Wrote ${path.relative(ROOT, mdOut)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
