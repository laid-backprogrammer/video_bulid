import path from 'node:path';
import {readJsonFile} from '../json-utils.mjs';

export const STYLE_GUIDE_REL_PATH = 'src/composer/style-guide.json';

export async function readProjectStyleGuide(root = process.cwd()) {
  return readJsonFile(path.join(root, STYLE_GUIDE_REL_PATH)).catch(() => null);
}

export function styleGuideMarkdown(styleGuide) {
  if (!styleGuide) {
    return [
      'No project style guide was found.',
      'Use scene.designNotes, scene.tuningNotes, assets, and selected skills as the source of truth.',
    ].join('\n');
  }

  return [
    `Intent: ${styleGuide.intent || 'soft visual continuity'}`,
    `Strength: ${styleGuide.strength || 'soft'}`,
    `Theme: ${styleGuide.theme || '(not specified)'}`,
    `Palette: ${Array.isArray(styleGuide.palette) ? styleGuide.palette.join(', ') : '(not specified)'}`,
    `Typography: ${styleGuide.typography || '(not specified)'}`,
    `Subtitles: ${styleGuide.subtitles || '(not specified)'}`,
    `Motion: ${styleGuide.motion || '(not specified)'}`,
    Array.isArray(styleGuide.continuity) && styleGuide.continuity.length
      ? `Continuity cues: ${styleGuide.continuity.join('; ')}`
      : null,
    `Freedom: ${styleGuide.freedom || 'Scene-specific briefs may override this guide when needed.'}`,
    Array.isArray(styleGuide.avoid) && styleGuide.avoid.length
      ? `Avoid: ${styleGuide.avoid.join('; ')}`
      : null,
  ].filter(Boolean).join('\n');
}
