import React from 'react';
import {AbsoluteFill, spring} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const NODES = [
  {label: '任务目标', color: '#00d4ff'},
  {label: '风险等级', color: '#00aadd'},
  {label: '所需自主性', color: '#0088cc'},
  {label: '是否需要调用工具', color: '#0066aa'},
  {label: '是否允许自动执行', color: '#004488'},
];

export const Scene7: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);

  return (
    <AbsoluteFill>
      <Background particleCount={30} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div style={{width: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0}}>
          {NODES.map((node, i) => {
            const delay = 0.05 + i * 0.12;
            const nodeProgress = spring({
              frame: frame - delay * durationInFrames,
              fps,
              config: {damping: 200},
            });
            const isLast = i === NODES.length - 1;

            return (
              <React.Fragment key={i}>
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    opacity: nodeProgress,
                    transform: `scale(${0.8 + nodeProgress * 0.2})`,
                  }}
                >
                  <div
                    style={{
                      padding: '18px 40px',
                      borderRadius: 12,
                      background: 'rgba(5, 15, 35, 0.95)',
                      border: `2px solid ${node.color}60`,
                      boxShadow: `0 0 30px ${node.color}20, 0 0 60px ${node.color}10`,
                      textAlign: 'center',
                      minWidth: 320,
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: -2,
                        borderRadius: 12,
                        border: `2px solid ${node.color}`,
                        opacity: nodeProgress * 0.3 * (0.5 + 0.5 * Math.sin(frame * 0.15 + i)),
                        pointerEvents: 'none',
                      }}
                    />
                    <div style={{fontSize: 24, fontWeight: 700, color: node.color, letterSpacing: '0.05em'}}>
                      {node.label}
                    </div>
                  </div>
                </div>
                {!isLast && (
                  <div style={{height: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: nodeProgress}}>
                    <div style={{width: 2, height: 24, background: 'linear-gradient(180deg, #00aadd40, #0088cc80)'}} />
                    <div style={{width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid #0088cc80'}} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          right: 200,
          top: '50%',
          transform: 'translateY(-50%)',
          opacity: at(0.5, 0.7, [0, 1]),
        }}
      >
        <div style={{padding: '16px 28px', borderRadius: 12, background: 'rgba(0, 50, 80, 0.6)', border: '2px solid #00e5ff80', boxShadow: '0 0 40px rgba(0,200,255,0.2)', textAlign: 'center'}}>
          <div style={{fontSize: 16, color: '#00aadd', marginBottom: 8}}>其中一种解法</div>
          <div style={{fontSize: 32, fontWeight: 800, color: '#00e5ff', textShadow: '0 0 20px #00e5ff60'}}>Agent</div>
        </div>
        <div style={{position: 'absolute', left: -80, top: '50%', width: 80, height: 2, background: 'linear-gradient(90deg, #0088cc60, #00e5ff)', transform: 'translateY(-50%)'}} />
        <div style={{position: 'absolute', left: -88, top: '50%', width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '8px solid #00e5ff', transform: 'translateY(-50%)'}} />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 32,
          fontWeight: 700,
          color: '#e0f0ff',
          opacity: at(0.6, 0.8, [0, 1]),
          textShadow: '0 0 20px rgba(0,200,255,0.2)',
        }}
      >
        <span style={{color: '#00e5ff'}}>先问场景</span>，再谈 Agent
      </div>
    </AbsoluteFill>
  );
};
