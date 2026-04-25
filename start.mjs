#!/usr/bin/env node
/**
 * 统一启动脚本：一键启动编辑器 + Remotion Studio
 *
 * 用法:
 *   node start.mjs
 *   npm start
 */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

function run(name, cmd, args, opts = {}) {
  const prefix = `[${name}]`;
  const color = name === 'Studio' ? '\x1b[36m' : '\x1b[33m';
  const reset = '\x1b[0m';

  let child;
  try {
    child = spawn(cmd, args, {
      cwd: __dirname,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: isWin,
      env: {...process.env, ...opts.env},
    });
  } catch (error) {
    console.error(`${color}${prefix}${reset} 启动失败: ${error.message}`);
    console.error(`${color}${prefix}${reset} 命令: ${cmd} ${args.join(' ')}`);
    console.error(`${color}${prefix}${reset} 提示: Windows 下若遇到权限错误，可尝试先执行 "npm run editor:build"，再单独运行 "node server.mjs" 和 "npx remotion studio"。`);
    return null;
  }

  child.stdout.on('data', (buf) => {
    buf.toString().split('\n').filter(Boolean).forEach((line) => {
      console.log(`${color}${prefix}${reset} ${line}`);
    });
  });

  child.stderr.on('data', (buf) => {
    buf.toString().split('\n').filter(Boolean).forEach((line) => {
      console.log(`${color}${prefix}${reset} ${line}`);
    });
  });

  child.on('exit', (code) => {
    console.log(`${color}${prefix}${reset} 进程退出 (code=${code})`);
  });

  return child;
}

console.log('\n🎬 Remotion 视频工作流启动器\n');
console.log('正在启动服务...\n');

// 1. 启动 Editor Server
const editor = run('Editor', 'node', ['server.mjs']);
if (!editor) {
  console.error('\n❌ Editor 服务启动失败，请检查权限或单独运行 node server.mjs');
  process.exit(1);
}

// 2. 等 Editor 启动后再启动 Studio
setTimeout(() => {
  const studio = run('Studio', isWin ? 'npx.cmd' : 'npx', ['remotion', 'studio']);

  // 优雅关闭
  const shutdown = () => {
    console.log('\n\n👋 正在关闭服务...');
    editor?.kill();
    studio?.kill();
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}, 2000);

// 3. 打印访问地址
setTimeout(() => {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ 所有服务已启动');
  console.log('');
  console.log('  📋 编辑器/控制台    http://localhost:3456');
  console.log('  🎬 Remotion Studio  http://localhost:3000');
  console.log('');
  console.log('  提示: 按 Ctrl+C 同时关闭所有服务');
  console.log('═══════════════════════════════════════════════\n');
}, 4000);
