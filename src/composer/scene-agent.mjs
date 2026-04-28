#!/usr/bin/env node
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonFile} from './json-utils.mjs';
import {
  buildRepairContextMarkdown,
  buildSkillSelectionContext,
  writeSceneCodegenContext,
} from './scene-codegen-context.mjs';
import {toRemotionStaticFilePath} from './scene-assets.mjs';
import {
  buildFallbackBlueprint as buildSubagentFallbackBlueprint,
  makeCodeWriterSystemPrompt,
  makeCodeWriterUserPrompt,
  makeRepairUserPrompt,
  makeSkillSelectorSystemPrompt,
  makeSkillSelectorUserPrompt,
  makeVisualDirectorSystemPrompt,
  makeVisualDirectorUserPrompt,
} from './scene-codegen/subagent-prompts.mjs';
import {createBaseSkillSelection, normalizeSkillSelection} from './scene-codegen/skill-librarian.mjs';

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, 'src/composer/script.json');
const CONTEXT_DIR = path.join(ROOT, '.scene-codegen');
const DEFAULT_REPAIR_ATTEMPTS = 2;

const usage = [
  'Usage: npm run scene:agent -- scene1 [--model model] [--provider openai] [--repairs 1] [--no-check] [--dry-run]',
  '',
  'Generates one Remotion scene file under src/scenes/generated/SceneX.generated.tsx.',
].join('\n');

