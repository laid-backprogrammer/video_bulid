#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {readJsonFile} from './json-utils.mjs';
import {writeSceneCodegenContext} from './scene-codegen-context.mjs';

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, 'src/composer/script.json');
const CONTEXT_DIR = path.join(ROOT, '.scene-codegen');
const DEFAULT_REPAIR_ATTEMPTS = 1;

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

async function buildContext(sceneId) {
  console.log(`[scene-agent] Building context for ${sceneId}`);
  const result = await writeSceneCodegenContext(sceneId);
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
    return fenced[0][1].trim();
  }
  return text.trim();
}

function validateGeneratedCode(code, sceneId) {
  const number = sceneNumber(sceneId);
  const exportName = `Scene${number}Generated`;
  const problems = [];

  if (!code.includes(`export const ${exportName}`)) {
    problems.push(`Missing required export: ${exportName}`);
  }
  if (!code.includes('SegmentCue')) {
    problems.push('Generated file must type props with SegmentCue');
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
  validateGeneratedCode(code, context.sceneId);
  const target = ensureAllowedTarget(context.targetFile, context.allowedWriteFiles);
  await fs.writeFile(target, code.trimEnd() + '\n', 'utf-8');
  return target;
}

async function runChecks() {
  const checks = [
    ['npx', ['tsc', '--noEmit']],
    ['npm', ['run', 'editor:build']],
  ];
  const outputs = [];

  for (const [command, args] of checks) {
    console.log(`[scene-agent] Running ${command} ${args.join(' ')}`);
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
    'Use cues and word timings as anchors for reveals, highlights, camera moves, and text emphasis.',
    'Keep the scene deterministic and render-safe in Remotion.',
    'Do not use network requests, browser storage, document/window APIs, Node APIs, or new package imports.',
  ].join('\n');
}

function makeInitialUserPrompt(contextMarkdown) {
  return [
    'Generate the target Remotion scene from this context.',
    'Only output the full contents of the target SceneX.generated.tsx file.',
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {markdown, json} = await buildContext(args.sceneId);
  const targetPath = ensureAllowedTarget(json.targetFile, json.allowedWriteFiles);

  if (args.dryRun) {
    console.log(`[scene-agent] Dry run OK`);
    console.log(`[scene-agent] Context: ${path.relative(ROOT, path.join(CONTEXT_DIR, `${args.sceneId}.codegen.md`))}`);
    console.log(`[scene-agent] Target: ${path.relative(ROOT, targetPath)}`);
    return;
  }

  console.log(`[scene-agent] Generating ${path.relative(ROOT, targetPath)}`);
  let code = await generateScene(markdown, {model: args.model});
  await writeGeneratedFile(json, code);

  if (!args.check) {
    console.log(`[scene-agent] Wrote ${path.relative(ROOT, targetPath)} without validation (--no-check)`);
    return;
  }

  for (let attempt = 0; attempt <= args.repairs; attempt += 1) {
    try {
      await runChecks();
      console.log(`[scene-agent] Done: ${path.relative(ROOT, targetPath)}`);
      return;
    } catch (error) {
      if (attempt >= args.repairs) throw error;
      console.log(`[scene-agent] Validation failed, asking LLM to repair (${attempt + 1}/${args.repairs})`);
      code = await repairScene(markdown, code, error.message || String(error), {model: args.model});
      await writeGeneratedFile(json, code);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
