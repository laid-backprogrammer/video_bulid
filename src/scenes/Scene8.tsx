import React from 'react';
import {AbsoluteFill, interpolate, spring} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const ZONES = [
  {name: '规则型任务', color: '#00d4ff', x: -300, y: -150, size: 180},
  {name: '半开放任务', color: '#ffaa00', x: 300, y: -150, size: 200},
  {name: '知识型问答', color: '#aa66ff', x: -350, y: 150, size: 170},
  {name: '协同审批', color: '#00ff88', x: 350, y: 150, size: 190},
  {name: '数据分析', color: '#ff66aa', x: 0, y: 0, size: 160},
  {name: '高风险决策', color: '#ff4444', x: 0, y: 280, size: 220},
];

const CONNECTIONS = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 5], [0, 2], [1, 3],
];

export const Scene8: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const zoomOut = at(0, 0.4, [1.3, 1]);
  const finalTextOpacity = at(0.5, 0.7, [0, 1]);
  const glowPulse = 0.5 + 0.3 * Math.sin(frame * 0.08);

  return (
    <AbsoluteFill>
      <Background particleCount={50} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', transform: `scale(${zoomOut})`}}>
        <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
          {CONNECTIONS.map(([from, to], idx) => {
            const f = ZONES[from];
            const t = ZONES[to];
            const x1 = width / 2 + f.x;
            const y1 = height / 2 + f.y;
            const x2 = width / 2 + t.x;
            const y2 = height / 2 + t.y;
            const delay = 0.1 + idx * 0.04;
            const opacity = at(delay, delay + 0.1, [0, 0.25]);
            return (
              <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,200,255,0.5)" strokeWidth={1.5} opacity={opacity} />
            );
          })}
        </svg>

        {ZONES.map((zone, i) => {
          const delay = 0.05 + i * 0.05;
          const entrance = spring({
            frame: frame - delay * durationInFrames,
            fps,
            config: {damping: 200},
          });

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: width / 2 + zone.x,
                top: height / 2 + zone.y,
                transform: `translate(-50%, -50%) scale(${entrance})`,
                opacity: entrance,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: zone.size + 40,
                  height: zone.size + 40,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${zone.color}15 0%, transparent 70%)`,
                  transform: 'translate(-50%, -50%)',
                  opacity: glowPulse,
                }}
              />
              <div
                style={{
                  width: zone.size,
                  height: zone.size * 0.6,
                  borderRadius: 16,
                  background: 'rgba(5, 15, 35, 0.9)',
                  border: `1.5px solid ${zone.color}50`,
                  boxShadow: `0 0 30px ${zone.color}15, 0 4px 20px rgba(0,0,0,0.3)`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <div style={{width: 10, height: 10, borderRadius: '50%', background: zone.color, marginBottom: 10, boxShadow: `0 0 12px ${zone.color}`}} />
                <div style={{fontSize: 18, fontWeight: 700, color: zone.color, textAlign: 'center', padding: '0 12px'}}>{zone.name}</div>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>

      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)', pointerEvents: 'none'}} />

      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
        <div style={{textAlign: 'center', opacity: finalTextOpacity, transform: `scale(${0.95 + finalTextOpacity * 0.05})`}}>
          <div style={{fontSize: 40, fontWeight: 800, color: '#e0f0ff', lineHeight: 1.6, textShadow: '0 0 30px rgba(0,200,255,0.3)', marginBottom: 16}}>
            问题从来不只是 Agent 行不行
          </div>
          <div style={{fontSize: 48, fontWeight: 800, color: '#00e5ff', textShadow: '0 0 40px rgba(0,200,255,0.4)'}}>
            而是你到底在解决什么场景
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