function parseArgs(argv) {
  const args = {
    sceneId: null,
    model: process.env.SCENE_AGENT_MODEL || null,
    provider: null,
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
  if (args.provider && args.provider !== 'openai') {
    throw new Error('--provider must be openai');
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

async function buildContext(sceneId, {onLog, skillSelection = null} = {}) {
  logLine(onLog, `[scene-agent] Building context for ${sceneId}`);
  const result = await writeSceneCodegenContext(sceneId, {log: false, skillSelection});
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

  if (provider !== 'openai') {
    throw new Error(`Unsupported codegen provider: ${provider}`);
  }

  return {provider};
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

function parseJsonObject(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(body);
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
    for (const part of normalized.split(/[锛屻€傦紒锛熴€?.!?:锛?\-鈥攟/\\]+/)) {
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
  return /[\uFFFD\u934F\u95AB\u68F6\u748B\u6D60\u6D94]|(?:脙|脗|芒鈧瑋芒鈧劉|芒鈧搢芒鈧拷)/.test(String(text));
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
  const renderableAssets = (context.scene?.assets ?? [])
    .filter((asset) => asset.role === 'render' || asset.role === 'both');
  if (renderableAssets.length > 0) {
    const usesRuntimeAssets = /\bassets\b/.test(code);
    const usesStaticFile = /\bstaticFile\s*\(/.test(code);
    const imageAssets = renderableAssets.filter((asset) => (asset.assetType ?? 'image') === 'image');
    const videoAssets = renderableAssets.filter((asset) => asset.assetType === 'video');
    const audioAssets = renderableAssets.filter((asset) => asset.assetType === 'audio');
    const usesRemotionImg = /\bImg\b/.test(code) && usesStaticFile;
    const usesRemotionVideo = /\bVideo\b/.test(code) && usesStaticFile;
    const usesRemotionAudio = /\bAudio\b/.test(code) && usesStaticFile;
    const mentionsRenderableRole = /role\b[\s\S]{0,120}(?:render|both)|(?:render|both)[\s\S]{0,120}\brole\b/.test(code);
    const mentionsAssetType = /assetType\b[\s\S]{0,120}(?:image|video|audio)|(?:image|video|audio)[\s\S]{0,120}\bassetType\b/.test(code);
    const excludesReferenceOnly = /role\b[\s\S]{0,120}reference|reference[\s\S]{0,120}\brole\b/.test(code);
    if (!usesRuntimeAssets || !usesStaticFile) {
      problems.push('Scene has @mentioned user media assets; generated code must select them from the runtime assets prop and use staticFile()');
    }
    if (imageAssets.length > 0 && !usesRemotionImg) {
      problems.push('Scene has @mentioned image assets; generated code must render visible render/both images with Remotion <Img> and staticFile()');
    }
    if (videoAssets.length > 0 && !usesRemotionVideo) {
      problems.push('Scene has @mentioned video assets; generated code must render videos with Remotion <Video> from @remotion/media and staticFile()');
    }
    if (audioAssets.length > 0 && !usesRemotionAudio) {
      problems.push('Scene has @mentioned audio assets; generated code must render timed audio/SFX with Remotion <Audio> from @remotion/media and staticFile()');
    }
    if (!mentionsRenderableRole && !mentionsAssetType && !excludesReferenceOnly) {
      problems.push('Generated code must select uploaded media by alias, role, or assetType so reference-only images are not rendered and the correct media is used');
    }
  }
  for (const asset of context.scene?.assets ?? []) {
    const publicPath = String(asset.file || '').replace(/\\/g, '/');
    const staticPath = asset.staticFilePath || toRemotionStaticFilePath(publicPath);
    const hardcodedAssetTokens = [asset.id, publicPath, staticPath].filter(Boolean);
    const hardcodedAssetToken = hardcodedAssetTokens.find((token) => code.includes(token));
    if (hardcodedAssetToken) {
      problems.push(`Do not hard-code uploaded media ids or paths in generated scenes; select assets from the assets prop at runtime instead: ${hardcodedAssetToken}`);
    }
    if ((asset.assetType ?? 'image') === 'image' && asset.role === 'reference') {
      if (publicPath && (code.includes(publicPath) || code.includes(staticPath))) {
        problems.push(`Reference-only image must not be rendered directly: ${asset.name || asset.id}`);
      }
    }
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

async function selectSkillsWithMainAgent(selectionContext, {model, provider, onLog} = {}) {
  const fallback = createBaseSkillSelection({
    reason: provider === 'openai'
      ? 'fallback base rules after skill selection failure'
      : 'base rules for non-LLM provider',
  });
  if (provider !== 'openai') return fallback;

  try {
    logLine(onLog, `[scene-agent] Main Agent selecting skill rules for ${selectionContext.context.sceneId}`);
    const response = await chat([
      {role: 'system', content: makeSkillSelectorSystemPrompt()},
      {
        role: 'user',
        content: makeSkillSelectorUserPrompt(selectionContext.markdown),
      },
    ], {model, temperature: 0.1});
    const parsed = parseJsonObject(response);
    const selection = normalizeSkillSelection({
      selectedRuleFiles: parsed.selectedRuleFiles,
      reasons: parsed.reasons,
      mode: 'generate',
      source: 'llm',
    });
    logLine(onLog, `[scene-agent] Main Agent selected ${selection.selected.length} conditional skill rules`);
    return selection;
  } catch (error) {
    logLine(onLog, `[scene-agent] Skill selection failed; using base rules only: ${error.message || error}`);
    return fallback;
  }
}

async function planSceneBlueprint(contextMarkdown, {model}) {
  return chat([
    {role: 'system', content: makeVisualDirectorSystemPrompt()},
    {role: 'user', content: makeVisualDirectorUserPrompt(contextMarkdown)},
  ], {model, temperature: 0.2});
}

async function generateScene(contextMarkdown, blueprint, {model}) {
  const response = await chat([
    {role: 'system', content: makeCodeWriterSystemPrompt()},
    {role: 'user', content: makeCodeWriterUserPrompt(contextMarkdown, blueprint)},
  ], {model, temperature: 0.4});
  return extractCode(response);
}

async function repairScene(repairContextMarkdown, code, {model}) {
  const response = await chat([
    {role: 'system', content: makeCodeWriterSystemPrompt()},
    {role: 'user', content: makeRepairUserPrompt({repairContextMarkdown, code})},
  ], {model, temperature: 0.2});
  return extractCode(response);
}

export async function runSceneAgent(options = {}) {
  const args = {
    sceneId: options.sceneId,
    model: options.model ?? process.env.SCENE_AGENT_MODEL ?? null,
    provider: options.provider ?? null,
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
  logLine(args.onLog, `[scene-agent] Building skill-selection context for ${args.sceneId}`);
  const selectionContext = await buildSkillSelectionContext(args.sceneId);
  const skillSelection = await selectSkillsWithMainAgent(selectionContext, {
    model: args.model,
    provider: args.dryRun ? 'dry-run' : codegenSettings.provider,
    onLog: args.onLog,
  });
  const {markdown, json} = await buildContext(args.sceneId, {
    onLog: args.onLog,
    skillSelection,
  });
  const targetPath = ensureAllowedTarget(json.targetFile, json.allowedWriteFiles);
  const previousCode = args.check ? await fs.readFile(targetPath, 'utf-8').catch(() => null) : null;

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
  let blueprint = buildSubagentFallbackBlueprint(json);
  if (codegenSettings.provider === 'openai') {
    logLine(args.onLog, `[scene-agent] Planning brief for ${args.sceneId}`);
    blueprint = await planSceneBlueprint(markdown, {model: args.model});
    if (looksLikeMojibake(blueprint)) {
      logLine(args.onLog, '[scene-agent] Planning brief contained mojibake; using local context fallback blueprint');
      blueprint = buildSubagentFallbackBlueprint(json);
    }
  } else {
    logLine(args.onLog, `[scene-agent] Using local context blueprint for ${args.sceneId}`);
  }
  const blueprintPath = path.join(CONTEXT_DIR, `${args.sceneId}.codegen.blueprint.md`);
  await fs.mkdir(CONTEXT_DIR, {recursive: true});
  await fs.writeFile(blueprintPath, blueprint.trimEnd() + '\n', 'utf-8');
  logLine(args.onLog, `Wrote ${path.relative(ROOT, blueprintPath)}`);

  let code = await generateScene(markdown, blueprint, {model: args.model});

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
        const repairContextMarkdown = await buildRepairContextMarkdown({
          context: json,
          blueprint,
          validationError: message,
        });
        code = await repairScene(repairContextMarkdown, code, {model: args.model});
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
