export type SceneAssetRole = 'render' | 'reference' | 'both';
export type SceneAssetType = 'image' | 'video' | 'audio';

export type SceneAsset = {
  id: string;
  name: string;
  file: string;
  assetType?: SceneAssetType | string;
  alias?: string;
  role?: SceneAssetRole | string;
  notes?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
  url?: string;
};

export type ScriptScene = {
  id: string;
  text: string;
  enabled?: boolean;
  designNotes?: string;
  tuningNotes?: string;
  assets?: SceneAsset[];
};

export type WordCue = {
  text: string;
  startFrame: number;
  endFrame: number;
};

export type SegmentCue = {
  id: string;
  text: string;
  startFrame: number;
  endFrame: number;
  words: WordCue[];
  rawWords?: WordCue[];
};

export type SceneItem = ScriptScene & {
  audioExists: boolean;
  captionExists: boolean;
  includedInVideo?: boolean;
  durationMs: number | null;
  durationInFrames?: number | null;
  audioFile?: string;
  captionsFile?: string;
  cues?: SegmentCue[];
  audioUrl: string | null;
  captionsUrl: string | null;
  assets?: SceneAsset[];
};

export type Config = {
  fps: number;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  scenes: ScriptScene[];
  [key: string]: unknown;
};

export type PipelineStatus = {
  running: boolean;
  scenes: Array<{id: string; step: string; status: string; error: string | null}>;
};

export type RenderProgress = {
  rendered: number;
  total: number | null;
  encoded: number;
  percent: number;
  phase: string;
} | null;

export type RenderStatus = {
  running: boolean;
  exitCode: number | null;
  startTime: number | null;
  endTime: number | null;
  outputFile: string;
  mode: 'full' | 'scene';
  sceneId: string | null;
  progress: RenderProgress;
  logs: string[];
  error: string | null;
  videoUrl: string | null;
  videoExists: boolean;
  previewVideos?: Record<string, {outputFile: string; videoUrl: string; mtimeMs: number | null}>;
};

export type TtsStatus = {
  running: boolean;
  mode: 'scene' | 'all' | null;
  sceneId: string | null;
  currentSceneId: string | null;
  currentIndex: number;
  total: number;
  done: number;
  step: string;
  message: string;
  taskId: string | null;
  providerStatus: string | number | null;
  outputFile: string | null;
  startedAt: number | null;
  endTime: number | null;
  error: string | null;
  logs: string[];
};

export type CodegenStatus = {
  running: boolean;
  sceneId: string | null;
  provider: string | null;
  step: string;
  message: string;
  startTime: number | null;
  endTime: number | null;
  targetFile: string | null;
  error: string | null;
  result: {sceneId?: string; targetFile?: string; checked?: boolean; dryRun?: boolean} | null;
  logs: string[];
};

export type AgentActionType =
  | 'save_config'
  | 'run_tts_scene'
  | 'run_asr_scene'
  | 'generate_design_scene'
  | 'generate_code_scene'
  | 'render_preview_scene'
  | 'rebuild_manifest'
  | 'render_full_video';

export type AgentAction = {
  id: string;
  type: AgentActionType;
  label: string;
  description: string;
  sceneId?: string;
  tone?: 'primary' | 'neutral' | 'warn';
  disabledReason?: string;
  payload?: Record<string, unknown>;
};

export type AgentMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
};

export type AgentMode = 'review' | 'auto' | 'advice';

export type AgentAssetIntent =
  | 'visual_asset'
  | 'style_reference'
  | 'insert_video'
  | 'background_video'
  | 'bgm'
  | 'sound_effect'
  | 'voice_reference'
  | 'unknown';

export type AgentAttachmentDraft = {
  id: string;
  sceneId: string;
  file: File;
  fileName: string;
  alias: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'unknown';
  inferredIntent: AgentAssetIntent;
  notes: string;
};

export type AgentStageId =
  | 'understanding'
  | 'script'
  | 'assets'
  | 'tts'
  | 'asr'
  | 'design'
  | 'codegen'
  | 'render'
  | 'review';

export type AgentStageStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed';

export type AgentStageStep = {
  id: AgentStageId;
  label: string;
  status: AgentStageStatus;
  detail: string;
};

export type AgentStoryboardScene = {
  id?: string;
  text: string;
  designNotes?: string;
  durationHintSec?: number;
};

export type AgentStoryboardDraft = {
  title: string;
  summary: string;
  scenes: AgentStoryboardScene[];
};

export type SceneReadiness = {
  sceneId: string;
  score: number;
  total: number;
  label: string;
  nextAction: string;
  blockers: string[];
  readyForPreview: boolean;
  readyForRender: boolean;
};
