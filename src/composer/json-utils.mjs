import fs from 'node:fs/promises';

export function parseJsonText(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

export async function readJsonFile(filePath) {
  return parseJsonText(await fs.readFile(filePath, 'utf-8'));
}
