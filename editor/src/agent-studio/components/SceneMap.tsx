import type {CSSProperties} from 'react';
import {formatDuration, getOverallReadiness, getSceneReadiness, isSceneBusy} from '../state';
import type {CodegenStatus, PipelineStatus, RenderStatus, SceneItem, TtsStatus} from '../types';

export function SceneMap({
  scenes,
  selectedId,
  tts,
  codegen,
  render,
  pipeline,
  onSelect,
}: {
  scenes: SceneItem[];
  selectedId: string;
  tts: TtsStatus | null;
  codegen: CodegenStatus | null;
  render: RenderStatus | null;
  pipeline: PipelineStatus | null;
  onSelect: (sceneId: string) => void;
}) {
  const overall = getOverallReadiness(scenes);

  return (
    <aside style={wrapStyle}>
      <div style={sectionHeaderStyle}>
        <span style={kickerStyle}>Production Map</span>
        <h1 style={titleStyle}>视频制作地图</h1>
        <p style={mutedStyle}>
          已就绪 {overall.readyScenes}/{overall.includedScenes || 0} 段 · 可预览 {overall.previewableScenes} 段
        </p>
      </div>

      <div style={meterShellStyle}>
        <div style={{...meterFillStyle, width: `${overall.percent}%`}} />
      </div>

      <div style={sceneListStyle}>
        {scenes.map((scene) => {
          const readiness = getSceneReadiness(scene);
          const active = selectedId === scene.id;
          const busy = isSceneBusy(scene.id, tts, codegen, render, pipeline);
          return (
            <button
              key={scene.id}
              type="button"
              style={sceneButtonStyle(active)}
              onClick={() => onSelect(scene.id)}
            >
              <div style={sceneTopStyle}>
                <strong style={{fontSize: 14}}>{scene.id}</strong>
                <span style={statusPillStyle(readiness.readyForRender, busy)}>
                  {busy ? '运行中' : scene.enabled === false ? '未入片' : readiness.label}
                </span>
              </div>
              <p style={textPreviewStyle}>{scene.text.trim() || '还没有文案'}</p>
              <div style={dotRowStyle}>
                {['文案', '语音', '字幕', '设计', 'Cue', '成片'].map((label, index) => (
                  <span
                    key={label}
                    title={label}
                    style={dotStyle(index < readiness.score)}
                  />
                ))}
              </div>
              <div style={sceneFootStyle}>
                <span>{readiness.nextAction}</span>
                <span>{formatDuration(scene.durationMs)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

const wrapStyle: CSSProperties = {
  minWidth: 0,
  height: '100%',
  overflow: 'auto',
  borderRight: '1px solid rgba(255,255,255,0.08)',
  background: '#071018',
  padding: 16,
};
const sectionHeaderStyle: CSSProperties = {display: 'grid', gap: 4, marginBottom: 12};
const kickerStyle: CSSProperties = {fontSize: 11, color: '#7bdff2', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8};
const titleStyle: CSSProperties = {margin: 0, fontSize: 22, color: '#f7fbff', letterSpacing: 0};
const mutedStyle: CSSProperties = {margin: 0, color: '#8ea3bb', fontSize: 12, lineHeight: 1.5};
const meterShellStyle: CSSProperties = {height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14};
const meterFillStyle: CSSProperties = {height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #2ec4b6, #4cc9f0)'};
const sceneListStyle: CSSProperties = {display: 'grid', gap: 8};
const sceneButtonStyle = (active: boolean): CSSProperties => ({
  display: 'grid',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  border: `1px solid ${active ? 'rgba(76,201,240,0.55)' : 'rgba(255,255,255,0.08)'}`,
  background: active ? 'rgba(76,201,240,0.10)' : 'rgba(255,255,255,0.035)',
  color: '#e6edf3',
  borderRadius: 8,
  padding: 11,
  cursor: 'pointer',
});
const sceneTopStyle: CSSProperties = {display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8};
const statusPillStyle = (ready: boolean, busy: boolean): CSSProperties => {
  const color = busy ? '#ffb703' : ready ? '#2ec4b6' : '#a8dadc';
  return {
    border: `1px solid ${color}55`,
    background: `${color}14`,
    color,
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    whiteSpace: 'nowrap',
  };
};
const textPreviewStyle: CSSProperties = {
  margin: 0,
  color: '#c8d7e8',
  fontSize: 12,
  lineHeight: 1.45,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
const dotRowStyle: CSSProperties = {display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5};
const dotStyle = (done: boolean): CSSProperties => ({
  height: 5,
  borderRadius: 999,
  background: done ? '#2ec4b6' : 'rgba(255,255,255,0.12)',
});
const sceneFootStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 8, color: '#8ea3bb', fontSize: 11};

