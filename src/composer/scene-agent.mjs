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
  'Usage: npm run scene:agent -- scene1 [--model model] [--repairs 1] [--no-check] [--dry-run]',
  '',
  'Generates one Remotion scene file under src/scenes/generated/SceneX.generated.tsx.',
].join('\n');

function parseArgs(argv) {
  const args = {
    sceneId: null,
    model: process.env.SCENE_AGENT_MODEL || null,
    repairs: DEFAULT_REPAIR_ATTEMPTS,
    check: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model') {
      args.model = argv[++i];
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
    model: modelOverride || process.env.OPENAI_MODEL || script.llmModel || 'gpt-4o-mini',
  };
}

async function chat(messages, {model} = {}) {
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
      temperature: 0.8,
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

function validateGeneratedCode(code, context) {
  const sceneId = context.sceneId;
  const number = sceneNumber(sceneId);
  const exportName = `Scene${number}Generated`;
  const problems = [];
  const cueCount = context.alignment?.cues?.length ?? 0;

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
    if (/\b(?:const|let)\s+\w*(?:TITLE|TITLES|HEADLINE|HEADLINES|SENTENCE|SENTENCES|CAPTION|CAPTIONS|BEAT|BEATS)\w*\s*=\s*\[/i.test(code)) {
      problems.push('Do not hard-code cue title/headline/sentence arrays; derive narration-driven labels from cues at runtime');
    }
  }
  const importMatches = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)];
  for (const match of importMatches) {
    const specifier = match[1];
    if (!relativeImportExists(specifier, sceneId)) {
      problems.push(`Relative import does not resolve from src/scenes/generated: ${specifier}`);
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
    'The hard constraints are file scope, export shape, existing dependencies, and timing alignment.',
    'Scene length and cue count are variable. Never assume a fixed number of cues or fixed duration.',
    'For multi-cue scenes, the main visual composition must process the full cues array at runtime using cues.map/find/findIndex/filter/reduce/some or equivalent logic.',
    'Do not hard-code narration text, cue title arrays, sentence arrays, or first-cue-only headline text. Use cues, cue.text, and cue.words as runtime data.',
    'CaptionOverlay may be used, but it cannot be the only part of the scene that follows the cues.',
    'The output file is in src/scenes/generated. Use ../../types, ../../hooks/useSceneProgress, ../../components/Background, and ../../components/Captions for local imports outside src/scenes.',
    'If you copy imports from src/scenes/SceneX.tsx, add one extra ../ because generated files are one directory deeper.',
    'When hoisting style objects into variables, annotate them as React.CSSProperties to avoid CSS literal types widening to string.',
    'Use cues and word timings as anchors for reveals, highlights, camera moves, and text emphasis.',
    'Keep the scene deterministic and render-safe in Remotion.',
    'Do not use network requests, browser storage, document/window APIs, Node APIs, or new package imports.',
  ].join('\n');
}

function makeInitialUserPrompt(contextMarkdown) {
  return [
    'Generate the target Remotion scene from this context.',
    'Only output the full contents of the target SceneX.generated.tsx file.',
    'The generated visual must cover all cues in the Task JSON, not just the first sentence.',
    'Derive any narration text from props.cues at runtime instead of embedding copied scene text into string literals.',
    '',
    contextMarkdown,
  ].join('\n');
}

function makeRepairPrompt(contextMarkdown, code, validationError) {
  return [
    'The generated file failed validation. Return a corrected complete TSX file only.',
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

async function generateScene(contextMarkdown, {model}) {
  const response = await chat([
    {role: 'system', content: makeSystemPrompt()},
    {role: 'user', content: makeInitialUserPrompt(contextMarkdown)},
  ], {model});
  return extractCode(response);
}

async function repairScene(contextMarkdown, code, validationError, {model}) {
  const response = await chat([
    {role: 'system', content: makeSystemPrompt()},
    {role: 'user', content: makeRepairPrompt(contextMarkdown, code, validationError)},
  ], {model});
  return extractCode(response);
}

export async function runSceneAgent(options = {}) {
  const args = {
    sceneId: options.sceneId,
    model: options.model ?? process.env.SCENE_AGENT_MODEL ?? null,
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

  const {markdown, json} = await buildContext(args.sceneId, {onLog: args.onLog});
  const targetPath = ensureAllowedTarget(json.targetFile, json.allowedWriteFiles);
  const previousCode = args.check ? await fs.readFile(targetPath, 'utf-8').catch(() => null) : null;

  if (args.dryRun) {
    logLine(args.onLog, `[scene-agent] Dry run OK`);
    logLine(args.onLog, `[scene-agent] Context: ${path.relative(ROOT, path.join(CONTEXT_DIR, `${args.sceneId}.codegen.md`))}`);
    logLine(args.onLog, `[scene-agent] Target: ${path.relative(ROOT, targetPath)}`);
    return {
      sceneId: args.sceneId,
      targetFile: path.relative(ROOT, targetPath).replace(/\\/g, '/'),
      dryRun: true,
    };
  }

  logLine(args.onLog, `[scene-agent] Generating ${path.relative(ROOT, targetPath)}`);
  let code = await generateScene(markdown, {model: args.model});
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

  try {
    for (let attempt = 0; attempt <= args.repairs; attempt += 1) {
      try {
        await runChecks({onLog: args.onLog});
        logLine(args.onLog, `[scene-agent] Done: ${path.relative(ROOT, targetPath)}`);
        return {
          sceneId: args.sceneId,
          targetFile: path.relative(ROOT, targetPath).replace(/\\/g, '/'),
          checked: true,
        };
      } catch (error) {
        if (attempt >= args.repairs) throw error;
        logLine(args.onLog, `[scene-agent] Validation failed, asking LLM to repair (${attempt + 1}/${args.repairs})`);
        code = await repairScene(markdown, code, error.message || String(error), {model: args.model});
        await writeGeneratedFile(json, code);
        logLine(args.onLog, `[scene-agent] Wrote repaired ${path.relative(ROOT, targetPath)}`);
      }
    }
  } catch (error) {
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
