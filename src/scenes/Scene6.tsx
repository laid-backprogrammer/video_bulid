import React from 'react';
import {AbsoluteFill, interpolate, Easing} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const CARDS = [
  {title: '固定流程、规则明确', icon: '📋', color: '#00d4ff', pipeline: '规则引擎 / 工作流', strategy: '高自动化'},
  {title: '半开放任务、需要判断', icon: '🔍', color: '#ffaa00', pipeline: 'Agent + 人工复核', strategy: '人机协作'},
  {title: '高风险决策、需要人类监督', icon: '⚠️', color: '#ff4444', pipeline: '辅助建议 + 人工作决策', strategy: '人类主导'},
];

export const Scene6: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at, isAfter} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const containerPhase = at(0, 0.3, [0, 1]);
  const overloadPhase = at(0.25, 0.45, [0, 1]);
  const splitPhase = at(0.5, 0.75, [0, 1]);
  const alertBlink = Math.sin(frame * 0.5) > 0 ? 1 : 0.3;

  return (
    <AbsoluteFill>
      <Background particleCount={30} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            width: 500,
            height: 320,
            borderRadius: 20,
            background: 'rgba(20, 5, 5, 0.9)',
            border: `2px solid rgba(255, ${80 - overloadPhase * 80}, ${80 - overloadPhase * 80}, ${0.3 + overloadPhase * 0.5 * alertBlink})`,
            boxShadow: `0 0 ${30 + overloadPhase * 40 * alertBlink}px rgba(255, ${50 * overloadPhase}, 0, ${0.2 * overloadPhase})`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${1 - splitPhase * 0.3})`,
            opacity: 1 - splitPhase * 0.7,
          }}
        >
          <div style={{fontSize: 36, fontWeight: 800, color: overloadPhase > 0.3 ? '#ff4444' : '#a0c0ff', marginBottom: 20, textShadow: overloadPhase > 0.3 ? '0 0 20px #ff444480' : 'none'}}>
            Agent 容器
          </div>
          {overloadPhase > 0.2 && (
            <div style={{fontSize: 18, color: '#ff6666', fontWeight: 700, opacity: alertBlink}}>
              ⚠ 过载警告 - 场景不匹配 ⚠
            </div>
          )}
          {overloadPhase > 0.5 && (
            <>
              <div style={{marginTop: 16, width: 200, height: 8, borderRadius: 4, background: 'rgba(255,0,0,0.2)', overflow: 'hidden'}}>
                <div style={{width: `${80 + 20 * alertBlink}%`, height: '100%', background: '#ff4444', boxShadow: '0 0 10px #ff4444'}} />
              </div>
              <div style={{marginTop: 8, fontSize: 14, color: '#ff8888'}}>错误率飙升 · 无法收敛</div>
            </>
          )}
        </div>
      </AbsoluteFill>

      {CARDS.map((card, i) => {
        const cardDelay = 0.05 + i * 0.06;
        const cardEnter = at(cardDelay, cardDelay + 0.12, [0, 1]);
        const startX = (i - 1) * 300;
        const startY = 400;
        const endX = (i - 1) * 120;
        const endY = 0;
        const currentX = startX + (endX - startX) * cardEnter * (1 - splitPhase);
        const currentY = startY + (endY - startY) * cardEnter * (1 - splitPhase);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `calc(50% + ${currentX}px)`,
              top: `calc(50% + ${currentY}px)`,
              transform: `translate(-50%, -50%) scale(${cardEnter}) rotate(${(1 - cardEnter) * (i - 1) * 15}deg)`,
              opacity: cardEnter * (1 - splitPhase * 0.5),
            }}
          >
            <div style={{width: 220, padding: '20px', borderRadius: 14, background: 'rgba(5, 15, 35, 0.95)', border: `2px solid ${card.color}60`, boxShadow: `0 0 20px ${card.color}20`, textAlign: 'center'}}>
              <div style={{fontSize: 40, marginBottom: 8}}>{card.icon}</div>
              <div style={{fontSize: 16, fontWeight: 700, color: card.color}}>{card.title}</div>
            </div>
          </div>
        );
      })}

      {CARDS.map((card, i) => {
        const pipelineDelay = 0.55 + i * 0.05;
        const pipelineProgress = at(pipelineDelay, pipelineDelay + 0.12, [0, 1]);
        const yPositions = [-200, 0, 200];
        const y = yPositions[i];

        return (
          <div
            key={`pipeline-${i}`}
            style={{
              position: 'absolute',
              left: `calc(50% + ${interpolate(pipelineProgress, [0, 1], [0, 350])}px)`,
              top: `calc(50% + ${y}px)`,
              transform: 'translate(-50%, -50%)',
              opacity: splitPhase * pipelineProgress,
            }}
          >
            <div style={{width: 280, padding: '20px 24px', borderRadius: 14, background: 'rgba(5, 15, 35, 0.95)', border: `2px solid ${card.color}80`, boxShadow: `0 0 30px ${card.color}20`}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12}}>
                <div style={{fontSize: 28}}>{card.icon}</div>
                <div style={{fontSize: 15, fontWeight: 700, color: card.color}}>{card.title}</div>
              </div>
              <div style={{padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', marginBottom: 8}}>
                <div style={{fontSize: 12, color: 'rgba(200,220,255,0.5)', marginBottom: 4}}>适用策略</div>
                <div style={{fontSize: 16, fontWeight: 600, color: '#e0f0ff'}}>{card.pipeline}</div>
              </div>
              <div style={{display: 'inline-block', padding: '4px 12px', borderRadius: 12, background: `${card.color}20`, color: card.color, fontSize: 13, fontWeight: 700}}>
                {card.strategy}
              </div>
            </div>
            <div style={{position: 'absolute', left: -60, top: '50%', width: 50, height: 2, background: `linear-gradient(90deg, transparent, ${card.color})`, transform: 'translateY(-50%)', opacity: pipelineProgress}} />
          </div>
        );
      })}

      <div
        style={{
          position: 'absolute',
          bottom: 50,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 24,
          color: 'rgba(200, 220, 255, 0.7)',
          opacity: at(0.7, 0.85, [0, 1]),
        }}
      >
        把不同场景混在一起，讨论就一定失真
      </div>
    </AbsoluteFill>
  );
};
