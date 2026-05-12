import type {CSSProperties} from 'react';
import {formatDuration, getSceneReadiness, isSceneBusy} from '../state';
import type {CodegenStatus, PipelineStatus, RenderStatus, SceneItem, TtsStatus} from '../types';

export function SceneWorkflowStrip({
  scenes,
  selectedId,
  tts,
  codegen,
  render,
  pipeline,
  activeGenerationSceneId,
  pendingAssetCounts,
  generationDisabled,
  onSelect,
  onCommitSelected,
}: {
  scenes: SceneItem[];
  selectedId: string;
  tts: TtsStatus | null;
  codegen: CodegenStatus | null;
  render: RenderStatus | null;
  pipeline: PipelineStatus | null;
  activeGenerationSceneId: string | null;
  pendingAssetCounts: Record<string, number>;
  generationDisabled: boolean;
  onSelect: (sceneId: string) => void;
  onCommitSelected: () => void;
}) {
  const selectedScene = scenes.find((scene) => scene.id === selectedId) ?? scenes[0] ?? null;
  const selectedReady = selectedScene ? getSceneReadiness(selectedScene) : null;
  const activeLabel = activeGenerationSceneId ? `${activeGenerationSceneId} 后台生成中` : selectedReady?.nextAction ?? '选择场景';
  const commitDisabled = generationDisabled || !selectedScene?.text.trim();

  return (
    <section style={wrapStyle}>
      <div style={metaStyle}>
        <span style={kickerStyle}>当前段</span>
        <strong>{selectedScene?.id ?? '未选择'}</strong>
        <span style={statusTextStyle}>{activeLabel}</span>
      </div>
      <div style={sceneRailStyle}>
        {scenes.map((scene) => {
          const active = scene.id === selectedScene?.id;
          const readiness = getSceneReadiness(scene);
          const busy = isSceneBusy(scene.id, tts, codegen, render, pipeline) || activeGenerationSceneId === scene.id;
          const pendingAssets = pendingAssetCounts[scene.id] ?? 0;
          const totalAssets = (scene.assets?.length ?? 0) + pendingAssets;
          return (
            <button key={scene.id} type="button" style={sceneChipStyle(active, busy)} onClick={() => onSelect(scene.id)}>
              <span style={sceneTitleStyle}>
                <strong>{scene.id}</strong>
                <em>{busy ? '生成中' : readiness.label}</em>
              </span>
              <span style={sceneDetailStyle}>
                {formatDuration(scene.durationMs)} · 素材 {totalAssets}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" style={commitButtonStyle(commitDisabled)} disabled={commitDisabled} onClick={onCommitSelected}>
        {activeGenerationSceneId ? '后台生成中' : '敲定本段并后台生成'}
      </button>
    </section>
  );
}

const wrapStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#171717',
  borderRadius: 14,
  padding: 10,
};
const metaStyle: CSSProperties = {display: 'grid', gap: 2, minWidth: 116};
const kickerStyle: CSSProperties = {fontSize: 11, color: '#8c8c8c', fontWeight: 800};
const statusTextStyle: CSSProperties = {fontSize: 12, color: '#a8a8a8', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'};
const sceneRailStyle: CSSProperties = {display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 1};
const sceneChipStyle = (active: boolean, busy: boolean): CSSProperties => {
  const color = busy ? '#ffb703' : active ? '#f2f2f2' : '#a8a8a8';
  return {
    display: 'grid',
    gap: 3,
    minWidth: 118,
    textAlign: 'left',
    border: `1px solid ${active ? 'rgba(255,255,255,0.32)' : busy ? 'rgba(255,183,3,0.34)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? '#2b2b2b' : busy ? 'rgba(255,183,3,0.08)' : '#202020',
    color,
    borderRadius: 10,
    padding: '8px 9px',
    cursor: 'pointer',
  };
};
const sceneTitleStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 13};
const sceneDetailStyle: CSSProperties = {fontSize: 11, color: '#8c8c8c'};
const commitButtonStyle = (disabled: boolean): CSSProperties => ({
  border: '1px solid rgba(255,255,255,0.14)',
  background: disabled ? '#292929' : '#f2f2f2',
  color: disabled ? '#777' : '#111',
  borderRadius: 999,
  padding: '9px 13px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 900,
  whiteSpace: 'nowrap',
});
