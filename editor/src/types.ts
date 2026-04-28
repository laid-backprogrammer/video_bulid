export type SceneAssetRole = 'render' | 'reference' | 'both';
export type SceneAssetType = 'image' | 'video' | 'audio';

export type ScriptScene = {
  id: string;
  text: string;
  enabled?: boolean;
  tuningNotes?: string;
  designNotes?: string;
  assets?: SceneAsset[];
};

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

export type SceneAssetDraft = {
  id: string;
  file: File;
  assetType: SceneAssetType;
  alias: string;
  role: SceneAssetRole;
  notes: string;
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

export type Config = {
  fps: number;
  ttsBaseUrl: string;
  ttsSign: string;
  ttsAudioId: string;
  ttsSpeed: number;
  ttsStyle?: string;
  ttsGenre?: number;
  ttsVoiceName?: string;
  ttsVoiceDescribe?: string;
  transcribeBaseUrl: string;
  transcribeModel: string;
  transcribeApiKey: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  codegenProvider?: 'openai' | string;
  scenes: ScriptScene[];
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

export type WorkflowStep = 'script' | 'audio' | 'design' | 'preview' | 'render';

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

export type LlmStreamFields = {
  streamLogs?: string[];
  thinking?: string;
  provider?: string;
  error?: string;
};

export type ModalType =
  | ({kind: 'design'; sceneId: string; prompt: string; loading: boolean; result?: string} & LlmStreamFields)
  | null;

export type BusyAction = string | null;
