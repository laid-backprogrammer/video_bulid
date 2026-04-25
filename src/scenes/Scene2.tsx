import React from 'react';
import {AbsoluteFill, interpolate, spring, Easing} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const HYPE_LABELS = ['革命性', '颠覆一切', '全自动替代', '未来核心', '无所不能'];
const CRITIC_LABELS = ['过度炒作', '不实用', '成本过高', '风险太大', '替代不了人类'];

export const Scene2: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at, isAfter} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const splitProgress = spring({
    frame,
    fps,
    config: {damping: 200},
  });

  const dividerShake = at(0.2, 0.4, [0, 1]);
  const dividerOffset = dividerShake > 0 ? Math.sin(frame * 0.8) * 3 : 0;
  const leftGlow = 0.3 + 0.15 * Math.sin(frame * 0.1);
  const rightGlow = 0.3 + 0.15 * Math.sin(frame * 0.12 + 2);

  return (
    <AbsoluteFill>
      <Background particleCount={40} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: width / 2,
          height,
          background: `linear-gradient(135deg, rgba(0,50,100,${leftGlow}) 0%, rgba(0,20,40,0.5) 100%)`,
          clipPath: `inset(0 ${(1 - splitProgress) * 50}% 0 0)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: '#00d4ff',
            textShadow: '0 0 30px #00d4ff80',
            marginBottom: 40,
            transform: `translateY(${at(0, 0.2, [100, 0])}px)`,
            opacity: at(0, 0.15, [0, 1]),
          }}
        >
          吹捧派
        </div>
        <div
          style={{
            width: 120,
            height: 180,
            background: 'linear-gradient(180deg, rgba(0,200,255,0.3) 0%, rgba(0,100,200,0.1) 100%)',
            borderRadius: '60px 60px 8px 8px',
            border: '2px solid rgba(0,200,255,0.5)',
            boxShadow: '0 0 60px rgba(0,200,255,0.3), inset 0 0 40px rgba(0,200,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 40,
          }}
        >
          <span style={{fontSize: 14, color: '#00d4ff', fontWeight: 700}}>Agent</span>
        </div>
        {HYPE_LABELS.map((label, i) => {
          const start = 0.1 + i * 0.06;
          const end = start + 0.15;
          const y = interpolate(frame, [start * durationInFrames, end * durationInFrames], [60, -40 - i * 55], {
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.quad),
          });
          const opacity = at(start, start + 0.05, [0, 1]);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                fontSize: 24,
                fontWeight: 700,
                color: '#00e5ff',
                padding: '6px 16px',
                borderRadius: 20,
                background: 'rgba(0,80,150,0.4)',
                border: '1px solid rgba(0,200,255,0.4)',
                transform: `translateY(${y}px)`,
                opacity,
                textShadow: '0 0 10px #00e5ff60',
              }}
            >
              {label}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: width / 2,
          height,
          background: `linear-gradient(225deg, rgba(150,30,30,${rightGlow}) 0%, rgba(40,10,10,0.5) 100%)`,
          clipPath: `inset(0 0 0 ${(1 - splitProgress) * 50}%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: '#ff4d4d',
            textShadow: '0 0 30px #ff4d4d80',
            marginBottom: 40,
            transform: `translateY(${at(0, 0.2, [100, 0])}px)`,
            opacity: at(0, 0.15, [0, 1]),
          }}
        >
          批判派
        </div>
        {CRITIC_LABELS.map((label, i) => {
          const start = 0.15 + i * 0.05;
          const end = start + 0.15;
          const y = interpolate(frame, [start * durationInFrames, end * durationInFrames], [-80, 30 + i * 55], {
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.quad),
          });
          const opacity = at(start, start + 0.05, [0, 1]);
          const xOffset = Math.sin(i * 3) * 30;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `calc(50% + ${xOffset}px)`,
                top: '40%',
                fontSize: 22,
                fontWeight: 700,
                color: '#ff8888',
                padding: '8px 18px',
                borderRadius: 8,
                background: 'rgba(150,30,30,0.4)',
                border: '1px solid rgba(255,80,80,0.4)',
                transform: `translate(-50%, ${y}px) rotate(${Math.sin(i) * 5}deg)`,
                opacity,
              }}
            >
              <span style={{color: '#ff3333', marginRight: 8}}>✕</span>
              {label}
            </div>
          );
        })}
        {Array.from({length: 3}).map((_, i) => {
          const start = 0.25 + i * 0.08;
          return (
            <div
              key={`warn-${i}`}
              style={{
                position: 'absolute',
                left: 30 + i * 80,
                top: 100 + (i % 2) * 80,
                fontSize: 36,
                color: '#ffaa00',
                opacity: at(start, start + 0.05, [0, 0.7]),
                textShadow: '0 0 15px #ffaa0060',
              }}
            >
              ⚠
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: `calc(50% - 2px + ${dividerOffset}px)`,
          top: 0,
          width: 4,
          height,
          background: 'linear-gradient(180deg, transparent, #ffffff40, transparent)',
          transform: `scaleY(${splitProgress})`,
        }}
      />
    </AbsoluteFill>
  );
};
