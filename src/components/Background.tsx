import React, {useMemo} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {randomSeed} from '../hooks/useAnimation';

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
}

export const Background: React.FC<{particleCount?: number; color?: string}> = ({
  particleCount = 60,
  color = '#0a1628',
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();

  const particles = useMemo<Particle[]>(() => {
    return Array.from({length: particleCount}, (_, i) => ({
      x: randomSeed(i * 3) * width,
      y: randomSeed(i * 3 + 1) * height,
      size: 1 + randomSeed(i * 3 + 2) * 2,
      speedX: (randomSeed(i * 7) - 0.5) * 0.3,
      speedY: (randomSeed(i * 7 + 1) - 0.5) * 0.3,
      opacity: 0.1 + randomSeed(i * 11) * 0.3,
    }));
  }, [particleCount, width, height]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse at center, ${color} 0%, #000000 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* Subtle grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(rgba(0,200,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,255,0.03) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
      {/* Particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: (p.x + frame * p.speedX) % width,
            top: (p.y + frame * p.speedY) % height,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: 'rgba(0, 200, 255, 0.5)',
            opacity: p.opacity,
            boxShadow: `0 0 ${p.size * 3}px rgba(0, 200, 255, 0.3)`,
          }}
        />
      ))}
    </div>
  );
};

export const GlowText: React.FC<{
  text: string;
  fontSize?: number;
  color?: string;
  glowColor?: string;
  style?: React.CSSProperties;
}> = ({text, fontSize = 80, color = '#00d4ff', glowColor = '#00d4ff', style}) => {
  const scale = 1 + 0.02 * Math.sin(useCurrentFrame() * 0.05);

  return (
    <div
      style={{
        fontSize,
        fontWeight: 800,
        color,
        textShadow: `0 0 20px ${glowColor}80, 0 0 40px ${glowColor}40, 0 0 80px ${glowColor}20`,
        transform: `scale(${scale})`,
        letterSpacing: '0.1em',
        textAlign: 'center',
        lineHeight: 1.2,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

export const Subtitle: React.FC<{
  text: string;
  delayInFrames?: number;
  style?: React.CSSProperties;
}> = ({text, delayInFrames = 0, style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = frame > delayInFrames ? Math.min(1, (frame - delayInFrames) / (0.5 * fps)) : 0;
  const translateY = frame > delayInFrames ? Math.max(0, 20 - (frame - delayInFrames) / (0.5 * fps) * 20) : 20;

  return (
    <div
      style={{
        fontSize: 32,
        fontWeight: 400,
        color: 'rgba(200, 220, 255, 0.8)',
        textAlign: 'center',
        marginTop: 24,
        opacity,
        transform: `translateY(${translateY}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
