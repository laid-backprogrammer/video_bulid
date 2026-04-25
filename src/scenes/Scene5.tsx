import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, Easing, spring} from 'remotion';
import {Background} from '../components/Background';
import {useSceneProgress} from '../hooks/useSceneProgress';
import type {SegmentCue} from '../types';

const SCENARIOS = [
  {name: '客服自动化', color: '#00d4ff', x: -280, y: -180},
  {name: '销售线索跟进', color: '#00ff88', x: 280, y: -180},
  {name: '数据分析助手', color: '#ffaa00', x: -320, y: 0},
  {name: '复杂任务执行', color: '#ff66aa', x: 320, y: 0},
  {name: '内部知识问答', color: '#aa66ff', x: -280, y: 180},
  {name: '多步骤审批协同', color: '#ff6644', x: 280, y: 180},
];

export const Scene5: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({durationInFrames}) => {
  const {frame, fps, at} = useSceneProgress(durationInFrames);
  const {width, height} = {width: 1920, height: 1080};

  const chaosPhase = at(0, 0.4, [0, 1]);
  const organizePhase = at(0.35, 0.7, [0, 1]);

  const lines = useMemo(() => {
    return SCENARIOS.map((s, i) => {
      return SCENARIOS.map((t, j) => {
        if (i >= j) return null;
        return {from: i, to: j, chaosOffset: Math.sin(i * 7 + j * 11) * 100};
      }).filter(Boolean);
    }).flat();
  }, []);

  return (
    <AbsoluteFill>
      <Background particleCount={40} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,200,255,0.3) 0%, transparent 70%)',
            border: '2px solid rgba(0,200,255,0.5)',
            boxShadow: '0 0 60px rgba(0,200,255,0.3), inset 0 0 40px rgba(0,200,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 800,
            color: '#00e5ff',
            textShadow: '0 0 20px #00e5ff80',
            transform: `scale(${1 + 0.05 * Math.sin(frame * 0.08)})`,
          }}
        >
          Agent
        </div>
      </AbsoluteFill>

      <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        {lines.map((line, idx) => {
          if (!line) return null;
          const from = SCENARIOS[line.from];
          const to = SCENARIOS[line.to];
          const x1 = width / 2 + from.x * 0.4;
          const y1 = height / 2 + from.y * 0.4;
          const x2 = width / 2 + to.x * 0.4;
          const y2 = height / 2 + to.y * 0.4;
          const midX = (x1 + x2) / 2 + line.chaosOffset * (1 - organizePhase);
          const midY = (y1 + y2) / 2 + Math.cos(line.from * 5) * 60 * (1 - organizePhase);
          const opacity = organizePhase > 0.5 ? 0.15 : 0.4;
          return (
            <path
              key={idx}
              d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
              fill="none"
              stroke="rgba(0,200,255,0.4)"
              strokeWidth={1.5}
              opacity={opacity}
              strokeDasharray={organizePhase > 0.3 ? "6 4" : "none"}
            />
          );
        })}
      </svg>

      {SCENARIOS.map((scenario, i) => {
        const delay = 0.05 + i * 0.05;
        const nodeProgress = spring({
          frame: frame - delay * durationInFrames,
          fps,
          config: {damping: 200},
        });

        const targetX = scenario.x;
        const targetY = scenario.y;
        const chaosX = targetX + Math.sin(i * 13) * 200 * (1 - chaosPhase);
        const chaosY = targetY + Math.cos(i * 17) * 150 * (1 - chaosPhase);
        const currentX = chaosX * (1 - organizePhase) + targetX * organizePhase;
        const currentY = chaosY * (1 - organizePhase) + targetY * organizePhase;
        const opacity = nodeProgress * (0.5 + organizePhase * 0.5);
        const scale = nodeProgress * (0.8 + organizePhase * 0.2);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: width / 2 + currentX,
              top: height / 2 + currentY,
              transform: `translate(-50%, -50%) scale(${scale})`,
              opacity,
            }}
          >
            <div
              style={{
                padding: '14px 28px',
                borderRadius: 12,
                background: 'rgba(5, 15, 35, 0.9)',
                border: `1.5px solid ${scenario.color}60`,
                boxShadow: `0 0 25px ${scenario.color}20, 0 4px 20px rgba(0,0,0,0.3)`,
                backdropFilter: 'blur(10px)',
                textAlign: 'center',
                minWidth: 160,
              }}
            >
              <div style={{width: 10, height: 10, borderRadius: '50%', background: scenario.color, margin: '0 auto 8px', boxShadow: `0 0 12px ${scenario.color}`}} />
              <div style={{fontSize: 18, fontWeight: 700, color: scenario.color}}>{scenario.name}</div>
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 28,
          fontWeight: 600,
          color: '#e0f0ff',
          opacity: at(0.6, 0.8, [0, 1]),
          textShadow: '0 0 20px rgba(0,200,255,0.2)',
        }}
      >
        很多人讨论 Agent 的时候，<span style={{color: '#00e5ff'}}>根本没把场景分清楚</span>
      </div>
    </AbsoluteFill>
  );
};
