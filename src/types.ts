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

export type SceneAsset = {
  id: string;
  name: string;
  file: string;
  assetType?: 'image' | 'video' | 'audio' | string;
  alias?: string;
  role?: 'render' | 'reference' | 'both' | string;
  notes?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
};

export type SceneData = {
  id: string;
  text: string;
  enabled?: boolean;
  audioFile: string;
  captionsFile: string;
  durationInFrames: number;
  cues: SegmentCue[];
  assets?: SceneAsset[];
};

export type AgentDiscussionProps = {
  scenes: SceneData[];
  fps: number;
};
