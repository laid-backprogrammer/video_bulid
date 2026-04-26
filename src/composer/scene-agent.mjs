#!/usr/bin/env node
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonFile} from './json-utils.mjs';
import {writeSceneCodegenContext} from './scene-codegen-context.mjs';

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, 'src/composer/script.json');
const CONTEXT_DIR = path.join(ROOT, '.scene-codegen');
const DEFAULT_REPAIR_ATTEMPTS = 2;

const usage = [
  'Usage: npm run scene:agent -- scene1 [--model model] [--provider openai|external-cli] [--cli-command command] [--repairs 1] [--no-check] [--dry-run]',
  '',
  'Generates one Remotion scene file under src/scenes/generated/SceneX.generated.tsx.',
].join('\n');

function parseArgs(argv) {
  const args = {
    sceneId: null,
    model: process.env.SCENE_AGENT_MODEL || null,
    provider: null,
    cliCommand: process.env.SCENE_AGENT_CLI_COMMAND || null,
    repairs: DEFAULT_REPAIR_ATTEMPTS,
    check: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model') {
      args.model = argv[++i];
    } else if (arg === '--provider') {
      args.provider = argv[++i];
    } else if (arg === '--cli-command') {
      args.cliCommand = argv[++i];
    } else if (arg === '--repairs') {
      args.repairs = Number(argv[++i]);
    } else if (arg === '--no-check') {
      args.check = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.check = false;
    } else if (!args.sceneId) {
      args.sceneId = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sceneId) throw new Error(usage);
  if (!/^scene\d+$/i.test(args.sceneId)) {
    throw new Error('sceneId must look like scene1, scene2, ...');
  }
  if (!Number.isInteger(args.repairs) || args.repairs < 0 || args.repairs > 3) {
    throw new Error('--repairs must be an integer from 0 to 3');
  }
  if (args.provider && !['openai', 'external-cli'].includes(args.provider)) {
    throw new Error('--provider must be openai or external-cli');
  }
  return args;
}

function sceneNumber(sceneId) {
  const match = String(sceneId).match(/(\d+)$/);
  if (!match) throw new Error(`Scene id must end with a number: ${sceneId}`);
  return match[1];
}

function toAbs(relOrAbs) {
  return path.resolve(ROOT, relOrAbs);
}

function normalizePathForCompare(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function ensureAllowedTarget(targetFile, allowedWriteFiles) {
  const target = normalizePathForCompare(toAbs(targetFile));
  const allowed = allowedWriteFiles.map((file) => normalizePathForCompare(toAbs(file)));
  if (!allowed.includes(target)) {
    throw new Error(`Refusing to write outside allowed files: ${targetFile}`);
  }
  return toAbs(targetFile);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: options.shell ?? false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.stream) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      resolve({ok: false, code: null, stdout, stderr: stderr + error.message});
    });
    child.on('close', (code) => {
      resolve({ok: code === 0, code, stdout, stderr});
    });
  });
}

function runShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: ROOT,
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.stream) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      resolve({ok: false, code: null, stdout, stderr: stderr + error.message});
    });
    child.on('close', (code) => {
      resolve({ok: code === 0, code, stdout, stderr});
    });
    child.stdin?.on('error', () => {});
    if (typeof options.stdin === 'string' && options.stdin.length > 0) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.destroy();
    }
  });
}

function logLine(onLog, line) {
  console.log(line);
  onLog?.(line);
}

async function buildContext(sceneId, {onLog} = {}) {
  logLine(onLog, `[scene-agent] Building context for ${sceneId}`);
  const result = await writeSceneCodegenContext(sceneId, {log: false});
  logLine(onLog, `Wrote ${path.relative(ROOT, result.jsonOut)}`);
  logLine(onLog, `Wrote ${path.relative(ROOT, result.mdOut)}`);
  return {
    markdown: result.markdown,
    json: result.context,
    mdPath: result.mdOut,
    jsonPath: result.jsonOut,
  };
}

