import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, Easing} from 'remotion';
import {Background, GlowText} from '../components/Background';
import {randomSeed} from '../hooks/useAnimation';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const KEYWORDS = [
  'AI', 'automation', 'workflow', 'copilot', 'agent',
  'LLM', 'GPT', '智能体', '自动化', 'RAG',
  'prompt', 'chain', 'orchestration', 'function calling',
  'multi-agent', '工具调用', '推理', '决策',
];

interface Card {
  x: number;
  y: number;
  z: number;
  keyword: string;
  speed: number;
  size: number;
}

export const Scene1: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const cards = useMemo<Card[]>(() => {
    return Array.from({length: 40}, (_, i) => ({
      x: (randomSeed(i * 2) - 0.5) * width * 1.5,
      y: (randomSeed(i * 2 + 1) - 0.5) * height * 1.5,
      z: randomSeed(i * 3) * 2000 - 1000,
      keyword: KEYWORDS[i % KEYWORDS.length],
      speed: 80 + randomSeed(i * 5) * 120,
      size: 14 + randomSeed(i * 7) * 18,
    }));
  }, [width, height]);

  const cameraZ = at(0, 0.5, [-800, 300]);
  const centerOpacity = at(0.1, 0.3, [0, 1]);
  const centerScale = interpolate(frame, [0.1 * durationInFrames, 0.4 * durationInFrames], [0.5, 1.1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.exp),
  });

  return (
    <AbsoluteFill>
      <Background particleCount={80} />
      {cards.map((card, i) => {
        const z = card.z + frame * card.speed * 0.1 + cameraZ;
        if (z <= 0) return null;
        const scale = 800 / z;
        const screenX = width / 2 + card.x * scale;
        const screenY = height / 2 + card.y * scale;
        const opacity = Math.min(1, Math.max(0, (1000 - z) / 400));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: `translate(-50%, -50%) scale(${scale})`,
              opacity,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: 'rgba(0, 30, 60, 0.7)',
                border: '1px solid rgba(0, 200, 255, 0.3)',
                color: '#a0d8ff',
                fontSize: card.size,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                backdropFilter: 'blur(4px)',
                boxShadow: '0 0 20px rgba(0, 150, 255, 0.15)',
              }}
            >
              {card.keyword}
            </div>
          </div>
        );
      })}

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: centerOpacity,
          transform: `scale(${centerScale})`,
        }}
      >
        <GlowText text="Agent" fontSize={120} color="#00e5ff" glowColor="#00e5ff" />
        {Array.from({length: 8}).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2 + frame * 0.01;
          const radius = 180 + Math.sin(frame * 0.03 + i) * 20;
          const nx = Math.cos(angle) * radius;
          const ny = Math.sin(angle) * radius;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#00e5ff',
                transform: `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`,
                boxShadow: '0 0 10px #00e5ff, 0 0 20px #00e5ff80',
              }}
            />
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
