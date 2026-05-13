import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, staticFile, Img} from 'remotion';
import type {SceneAsset, SegmentCue, WordCue} from '../../types';

export const Scene1Generated: React.FC<{
  cues: SegmentCue[];
  durationInFrames: number;
  assets?: SceneAsset[];
}> = ({cues, durationInFrames, assets = []}) => {
  const frame = useCurrentFrame();

  const claudeAsset = assets.find(
    (a) =>
      (a.id === 'asset_1777536859841_zcvofe' || a.alias === '截屏2026-04-28-17-07-23') &&
      a.assetType === 'image'
  );
  const codexAsset = assets.find(
    (a) =>
      (a.id === 'asset_1777536859921_2bou2m' || a.alias === '截屏2026-04-28-17-07-54') &&
      a.assetType === 'image'
  );

  const claudeSrc = claudeAsset
    ? staticFile(claudeAsset.file.replace(/^public[\\/]/, '').replace(/\\/g, '/'))
    : null;
  const codexSrc = codexAsset
    ? staticFile(codexAsset.file.replace(/^public[\\/]/, '').replace(/\\/g, '/'))
    : null;

  const activeCue = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  const words: WordCue[] = activeCue?.words ?? [];

  const entranceOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const exitStart = Math.max(0, durationInFrames - 16);
  const exitOpacity = interpolate(frame, [exitStart, durationInFrames], [1, 0.7], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const contentOpacity = entranceOpacity * exitOpacity;

  const sinkY = interpolate(frame, [exitStart, durationInFrames], [0, 16], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const claudeX = interpolate(frame, [0, 20], [-140, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const codexX = interpolate(frame, [5, 25], [140, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const labelOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const connectorOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const floatYLeft = Math.sin(frame * 0.08) * 4;
  const floatYRight = Math.sin(frame * 0.08 + 1.2) * 4;

  const leftScale = interpolate(frame, [53, 61.5, 70], [1, 1.06, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rightScale = interpolate(frame, [88, 97, 106], [1, 1.06, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const connectorGlow = interpolate(frame, [70, 79, 88], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cardBaseStyle: React.CSSProperties = {
    width: 160,
    padding: '28px 16px',
    borderRadius: 16,
    background: 'rgba(255,255,255,0.05)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  };

  const captionPillStyle: React.CSSProperties = {
    padding: '16px 32px',
    borderRadius: 12,
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  };

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, #070B18 0%, #101B3F 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '35%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700,
          height: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(125,183,255,0.07) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: `translate(-50%, calc(-50% + ${sinkY}px))`,
          width: '90%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 36,
          opacity: contentOpacity,
        }}
      >
        <div
          style={{
            ...cardBaseStyle,
            border: '1px solid rgba(125,183,255,0.35)',
            boxShadow: '0 0 28px rgba(125,183,255,0.12)',
            transform: `translateX(${claudeX}px) translateY(${floatYLeft}px) scale(${leftScale})`,
          }}
        >
          {claudeSrc ? (
            <Img
              src={claudeSrc}
              style={{width: 80, height: 80, objectFit: 'contain'}}
            />
          ) : (
            <div
              style={{
                width: 80,
                height: 80,
                background: 'rgba(125,183,255,0.15)',
                borderRadius: 12,
              }}
            />
          )}
          <div
            style={{
              marginTop: 16,
              color: '#7DB7FF',
              fontWeight: 600,
              fontSize: 18,
              opacity: labelOpacity,
            }}
          >
            Claude
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: connectorOpacity,
          }}
        >
          <div
            style={{
              width: 40,
              height: 1,
              background: 'linear-gradient(90deg, rgba(125,183,255,0.6), rgba(167,139,250,0.6))',
            }}
          />
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#F8FAFC',
              marginTop: -3,
              opacity: 0.6 + connectorGlow * 0.4,
              boxShadow:
                connectorGlow > 0.01
                  ? `0 0 ${10 + connectorGlow * 12}px rgba(248,250,252,${0.3 + connectorGlow * 0.5})`
                  : 'none',
            }}
          />
        </div>

        <div
          style={{
            ...cardBaseStyle,
            border: '1px solid rgba(167,139,250,0.35)',
            boxShadow: '0 0 28px rgba(167,139,250,0.12)',
            transform: `translateX(${codexX}px) translateY(${floatYRight}px) scale(${rightScale})`,
          }}
        >
          {codexSrc ? (
            <Img
              src={codexSrc}
              style={{width: 80, height: 80, objectFit: 'contain'}}
            />
          ) : (
            <div
              style={{
                width: 80,
                height: 80,
                background: 'rgba(167,139,250,0.15)',
                borderRadius: 12,
              }}
            />
          )}
          <div
            style={{
              marginTop: 16,
              color: '#A78BFA',
              fontWeight: 600,
              fontSize: 18,
              opacity: labelOpacity,
            }}
          >
            Codex
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: 90,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity: contentOpacity,
        }}
      >
        <div style={captionPillStyle}>
          {words.map((word, i) => {
            const isActive = frame >= word.startFrame && frame < word.endFrame;
            return (
              <span
                key={`${word.text}-${i}`}
                style={{
                  color: isActive ? '#F8FAFC' : '#94A3B8',
                  fontWeight: isActive ? 700 : 400,
                  fontSize: 22,
                  lineHeight: 1.4,
                }}
              >
                {word.text}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
