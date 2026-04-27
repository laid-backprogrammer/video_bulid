import type {SceneItem, WorkflowStep} from '../types';

export const STUDIO_URL = 'http://localhost:3000';

export const STEP_ORDER: WorkflowStep[] = ['script', 'audio', 'design', 'preview', 'render'];

export const STEP_META: Record<WorkflowStep, {label: string; desc: string}> = {
  script: {label: '1. 文案', desc: '编辑每段文案'},
  audio: {label: '2. 语音', desc: 'TTS 生成与时间轴对齐'},
  design: {label: '3. 设计', desc: 'LLM 分析画面方案'},
  preview: {label: '4. 预览', desc: '单段渲染与微调'},
  render: {label: '5. 导出', desc: '渲染完整视频'},
};

export const renderPhaseLabel: Record<string, string> = {
  starting: '准备中',
  bundling: '打包中',
  metadata: '读取合成信息',
  rendering: '渲染帧',
  encoding: '编码视频',
  done: '完成',
  failed: '失败',
};

export const formatDuration = (ms?: number | null) => {
  if (!ms) return '未生成';
  return `${(ms / 1000).toFixed(1)}s`;
};

export const getSceneProgress = (scene: SceneItem) => {
  let completed = 0;
  if (scene.text.trim()) completed++;
  if (scene.audioExists) completed++;
  if (scene.captionExists) completed++;
  if (scene.designNotes?.trim()) completed++;
  if (scene.tuningNotes?.trim()) completed++;
  return completed;
};

export const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
