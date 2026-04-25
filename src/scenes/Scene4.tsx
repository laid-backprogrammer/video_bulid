import React from 'react';
import {AbsoluteFill, interpolate, Easing} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

export const Scene4: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const blurAmount = at(0, 0.3, [0, 8]);
  const dimOpacity = at(0, 0.3, [1, 0.15]);
  const panelScale = interpolate(frame, [0.15 * durationInFrames, 0.4 * durationInFrames], [0.3, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.exp),
  });
  const panelOpacity = at(0.2, 0.4, [0, 1]);
  const particleCount = 60;

  return (
    <AbsoluteFill>
      <Background particleCount={30} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          filter: `blur(${blurAmount}px)`,
          opacity: dimOpacity,
          pointerEvents: 'none',
        }}
      >
        <div style={{position: 'absolute', left: 100, top: 120, width: 300, height: 200, background: 'rgba(0,80,150,0.3)', borderRadius: 12}} />
        <div style={{position: 'absolute', right: 100, top: 120, width: 300, height: 200, background: 'rgba(0,150,100,0.3)', borderRadius: 12}} />
        <div style={{position: 'absolute', left: 100, bottom: 120, width: 300, height: 200, background: 'rgba(150,100,0,0.3)', borderRadius: 12}} />
        <div style={{position: 'absolute', right: 100, bottom: 120, width: 300, height: 200, background: 'rgba(150,0,80,0.3)', borderRadius: 12}} />
      </div>

      {Array.from({length: particleCount}).map((_, i) => {
        const angle = (i / particleCount) * Math.PI * 2;
        const startRadius = 600;
        const endRadius = 0;
        const progress = interpolate(frame, [0.05 * durationInFrames, 0.4 * durationInFrames], [0, 1], {
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.exp),
        });
        const radius = startRadius * (1 - progress) + endRadius * progress;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const px = width / 2 + x;
        const py = height / 2 + y;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: '#00e5ff',
              opacity: 0.3 + progress * 0.4,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}

      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            width: 720,
            padding: '48px 64px',
            background: 'rgba(5, 15, 35, 0.9)',
            borderRadius: 20,
            border: '1px solid rgba(0, 200, 255, 0.3)',
            boxShadow: '0 0 60px rgba(0, 150, 255, 0.15), inset 0 0 40px rgba(0, 100, 200, 0.05)',
            opacity: panelOpacity,
            transform: `scale(${panelScale})`,
            backdropFilter: 'blur(20px)',
          }}
        >
          <div style={{fontSize: 18, color: '#00aadd', marginBottom: 20, fontWeight: 600, letterSpacing: '0.15em'}}>
            核心问题
          </div>
          <div style={{fontSize: 42, fontWeight: 700, color: '#e0f0ff', lineHeight: 1.5, textShadow: '0 0 20px rgba(0, 200, 255, 0.2)'}}>
            越来越觉得一个
            <br />
            <span style={{color: '#00e5ff'}}>更实际的问题</span>
            是：
          </div>
          <div
            style={{
              marginTop: 32,
              height: 2,
              background: 'linear-gradient(90deg, transparent, #00e5ff, transparent)',
              opacity: at(0.35, 0.55, [0, 1]),
              transform: `scaleX(${at(0.35, 0.55, [0, 1])})`,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
