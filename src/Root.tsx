import React from 'react';
import {
  Composition,
  AbsoluteFill,
  Sequence,
  staticFile,
  Audio,
  CalculateMetadataFunction,
} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';

import {
  Scene1Generated,
  Scene2Generated,
  Scene3Generated,
  Scene4Generated,
  Scene5Generated,
  Scene6Generated,
  Scene7Generated,
  Scene8Generated,
} from './scenes/generated';
import {CaptionOverlay} from './components/Captions';
import type {AgentDiscussionProps, SceneAsset, SceneData} from './types';

const FPS = 30;
const TRANSITION_DURATION = 15;
const SCENE_TAIL_PADDING = FPS;
const MIN_SCENE_DURATION = TRANSITION_DURATION + 1;

type SceneComponentProps = {
  cues: SceneData['cues'];
  durationInFrames: number;
  assets?: SceneAsset[];
};

const SCENE_COMPONENTS: Record<string, React.ComponentType<SceneComponentProps>> = {
  scene1: Scene1Generated,
  scene2: Scene2Generated,
  scene3: Scene3Generated,
  scene4: Scene4Generated,
  scene5: Scene5Generated,
  scene6: Scene6Generated,
  scene7: Scene7Generated,
  scene8: Scene8Generated,
};

const TRANSITIONS = [
  fade(),
  wipe({direction: 'from-top'}),
  fade(),
  slide({direction: 'from-right'}),
  fade(),
  wipe({direction: 'from-bottom'}),
  fade(),
];

const fallbackScenes: SceneData[] = [
  {id: 'scene1', text: '', audioFile: '', captionsFile: '', durationInFrames: 4 * FPS, cues: [], assets: []},
  {id: 'scene2', text: '', audioFile: '', captionsFile: '', durationInFrames: 5 * FPS, cues: [], assets: []},
  {id: 'scene3', text: '', audioFile: '', captionsFile: '', durationInFrames: 5 * FPS, cues: [], assets: []},
  {id: 'scene4', text: '', audioFile: '', captionsFile: '', durationInFrames: 4 * FPS, cues: [], assets: []},
  {id: 'scene5', text: '', audioFile: '', captionsFile: '', durationInFrames: 6 * FPS, cues: [], assets: []},
  {id: 'scene6', text: '', audioFile: '', captionsFile: '', durationInFrames: 5 * FPS, cues: [], assets: []},
  {id: 'scene7', text: '', audioFile: '', captionsFile: '', durationInFrames: 5 * FPS, cues: [], assets: []},
  {id: 'scene8', text: '', audioFile: '', captionsFile: '', durationInFrames: 6 * FPS, cues: [], assets: []},
];

const normalizeScenes = (scenes: SceneData[] | undefined): SceneData[] => {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return fallbackScenes;
  }

  return scenes.map((scene) => ({
    ...scene,
    audioFile: scene.audioFile ?? '',
    captionsFile: scene.captionsFile ?? '',
    cues: scene.cues ?? [],
    assets: scene.assets ?? [],
    durationInFrames: Math.max(
      MIN_SCENE_DURATION,
      Math.ceil(Number(scene.durationInFrames) || 0),
    ),
  }));
};

const getTotalDuration = (scenes: SceneData[]) => {
  const sceneFrames = scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
  return Math.max(1, sceneFrames + Math.max(0, scenes.length - 1) * TRANSITION_DURATION);
};

const publicAssetPath = (file: string) => file.replace(/^public[\\/]/, '').replace(/\\/g, '/');

const renderScene = (scene: SceneData) => {
  const Component = SCENE_COMPONENTS[scene.id];
  if (!Component) return null;

  return (
    <>
      <Component cues={scene.cues} durationInFrames={scene.durationInFrames} assets={scene.assets ?? []} />
      {scene.audioFile ? <Audio src={staticFile(publicAssetPath(scene.audioFile))} /> : null}
      <CaptionOverlay cues={scene.cues} />
    </>
  );
};

export const AgentDiscussion: React.FC<AgentDiscussionProps> = ({scenes, fps}) => {
  return (
    <AbsoluteFill>
      {scenes.map((scene, index) => {
        if (!SCENE_COMPONENTS[scene.id]) return null;

        const startFrame = scenes.slice(0, index).reduce((sum, s) => sum + s.durationInFrames, 0) + index * TRANSITION_DURATION;

        return (
          <Sequence
            key={scene.id}
            from={startFrame}
            durationInFrames={scene.durationInFrames}
            layout="none"
          >
            {renderScene(scene)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const PreviewScene: React.FC<{sceneId: string; scenes: SceneData[]; fps: number}> = ({sceneId, scenes}) => {
  const scene = scenes.find((item) => item.id === sceneId) ?? scenes[0];
  return <AbsoluteFill>{scene ? renderScene(scene) : null}</AbsoluteFill>;
};

export const calculateMetadata: CalculateMetadataFunction<AgentDiscussionProps> = async () => {
  try {
    const response = await fetch(staticFile('scenes-manifest.json'));
    const manifest = await response.json();
    const scenes = normalizeScenes(manifest.scenes);

    return {
      durationInFrames: getTotalDuration(scenes),
      props: {
        scenes,
        fps: manifest.fps ?? FPS,
      } as AgentDiscussionProps,
    };
  } catch {
    return {
      durationInFrames: getTotalDuration(fallbackScenes),
      props: {scenes: fallbackScenes, fps: FPS},
    };
  }
};

export const calculatePreviewMetadata: CalculateMetadataFunction<{sceneId: string; scenes: SceneData[]; fps: number}> = async ({props}) => {
  try {
    const response = await fetch(staticFile('scenes-manifest.json'));
    const manifest = await response.json();
    const scenes = normalizeScenes(manifest.scenes);
    const scene = scenes.find((item) => item.id === props.sceneId) ?? scenes[0] ?? fallbackScenes[0];

    return {
      durationInFrames: Math.max(MIN_SCENE_DURATION, scene.durationInFrames),
      props: {sceneId: scene.id, scenes: [scene], fps: manifest.fps ?? FPS},
    };
  } catch {
    const scene = fallbackScenes.find((item) => item.id === props.sceneId) ?? fallbackScenes[0];
    return {
      durationInFrames: scene.durationInFrames + SCENE_TAIL_PADDING,
      props: {sceneId: scene.id, scenes: [scene], fps: FPS},
    };
  }
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AgentDiscussion"
        component={AgentDiscussion}
        durationInFrames={1200}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{scenes: [], fps: FPS}}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="PreviewScene"
        component={PreviewScene}
        durationInFrames={5 * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{sceneId: 'scene1', scenes: [], fps: FPS}}
        calculateMetadata={calculatePreviewMetadata}
      />
    </>
  );
};
