import {useCurrentFrame, useVideoConfig, interpolate} from 'remotion';

export const useSceneProgress = (durationInFrames: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;

  const at = (startRatio: number, endRatio: number, value: number | [number, number] = [0, 1]) => {
    const start = startRatio * durationInFrames;
    const end = endRatio * durationInFrames;
    const [from, to] = Array.isArray(value) ? value : [0, value];
    return interpolate(frame, [start, end], [from, to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  };

  const isAfter = (ratio: number) => frame >= ratio * durationInFrames;
  const isBefore = (ratio: number) => frame < ratio * durationInFrames;
  const isBetween = (startRatio: number, endRatio: number) => frame >= startRatio * durationInFrames && frame < endRatio * durationInFrames;

  return {frame, fps, progress, durationInFrames, at, isAfter, isBefore, isBetween};
};
