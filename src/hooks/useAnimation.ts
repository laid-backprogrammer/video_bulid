import {useMemo} from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring, Easing} from 'remotion';

export const useFadeIn = (delayInFrames = 0, durationInFrames?: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = durationInFrames ?? 0.8 * fps;
  return interpolate(frame, [delayInFrames, delayInFrames + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
};

export const useScaleIn = (delayInFrames = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({
    frame: frame - delayInFrames,
    fps,
    config: {damping: 200},
  });
};

export const useSlideIn = (delayInFrames = 0, from: 'left' | 'right' | 'top' | 'bottom' = 'bottom', distance = 100) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({
    frame: frame - delayInFrames,
    fps,
    config: {damping: 200},
  });
  
  const ranges: Record<string, [number, number]> = {
    left: [-distance, 0],
    right: [distance, 0],
    top: [-distance, 0],
    bottom: [distance, 0],
  };
  
  const value = interpolate(progress, [0, 1], ranges[from], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  
  const isHorizontal = from === 'left' || from === 'right';
  return {
    transform: isHorizontal ? `translateX(${value}px)` : `translateY(${value}px)`,
  };
};

export const usePulse = (speed = 1) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return 1 + 0.05 * Math.sin((frame / fps) * Math.PI * speed);
};

export const useTypewriter = (text: string, charsPerSecond = 12, delayInFrames = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const charCount = Math.max(0, Math.floor((frame - delayInFrames) / fps * charsPerSecond));
  return text.slice(0, Math.min(charCount, text.length));
};

export const useInterpolate = (
  inputRange: [number, number],
  outputRange: [number, number],
  options?: {easing?: (t: number) => number; extrapolateLeft?: 'clamp' | 'extend'; extrapolateRight?: 'clamp' | 'extend'}
) => {
  const frame = useCurrentFrame();
  return interpolate(frame, inputRange, outputRange, {
    extrapolateLeft: options?.extrapolateLeft ?? 'clamp',
    extrapolateRight: options?.extrapolateRight ?? 'clamp',
    easing: options?.easing,
  });
};

export const randomSeed = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