async function getLlmSettings(modelOverride) {
  const script = await readJsonFile(SCRIPT_PATH).catch(() => ({}));
  const apiKey = process.env.SCENE_AGENT_API_KEY
    || script.llmApiKey
    || script.transcribeApiKey
    || process.env.OPENAI_API_KEY
    || null;
  let baseUrl = (
    process.env.SCENE_AGENT_BASE_URL
    || process.env.OPENAI_BASE_URL
    || script.llmBaseUrl
    || script.transcribeBaseUrl
    || 'https://api.openai.com'
  ).replace(/\/$/, '');
  if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);

  return {
    apiKey,
    baseUrl,
    model: modelOverride || script.llmModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

async function getCodegenSettings(options = {}) {
  const script = await readJsonFile(SCRIPT_PATH).catch(() => ({}));
  const provider = options.provider
    || process.env.SCENE_AGENT_PROVIDER
    || script.codegenProvider
    || 'openai';
  const cliCommand = options.cliCommand
    || process.env.SCENE_AGENT_CLI_COMMAND
    || script.codegenCliCommand
    || '';

  if (!['openai', 'external-cli'].includes(provider)) {
    throw new Error(`Unsupported codegen provider: ${provider}`);
  }

  return {provider, cliCommand};
}

async function chat(messages, {model, temperature = 0.4} = {}) {
  const settings = await getLlmSettings(model);
  if (!settings.apiKey) {
    throw new Error('Missing LLM API key. Set SCENE_AGENT_API_KEY, script.llmApiKey, script.transcribeApiKey, or OPENAI_API_KEY.');
  }

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature,
    }),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    const message = data?.error?.message || text || response.statusText;
    throw new Error(`LLM request failed (model=${settings.model}): ${message}`);
  }

  const content = data?.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('LLM returned an empty response');
  return content;
}

function extractCode(text) {
  const fenced = [...text.matchAll(/```(?:tsx|ts|typescript|jsx|javascript)?\s*([\s\S]*?)```/gi)];
  if (fenced.length > 0) {
    return normalizeGeneratedCode(fenced[0][1].trim());
  }
  return normalizeGeneratedCode(text.trim());
}

