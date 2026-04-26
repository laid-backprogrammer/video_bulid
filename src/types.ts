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

export type SceneData = {
  id: string;
  text: string;
  audioFile: string;
  captionsFile: string;
  durationInFrames: number;
  cues: SegmentCue[];
};

export type AgentDiscussionProps = {
  scenes: SceneData[];
  fps: number;
};
