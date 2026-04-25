import React from 'react';
import {AbsoluteFill, interpolate, Easing} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const PANELS = [
  {title: '工作流面板', items: ['审批流程', '任务分发', '状态跟踪', '异常处理'], color: '#00d4ff'},
  {title: '数据报表', items: ['日活跃用户', '转化率 3.2%', '留存率 68%', '收入趋势'], color: '#00ff88'},
  {title: '用户反馈', items: ['5星好评 × 128', '功能建议 × 45', 'Bug 反馈 × 12', '待回复 × 3'], color: '#ffaa00'},
  {title: '接口状态', items: ['API 正常', '延迟 45ms', '成功率 99.9%', 'QPS 2.3K'], color: '#ff66aa'},
];

export const Scene3: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const glitchAmount = interpolate(frame, [0, 0.1 * durationInFrames], [20, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.exp),
  });

  const overallOpacity = at(0, 0.1, [0, 1]);

  return (
    <AbsoluteFill
      style={{
        opacity: overallOpacity,
        transform: `translateX(${(Math.random() - 0.5) * glitchAmount}px)`,
      }}
    >
      <Background color="#0a0f1a" particleCount={30} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 30%, rgba(20,40,80,0.3) 0%, transparent 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 100,
          right: 80,
          bottom: 100,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 24,
        }}
      >
        {PANELS.map((panel, i) => {
          const start = 0.1 + i * 0.08;
          const opacity = at(start, start + 0.1, [0, 1]);
          const translateY = interpolate(frame, [start * durationInFrames, (start + 0.1) * durationInFrames], [40, 0], {
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.quad),
          });
          const scale = interpolate(frame, [start * durationInFrames, (start + 0.1) * durationInFrames], [0.95, 1], {
            extrapolateRight: 'clamp',
          });

          return (
            <div
              key={i}
              style={{
                background: 'rgba(10, 20, 40, 0.85)',
                borderRadius: 12,
                border: `1px solid ${panel.color}30`,
                padding: 24,
                opacity,
                transform: `translateY(${translateY}px) scale(${scale})`,
                boxShadow: `0 0 30px ${panel.color}10, inset 0 1px 0 ${panel.color}20`,
                backdropFilter: 'blur(10px)',
              }}
            >
              <div style={{fontSize: 18, fontWeight: 700, color: panel.color, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8}}>
                <div style={{width: 8, height: 8, borderRadius: 2, background: panel.color, boxShadow: `0 0 8px ${panel.color}`}} />
                {panel.title}
              </div>
              {panel.items.map((item, j) => (
                <div
                  key={j}
                  style={{
                    fontSize: 15,
                    color: 'rgba(200, 220, 255, 0.75)',
                    padding: '8px 12px',
                    marginBottom: 6,
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{item}</span>
                  <div style={{width: 6, height: 6, borderRadius: '50%', background: j === 0 ? '#00ff88' : '#444', boxShadow: j === 0 ? '0 0 6px #00ff88' : 'none'}} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 200,
          background: 'linear-gradient(0deg, rgba(0,50,100,0.15) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 24,
          color: 'rgba(180, 200, 255, 0.6)',
          opacity: at(0.5, 0.7, [0, 1]),
        }}
      >
        从喧闹的舆论场，回到真实的产品落地现场
      </div>
    </AbsoluteFill>
  );
};