function normalizeGeneratedCode(code) {
  return code
    .replace(/from\s+['"]\.\.\/types['"]/g, "from '../../types'")
    .replace(/from\s+['"]\.\.\/hooks\//g, "from '../../hooks/")
    .replace(/from\s+['"]\.\.\/components\//g, "from '../../components/");
}

function relativeImportExists(specifier, sceneId) {
  if (!specifier.startsWith('.')) return true;
  const sourceDir = path.join(ROOT, 'src/scenes/generated');
  const resolved = path.resolve(sourceDir, specifier);
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

function packageNameFromImport(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return scope && name ? `${scope}/${name}` : specifier;
  }
  return specifier.split('/')[0];
}

function narrationSnippets(context) {
  const snippets = new Set();
  const addPieces = (text) => {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    for (const part of normalized.split(/[，。！？、,.!?:；;\-—|/\\]+/)) {
      const clean = part.trim();
      if (clean.length >= 6) snippets.add(clean);
      if (clean.length >= 10) {
        snippets.add(clean.slice(0, 8));
        snippets.add(clean.slice(-8));
      }
    }
  };

  addPieces(context.scene?.text);
  for (const cue of context.alignment?.cues ?? []) {
    addPieces(cue.text);
  }
  return [...snippets].filter((snippet) => snippet.length >= 6);
}

function looksLikeMojibake(text = '') {
  return /[\uFFFD\u934F\u95AB\u68F6\u748B\u6D60\u6D94]|(?:Ã|Â|â€|â€™|â€œ|â€�)/.test(String(text));
}

function buildFallbackBlueprint(context) {
  const scene = context.scene ?? {};
  const alignment = context.alignment ?? {};
  const colors = Array.isArray(scene.briefColors) && scene.briefColors.length > 0
    ? scene.briefColors.join(', ')
    : 'No explicit hex colors found.';
  const cueSummary = Array.isArray(alignment.cues)
    ? `${alignment.cues.length} cues, ${alignment.durationInFrames ?? 'unknown'} frames, ${alignment.durationInSeconds ?? 'unknown'} seconds`
    : 'No aligned cue timeline.';

  return [
    '# Required Visual Brief',
    scene.designNotes || 'No visual design brief provided.',
    '',
    '# Required Timeline Beats',
    'Use the percentage beats and pacing described in the visual design brief. Map them onto the actual duration in frames.',
    `Timing summary: ${cueSummary}.`,
    '',
    '# Required Cue and Word Timing Usage',
    'Drive active captions, word highlights, emphasis, and visual state from alignment.cues and cue.words at runtime.',
    '',
    '# Required Subtitle Placement',
    scene.designNotes?.match(/字幕位置[\s\S]*?(?=\n\n## |\n# |$)/)?.[0]
      || 'Follow subtitle placement from the visual design brief or tuning notes.',
    '',
    '# Must-Have Visual Elements',
    `Use specified colors: ${colors}.`,
    scene.tuningNotes || 'No fine-tuning notes provided.',
    '',
    '# Avoid Generic Layouts',
    'Do not reduce the scene to a centered headline or subtitle-only template. Make the visual objects, palette, pacing, transitions, and subtitle placement traceable to the brief.',
  ].join('\n');
}

function validateGeneratedCode(code, context) {
  const sceneId = context.sceneId;
  const number = sceneNumber(sceneId);
  const exportName = `Scene${number}Generated`;
  const problems = [];
  const cueCount = context.alignment?.cues?.length ?? 0;
  const totalWordCount = (context.alignment?.cues ?? []).reduce((sum, cue) => sum + (cue.words?.length ?? 0), 0);

  if (!code.includes(`export const ${exportName}`)) {
    problems.push(`Missing required export: ${exportName}`);
  }
  if (!code.includes('SegmentCue')) {
    problems.push('Generated file must type props with SegmentCue');
  }
  if (/from\s+['"]\.\.\/(?:types|hooks\/|components\/)/.test(code)) {
    problems.push('Generated file is in src/scenes/generated; imports to types/hooks/components must use ../../, not ../');
  }
  if (cueCount > 1) {
    const fullCueUse = /\b(?:cues|safeCues|timelineCues|sceneCues|visibleCues)\s*\.\s*(?:map|find|findIndex|filter|reduce|some)\s*\(/.test(code);
    if (!fullCueUse) {
      problems.push('Multi-cue scenes must process the full cues array for the main visuals; do not rely only on a first headline or CaptionOverlay');
    }
    if (/\bcues\s*\[\s*0\s*\]|\bcues\s*\.at\s*\(\s*0\s*\)/.test(code)) {
      problems.push('Do not build the scene around only cues[0]; support every cue dynamically');
    }
    if (/\b(?:cues|safeCues|timelineCues|sceneCues|visibleCues)\s*\[\s*\d+\s*\]|\b(?:cues|safeCues|timelineCues|sceneCues|visibleCues)\s*\.at\s*\(\s*\d+\s*\)|\b(?:cues|safeCues|timelineCues|sceneCues|visibleCues)\s*\.slice\s*\(\s*\d+/i.test(code)) {
      problems.push('Do not use fixed cue indices or cue slices as the main storytelling structure; derive visual state from the runtime cues array');
    }
    if (/\b(?:const|let)\s+\w*(?:TITLE|TITLES|HEADLINE|HEADLINES|SENTENCE|SENTENCES|CAPTION|CAPTIONS|BEAT|BEATS)\w*\s*=\s*\[/i.test(code)) {
      problems.push('Do not hard-code cue title/headline/sentence arrays; derive narration-driven labels from cues at runtime');
    }
    const hardcodedNarration = narrationSnippets(context).filter((snippet) => code.includes(snippet)).slice(0, 3);
    if (hardcodedNarration.length > 0) {
      problems.push(`Do not embed narration text directly in TSX; derive it from cues at runtime. Hard-coded snippets: ${hardcodedNarration.join(', ')}`);
    }
    if (totalWordCount > 0 && !/\.\s*words\b|\bword[A-Z_a-z0-9]*\b/.test(code)) {
      problems.push('Scenes with word timing data must use cue.words or word-level timing state for reveals, highlights, or motion accents');
    }
  }
  const importMatches = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)];
  const packageDependencies = new Set(context.packageDependencies ?? []);
  for (const match of importMatches) {
    const specifier = match[1];
    if (!relativeImportExists(specifier, sceneId)) {
      problems.push(`Relative import does not resolve from src/scenes/generated: ${specifier}`);
    }
    if (!specifier.startsWith('.')) {
      const packageName = packageNameFromImport(specifier);
      if (!packageDependencies.has(packageName)) {
        problems.push(`Package import is not installed in package.json: ${specifier}`);
      }
    }
  }
  if (/from\s+['"]fs['"]|from\s+['"]node:|require\s*\(/.test(code)) {
    problems.push('Generated Remotion scene must not import Node APIs or use require()');
  }
  if (/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.|window\./.test(code)) {
    problems.push('Generated Remotion scene must not use network or browser globals');
  }
  if (/\.generated['"]|from\s+['"]\.\.\/generated/.test(code)) {
    problems.push('Generated scene must not import other generated scenes');
  }
  if (code.includes('```')) {
    problems.push('Generated file contains Markdown fences');
  }
  if (looksLikeMojibake(code)) {
    problems.push('Generated file appears to contain mojibake/re-encoded text; preserve source text as UTF-8 or derive narration from cues at runtime');
  }

  if (problems.length > 0) {
    throw new Error(`Generated code failed local guards:\n- ${problems.join('\n- ')}`);
  }
}

async function writeGeneratedFile(context, code) {
  validateGeneratedCode(code, context);
  const target = ensureAllowedTarget(context.targetFile, context.allowedWriteFiles);
  await fs.writeFile(target, code.trimEnd() + '\n', 'utf-8');
  return target;
}

async function runChecks({onLog} = {}) {
  const checks = [
    ['npx', ['tsc', '--noEmit']],
    ['npm', ['run', 'editor:build']],
  ];
  const outputs = [];

  for (const [command, args] of checks) {
    logLine(onLog, `[scene-agent] Running ${command} ${args.join(' ')}`);
    const result = await runCommand(command, args, {
      stream: true,
      shell: process.platform === 'win32',
    });
    outputs.push([
      `$ ${command} ${args.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
    if (!result.ok) {
      const output = outputs.join('\n\n').slice(-12000);
      throw new Error(`Validation failed:\n${output}`);
    }
  }

  return outputs.join('\n\n');
}

function makeSystemPrompt() {
  return [
    'You are a constrained Remotion scene code generation agent.',
    'Return exactly one complete TSX file. Do not use Markdown fences or explanations.',
    'You may be visually creative: invent metaphors, layouts, typography, motion, symbolic UI, charts, particles, and transitions.',
    'scene.designNotes and scene.tuningNotes are the primary creative brief. Turn them into bespoke Remotion visuals instead of adapting a generic title/caption template.',
    'Before writing code, silently extract a brief-compliance checklist from scene.designNotes and scene.tuningNotes covering palette, subject elements, pacing beats, subtitle placement, and scene transitions.',
    'Treat the job as a fresh design pass. Do not preserve or imitate a previous generated layout unless it already matches the brief closely.',
    'If the brief names concrete visual elements such as silhouettes, circles, icons, charts, cards, interfaces, maps, or diagrams, render those as actual layers rather than collapsing them into one centered headline.',
    'If the brief specifies hex colors, reuse those colors or very close variants in the code.',
    'If the brief specifies subtitle placement, keep captions in that region unless the brief itself changes it.',
    'If the brief specifies pacing sections such as 0%-20%, 20%-50%, or cue-by-cue transitions, map those beats onto frame ranges and visible visual changes.',
    'Use the provided skills/rules context as an effects cookbook: choose suitable timing, sequencing, text reveal, highlight, transition, chart/diagram, shape, or asset patterns.',
    'The hard constraints are file scope, export shape, existing dependencies, and timing alignment.',
    'Scene length and cue count are variable. Never assume a fixed number of cues or fixed duration.',
    'Use exact duration and cue/word timing from alignment data. Do not round scene planning to whole seconds when the context provides fractional seconds or frame ranges.',
    'For multi-cue scenes, the main visual composition must process the full cues array at runtime using cues.map/find/findIndex/filter/reduce/some or equivalent logic.',
    'Do not use fixed cue indices such as cues[3], cues.at(5), or cues.slice(2, 4) as the main storytelling structure. Multi-cue scenes must adapt to the runtime cue array.',
    'Do not hard-code narration text, cue title arrays, sentence arrays, or first-cue-only headline text. Use cues, cue.text, and cue.words as runtime data.',
    'CaptionOverlay may be used, but it cannot be the only part of the scene that follows the cues.',
    'Pure centered headline cards, subtitle-only scenes, or generic cue lists are unacceptable when design notes ask for visual scenes, objects, diagrams, or transitions.',
    'Only import packages listed in package.json. If a skill example imports an unavailable package, adapt the idea using React/CSS/SVG/remotion APIs instead.',
    'Do not invent new local component imports unless they are present in the provided repository references and resolve from src/scenes/generated.',
    'The output file is in src/scenes/generated. Use ../../types, ../../hooks/useSceneProgress, ../../components/Background, and ../../components/Captions for local imports outside src/scenes.',
    'If you copy imports from src/scenes/SceneX.tsx, add one extra ../ because generated files are one directory deeper.',
    'When hoisting style objects into variables, annotate them as React.CSSProperties to avoid CSS literal types widening to string.',
    'Use cues and word timings as anchors for reveals, highlights, camera moves, and text emphasis.',
    'Keep the scene deterministic and render-safe in Remotion.',
    'Do not use network requests, browser storage, document/window APIs, Node APIs, or new package imports.',
  ].join('\n');
}

function makeBlueprintSystemPrompt() {
  return [
    'You are a Remotion scene planning agent.',
    'Read the provided scene context and distill only the creative and timing requirements that should control code generation.',
    'Return compact Markdown only, with these sections in order:',
    '1. Required Visual Brief',
    '2. Required Timeline Beats',
    '3. Required Cue and Word Timing Usage',
    '4. Required Subtitle Placement',
    '5. Must-Have Visual Elements',
    '6. Avoid Generic Layouts',
    'Be specific. Preserve colors, named objects, pacing phases, transitions, and subtitle constraints from the brief.',
    'For CJK source text, prefer cue IDs, percentages, and exact copied short phrases only when necessary. Never rewrite source text into mojibake or re-encoded text.',
    'Do not write code.',
  ].join('\n');
}

function makeBlueprintUserPrompt(contextMarkdown) {
  return [
    'Extract the highest-priority design and timing instructions for a single Remotion scene.',
    '',
    contextMarkdown,
  ].join('\n');
}

function makeInitialUserPrompt(contextMarkdown, blueprint) {
  return [
    'Generate the target Remotion scene from this context.',
    'Only output the full contents of the target SceneX.generated.tsx file.',
    'Start from the visual brief and timestamped captions, not from any prior generic layout.',
    'The generated visual must cover all cues in the Task JSON, not just the first sentence.',
    'Derive any narration text from props.cues at runtime instead of embedding copied scene text into string literals.',
    'Follow scene.designNotes and scene.tuningNotes directly. If they describe illustrations, transitions, charts, objects, or pacing, implement those as visual systems in code.',
    'Make the brief visibly recognizable in code: palette choices, main objects, pacing sections, subtitle placement, and transitions should all be traceable to the brief when specified.',
    '',
    'Planning Blueprint:',
    blueprint,
    '',
    'Original Context:',
    contextMarkdown,
  ].join('\n');
}

function makeRepairPrompt(contextMarkdown, blueprint, code, validationError) {
  return [
    'The generated file failed validation. Return a corrected complete TSX file only.',
    'Fix the validation issues without regressing compliance with the design brief, tuning notes, or timestamped captions.',
    'If the current layout is generic or weakly aligned to the brief, improve it while repairing.',
    '',
    'Planning Blueprint:',
    blueprint,
    '',
    'Validation error:',
    '```text',
    validationError.slice(-12000),
    '```',
    '',
    'Current generated file:',
    '```tsx',
    code,
    '```',
    '',
    'Original context:',
    contextMarkdown,
  ].join('\n');
}

function quoteArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function fillCommandTemplate(command, replacements) {
  return command.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => {
    if (Object.hasOwn(replacements, key)) return replacements[key];
    return match;
  });
}

function makeExternalCliPrompt(basePrompt, {context, promptPath, outputPath, targetPath}) {
  const rawTargetPath = path.relative(ROOT, targetPath).replace(/\\/g, '/');
  const rawOutputPath = path.relative(ROOT, outputPath).replace(/\\/g, '/');
  return [
    'You are an external Remotion code generation CLI worker.',
    `Write exactly one candidate TSX file: ${rawOutputPath}`,
    `Do not edit ${rawTargetPath} directly. Do not edit any other file.`,
    'The host process will validate the candidate and copy it to the target file if it passes.',
    'If your CLI cannot write files, print exactly one complete TSX file to stdout.',
    'Follow all constraints in the task below, especially the visual design brief, fine-tuning notes, skills, timestamped subtitle timeline, import rules, and runtime cue usage.',
    '',
    `Scene id: ${context.sceneId}`,
    `Prompt file: ${path.relative(ROOT, promptPath).replace(/\\/g, '/')}`,
    `Candidate output file: ${rawOutputPath}`,
    `Final target file, host-managed: ${rawTargetPath}`,
    '',
    basePrompt,
  ].join('\n');
}

async function runExternalSceneCli({command, prompt, context, attempt, targetPath, promptPath, outputPath, onLog}) {
  if (!command?.trim()) {
    throw new Error('Missing external codegen CLI command. Set script.codegenCliCommand or SCENE_AGENT_CLI_COMMAND.');
  }

  await fs.mkdir(CONTEXT_DIR, {recursive: true});
  const externalPrompt = makeExternalCliPrompt(prompt, {context, promptPath, outputPath, targetPath});
  await fs.writeFile(promptPath, externalPrompt.trimEnd() + '\n', 'utf-8');
  await fs.rm(outputPath, {force: true}).catch(() => {});
  logLine(onLog, `[scene-agent] Wrote external CLI prompt ${path.relative(ROOT, promptPath)}`);
  logLine(onLog, `[scene-agent] External CLI candidate path ${path.relative(ROOT, outputPath)}`);

  const rawTargetPath = path.relative(ROOT, targetPath).replace(/\\/g, '/');
  const rawPromptPath = path.relative(ROOT, promptPath).replace(/\\/g, '/');
  const rawOutputPath = path.relative(ROOT, outputPath).replace(/\\/g, '/');
  const cliPrompt = [
    `Read ${rawPromptPath}.`,
    `Write the complete TSX candidate to ${rawOutputPath}.`,
    `Do not edit ${rawTargetPath} or any other file.`,
    'Return only a short completion note after writing the file.',
  ].join(' ');
  const commandText = fillCommandTemplate(command, {
    sceneId: context.sceneId,
    attempt: String(attempt),
    prompt: quoteArg(cliPrompt),
    promptRaw: cliPrompt,
    promptFile: quoteArg(promptPath),
    promptFileRaw: rawPromptPath,
    contextFile: quoteArg(path.join(CONTEXT_DIR, `${context.sceneId}.codegen.md`)),
    contextFileRaw: `.scene-codegen/${context.sceneId}.codegen.md`,
    outputFile: quoteArg(outputPath),
    outputFileRaw: rawOutputPath,
    targetFile: quoteArg(targetPath),
    targetFileRaw: rawTargetPath,
  });

  logLine(onLog, `[scene-agent] Running external CLI: ${commandText}`);
  const result = await runShellCommand(commandText, {
    stream: false,
    stdin: command.includes('{promptFile}') || command.includes('{promptFileRaw}') ? null : prompt,
  });
  const stdoutPreview = result.stdout.trim().slice(-2000);
  const stderrPreview = result.stderr.trim().slice(-2000);
  if (stdoutPreview) logLine(onLog, `[scene-agent] External CLI stdout:\n${stdoutPreview}`);
  if (stderrPreview) logLine(onLog, `[scene-agent] External CLI stderr:\n${stderrPreview}`);
  if (!result.ok) {
    throw new Error(`External codegen CLI failed (exit=${result.code}):\n${[result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').slice(-12000)}`);
  }

  const outputCode = await fs.readFile(outputPath, 'utf-8').catch(() => '');
  if (outputCode.trim()) return extractCode(outputCode);

  const stdout = result.stdout.trim();
  if (stdout) return extractCode(stdout);

  const targetCode = await fs.readFile(targetPath, 'utf-8').catch(() => '');
  if (targetCode.trim()) return extractCode(targetCode);

  throw new Error('External codegen CLI produced no TSX on stdout, outputFile, or targetFile.');
}

async function planSceneBlueprint(contextMarkdown, {model}) {
  return chat([
    {role: 'system', content: makeBlueprintSystemPrompt()},
    {role: 'user', content: makeBlueprintUserPrompt(contextMarkdown)},
  ], {model, temperature: 0.2});
}

async function generateScene(contextMarkdown, blueprint, {model}) {
  const response = await chat([
    {role: 'system', content: makeSystemPrompt()},
    {role: 'user', content: makeInitialUserPrompt(contextMarkdown, blueprint)},
  ], {model, temperature: 0.4});
  return extractCode(response);
}

async function repairScene(contextMarkdown, blueprint, code, validationError, {model}) {
  const response = await chat([
    {role: 'system', content: makeSystemPrompt()},
    {role: 'user', content: makeRepairPrompt(contextMarkdown, blueprint, code, validationError)},
  ], {model, temperature: 0.2});
  return extractCode(response);
}

async function generateSceneWithExternalCli(contextMarkdown, blueprint, context, settings, paths, attempt, onLog) {
  const prompt = makeInitialUserPrompt(contextMarkdown, blueprint);
  return runExternalSceneCli({
    command: settings.cliCommand,
    prompt,
    context,
    attempt,
    targetPath: paths.targetPath,
    promptPath: paths.promptPath,
    outputPath: paths.outputPath,
    onLog,
  });
}

async function repairSceneWithExternalCli(contextMarkdown, blueprint, code, validationError, context, settings, paths, attempt, onLog) {
  const prompt = makeRepairPrompt(contextMarkdown, blueprint, code, validationError);
  return runExternalSceneCli({
    command: settings.cliCommand,
    prompt,
    context,
    attempt,
    targetPath: paths.targetPath,
    promptPath: paths.promptPath,
    outputPath: paths.outputPath,
    onLog,
  });
}

export async function runSceneAgent(options = {}) {
  const args = {
    sceneId: options.sceneId,
    model: options.model ?? process.env.SCENE_AGENT_MODEL ?? null,
    provider: options.provider ?? null,
    cliCommand: options.cliCommand ?? process.env.SCENE_AGENT_CLI_COMMAND ?? null,
    repairs: options.repairs ?? DEFAULT_REPAIR_ATTEMPTS,
    check: options.check ?? true,
    dryRun: options.dryRun ?? false,
    onLog: options.onLog,
  };
  if (!args.sceneId || !/^scene\d+$/i.test(args.sceneId)) {
    throw new Error('sceneId must look like scene1, scene2, ...');
  }
  if (!Number.isInteger(args.repairs) || args.repairs < 0 || args.repairs > 3) {
    throw new Error('repairs must be an integer from 0 to 3');
  }

  const codegenSettings = await getCodegenSettings(args);
  const {markdown, json} = await buildContext(args.sceneId, {onLog: args.onLog});
  const targetPath = ensureAllowedTarget(json.targetFile, json.allowedWriteFiles);
  const previousCode = args.check ? await fs.readFile(targetPath, 'utf-8').catch(() => null) : null;
  const externalPaths = {
    targetPath,
    promptPath: path.join(CONTEXT_DIR, `${args.sceneId}.codegen.external.md`),
    outputPath: path.join(CONTEXT_DIR, `${args.sceneId}.codegen.external.candidate.tsx`),
  };

  if (args.dryRun) {
    logLine(args.onLog, `[scene-agent] Dry run OK`);
    logLine(args.onLog, `[scene-agent] Context: ${path.relative(ROOT, path.join(CONTEXT_DIR, `${args.sceneId}.codegen.md`))}`);
    logLine(args.onLog, `[scene-agent] Target: ${path.relative(ROOT, targetPath)}`);
    logLine(args.onLog, `[scene-agent] Provider: ${codegenSettings.provider}`);
    return {
      sceneId: args.sceneId,
      targetFile: path.relative(ROOT, targetPath).replace(/\\/g, '/'),
      dryRun: true,
    };
  }

  logLine(args.onLog, `[scene-agent] Generating ${path.relative(ROOT, targetPath)}`);
  logLine(args.onLog, `[scene-agent] Provider: ${codegenSettings.provider}`);
  let blueprint = buildFallbackBlueprint(json);
  if (codegenSettings.provider === 'openai') {
    logLine(args.onLog, `[scene-agent] Planning brief for ${args.sceneId}`);
    blueprint = await planSceneBlueprint(markdown, {model: args.model});
    if (looksLikeMojibake(blueprint)) {
      logLine(args.onLog, '[scene-agent] Planning brief contained mojibake; using local context fallback blueprint');
      blueprint = buildFallbackBlueprint(json);
    }
  } else {
    logLine(args.onLog, `[scene-agent] Using local context blueprint for ${args.sceneId}`);
  }
  const blueprintPath = path.join(CONTEXT_DIR, `${args.sceneId}.codegen.blueprint.md`);
  await fs.mkdir(CONTEXT_DIR, {recursive: true});
  await fs.writeFile(blueprintPath, blueprint.trimEnd() + '\n', 'utf-8');
  logLine(args.onLog, `Wrote ${path.relative(ROOT, blueprintPath)}`);

  let code = codegenSettings.provider === 'external-cli'
    ? await generateSceneWithExternalCli(markdown, blueprint, json, codegenSettings, externalPaths, 0, args.onLog)
    : await generateScene(markdown, blueprint, {model: args.model});

  try {
    for (let attempt = 0; attempt <= args.repairs; attempt += 1) {
      try {
        await writeGeneratedFile(json, code);
        logLine(args.onLog, `[scene-agent] Wrote ${path.relative(ROOT, targetPath)}`);

        if (!args.check) {
          logLine(args.onLog, `[scene-agent] Wrote ${path.relative(ROOT, targetPath)} without validation (--no-check)`);
          return {
            sceneId: args.sceneId,
            targetFile: path.relative(ROOT, targetPath).replace(/\\/g, '/'),
            checked: false,
          };
        }

        await runChecks({onLog: args.onLog});
        logLine(args.onLog, `[scene-agent] Done: ${path.relative(ROOT, targetPath)}`);
        return {
          sceneId: args.sceneId,
          targetFile: path.relative(ROOT, targetPath).replace(/\\/g, '/'),
          checked: true,
        };
      } catch (error) {
        if (attempt >= args.repairs) throw error;
        const message = error.message || String(error);
        const repairReason = message.includes('Generated code failed local guards')
          ? 'Local guards failed'
          : 'Validation failed';
        logLine(args.onLog, `[scene-agent] ${repairReason}, asking ${codegenSettings.provider} to repair (${attempt + 1}/${args.repairs})`);
        code = codegenSettings.provider === 'external-cli'
          ? await repairSceneWithExternalCli(markdown, blueprint, code, message, json, codegenSettings, externalPaths, attempt + 1, args.onLog)
          : await repairScene(markdown, blueprint, code, message, {model: args.model});
      }
    }
  } catch (error) {
    const failedCandidatePath = path.join(CONTEXT_DIR, `${args.sceneId}.codegen.failed.tsx`);
    const failedErrorPath = path.join(CONTEXT_DIR, `${args.sceneId}.codegen.error.txt`);
    await fs.mkdir(CONTEXT_DIR, {recursive: true});
    await fs.writeFile(failedCandidatePath, code.trimEnd() + '\n', 'utf-8');
    await fs.writeFile(failedErrorPath, `${error.message || String(error)}\n`, 'utf-8');
    logLine(args.onLog, `[scene-agent] Saved failed candidate ${path.relative(ROOT, failedCandidatePath)}`);
    logLine(args.onLog, `[scene-agent] Saved failure log ${path.relative(ROOT, failedErrorPath)}`);
    if (previousCode !== null) {
      await fs.writeFile(targetPath, previousCode, 'utf-8');
      logLine(args.onLog, `[scene-agent] Restored previous ${path.relative(ROOT, targetPath)} after failed validation`);
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runSceneAgent(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
