import type {CSSProperties} from 'react';
import type {WorkflowStep} from '../../types';

export function WorkflowActions({
  step,
  anyRunning,
  completedScenes,
  totalScenes,
  ttsRunning,
  ttsStatusText,
  onRegenerateAllTts,
  onRunAllPipeline,
  onRebuildManifest,
  onRenderVideo,
  onOpenStudio,
}: {
  step: WorkflowStep;
  anyRunning: boolean;
  completedScenes: number;
  totalScenes: number;
  ttsRunning: boolean;
  ttsStatusText: string;
  onRegenerateAllTts: () => void;
  onRunAllPipeline: () => void;
  onRebuildManifest: () => void;
  onRenderVideo: () => void;
  onOpenStudio: () => void;
}) {
  return (
    <div style={globalActionsStyle}>
      {step === 'script' ? <span style={hintStyle}>编辑左侧每段文案，完成后进入「语音」步骤生成音频。</span> : null}
      {step === 'audio' ? (
        <>
          <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={onRegenerateAllTts} disabled={anyRunning}>
            重做全部语音
          </button>
          <button type="button" style={buttonStyle('#50fa7b', anyRunning)} onClick={onRunAllPipeline} disabled={anyRunning}>
            一键重做语音+对齐全部
          </button>
          <button type="button" style={buttonStyle('#ffb86c', anyRunning)} onClick={onRebuildManifest} disabled={anyRunning}>
            重建预览数据
          </button>
          {ttsRunning ? <span style={{color: '#50fa7b', fontSize: 12}}>语音生成中：{ttsStatusText}</span> : null}
        </>
      ) : null}
      {step === 'design' ? (
        <>
          <span style={hintStyle}>为每个场景生成视觉设计方案，作为后续绘制的参考。</span>
          <button type="button" style={buttonStyle('#bd93f9', anyRunning)} onClick={onRebuildManifest} disabled={anyRunning}>
            重建预览数据
          </button>
        </>
      ) : null}
      {step === 'preview' ? (
        <>
          <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={onRebuildManifest} disabled={anyRunning}>
            重建预览数据
          </button>
          <button type="button" style={buttonStyle('#bd93f9')} onClick={onOpenStudio}>
            在 Studio 中打开
          </button>
        </>
      ) : null}
      {step === 'render' ? (
        <>
          <button
            type="button"
            style={buttonStyle('#ff79c6', anyRunning || completedScenes < totalScenes)}
            onClick={onRenderVideo}
            disabled={anyRunning || completedScenes < totalScenes}
          >
            渲染完整视频
          </button>
          {completedScenes < totalScenes ? (
            <span style={{color: '#ff6b6b', fontSize: 12}}>还有 {totalScenes - completedScenes} 段未就绪</span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const globalActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 14,
  minHeight: 36,
};
const hintStyle: CSSProperties = {color: '#9fb3c8', fontSize: 13};

function buttonStyle(color: string, disabled = false): CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.05)' : `${color}18`,
    color: disabled ? '#6f8098' : color,
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : `${color}55`}`,
    borderRadius: 10,
    padding: '9px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: 13,
    opacity: disabled ? 0.62 : 1,
  };
}
