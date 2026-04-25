import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SegmentCue} from '../types';

export const CaptionOverlay: React.FC<{
  cues?: SegmentCue[];
  style?: React.CSSProperties;
}> = ({cues = [], style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  const activeCue = cues.find((cue) => frame >= cue.startFrame && frame <= cue.endFrame);
  if (!activeCue) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 80,
        pointerEvents: 'none',
        ...style,
      }}
    >
      <div
        style={{
          padding: '16px 32px',
          borderRadius: 12,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          maxWidth: '80%',
          textAlign: 'center',
        }}
      >
        <div style={{fontSize: 36, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'pre-wrap'}}>
          {activeCue.words.length > 0 ? (
            activeCue.words.map((word, i) => {
              const wordStartMs = (word.startFrame / fps) * 1000;
              const wordEndMs = (word.endFrame / fps) * 1000;
              const isActive = currentTimeMs >= wordStartMs && currentTimeMs < wordEndMs;
              const isPast = currentTimeMs >= wordEndMs;
              return (
                <span
                  key={i}
                  style={{
                    color: isActive ? '#00e5ff' : isPast ? 'rgba(200, 220, 255, 0.7)' : 'rgba(200, 220, 255, 0.4)',
                    textShadow: isActive ? '0 0 12px rgba(0, 200, 255, 0.5)' : 'none',
                    transition: 'none',
                  }}
                >
                  {word.text}
                </span>
              );
            })
          ) : (
            <span style={{color: 'rgba(200, 220, 255, 0.85)'}}>{activeCue.text}</span>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
