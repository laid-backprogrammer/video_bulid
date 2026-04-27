import type {CSSProperties} from 'react';
import {formatDuration, getSceneProgress} from '../../app/workflow';
import {MiniBtn} from '../../components/ui/MiniBtn';
import {StepDots} from '../../components/ui/StepDots';
import type {CodegenStatus, PipelineStatus, SceneItem, ScriptScene, TtsStatus, WorkflowStep} from '../../types';

export function SceneList({
  configScenes,
  sceneStatuses,
  pipeline,
  selectedId,
  step,
  anyRunning,
  ttsStatus,
  codegen,
  onSelect,
  onUpdateSceneText,
  onRunTts,
  onRunAsr,
  onRunScenePipeline,
  onOpenDesign,
  onRunSceneCodegen,
  onRenderScenePreview,
  onOpenTune,
}: {
  configScenes: ScriptScene[];
  sceneStatuses: SceneItem[];
  pipeline: PipelineStatus | null;
  selectedId: string;
  step: WorkflowStep;
  anyRunning: boolean;
  ttsStatus: TtsStatus | null;
  codegen: CodegenStatus | null;
  onSelect: (sceneId: string) => void;
  onUpdateSceneText: (sceneId: string, text: string) => void;
  onRunTts: (sceneId: string, force: boolean) => void;
  onRunAsr: (sceneId: string) => void;
  onRunScenePipeline: (sceneId: string) => void;
  onOpenDesign: (sceneId: string) => void;
  onRunSceneCodegen: (sceneId: string) => void;
  onRenderScenePreview: (sceneId: string) => void;
  onOpenTune: (sceneId: string) => void;
}) {
  const isTtsActiveForScene = (sceneId: string) =>
    Boolean(ttsStatus?.running && (ttsStatus.mode === 'all' || ttsStatus.currentSceneId === sceneId || ttsStatus.sceneId === sceneId));
  const isCodegenActiveForScene = (sceneId: string) => Boolean(codegen?.running && codegen.sceneId === sceneId);

  return (
    <div style={sceneListStyle}>
      {configScenes.map((scene) => {
        const status = sceneStatuses.find((item) => item.id === scene.id);
        const live = pipeline?.scenes.find((item) => item.id === scene.id);
        const isSelected = selectedId === scene.id;
        const progress = status ? getSceneProgress(status) : 0;
        const ttsLive = isTtsActiveForScene(scene.id);
        const codegenLive = isCodegenActiveForScene(scene.id);
        return (
          <article
            key={scene.id}
            style={{
              ...sceneCardStyle,
              borderColor: isSelected ? '#8be9fd' : 'rgba(255,255,255,0.08)',
            }}
          >
            <div style={sceneHeaderStyle} onClick={() => onSelect(scene.id)}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <strong>{scene.id}</strong>
                <span style={pillStyle(status?.audioExists, status?.captionExists)}>
                  {status?.audioExists && status?.captionExists ? '可预览' : status?.audioExists ? '待对齐' : '待语音'}
                </span>
              </div>
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <StepDots progress={progress} />
                <span style={{fontSize: 12, color: '#9fb3c8'}}>{formatDuration(status?.durationMs)}</span>
              </div>
            </div>

            {step === 'script' ? (
              <div style={{padding: '0 14px 14px'}} onClick={(event) => event.stopPropagation()}>
                <textarea
                  value={scene.text}
                  onChange={(event) => onUpdateSceneText(scene.id, event.target.value)}
                  style={textareaStyle}
                  rows={2}
                />
                <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6}}>
                  <span style={{fontSize: 12, color: '#9fb3c8'}}>{scene.text.length} 字</span>
                  {scene.tuningNotes ? <span style={{fontSize: 12, color: '#bd93f9'}}>有微调备注</span> : null}
                  {scene.designNotes ? <span style={{fontSize: 12, color: '#50fa7b'}}>有设计方案</span> : null}
                </div>
              </div>
            ) : (
              <div style={{padding: '0 14px 14px', fontSize: 14, color: '#c8dcff', lineHeight: 1.6}} onClick={() => onSelect(scene.id)}>
                {scene.text}
                {scene.tuningNotes || scene.designNotes ? (
                  <div style={{display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap'}}>
                    {scene.designNotes ? <span style={badgeStyle('#50fa7b')}>设计</span> : null}
                    {scene.tuningNotes ? <span style={badgeStyle('#bd93f9')}>微调</span> : null}
                  </div>
                ) : null}
              </div>
            )}

            <div style={actionRowStyle}>
              {step === 'audio' ? (
                <>
                  <MiniBtn disabled={anyRunning} onClick={() => onRunTts(scene.id, Boolean(status?.audioExists))}>
                    {status?.audioExists ? '重新生成语音' : '生成语音'}
                  </MiniBtn>
                  <MiniBtn disabled={anyRunning || !status?.audioExists} onClick={() => onRunAsr(scene.id)}>
                    对齐时间轴
                  </MiniBtn>
                  <MiniBtn disabled={anyRunning} onClick={() => onRunScenePipeline(scene.id)}>
                    本段全流程
                  </MiniBtn>
                </>
              ) : null}
              {step === 'design' ? (
                <>
                  <MiniBtn disabled={anyRunning} onClick={() => onOpenDesign(scene.id)}>
                    {scene.designNotes ? '重新设计' : '生成设计方案'}
                  </MiniBtn>
                  <MiniBtn disabled={anyRunning || !status?.captionExists} onClick={() => onRunSceneCodegen(scene.id)}>
                    生成 Remotion 代码
                  </MiniBtn>
                </>
              ) : null}
              {step === 'preview' ? (
                <>
                  <MiniBtn disabled={anyRunning || !status?.audioExists} onClick={() => onRenderScenePreview(scene.id)}>
                    渲染本段预览
                  </MiniBtn>
                  <MiniBtn disabled={anyRunning} onClick={() => onOpenTune(scene.id)}>
                    LLM 微调
                  </MiniBtn>
                </>
              ) : null}
              {codegenLive ? (
                <span style={{fontSize: 12, color: '#bd93f9', marginLeft: 'auto'}}>Remotion 代码生成中：{codegen?.message}</span>
              ) : ttsLive ? (
                <span style={{fontSize: 12, color: '#50fa7b', marginLeft: 'auto'}}>语音生成中：{ttsStatus?.message}</span>
              ) : live ? (
                <span style={{fontSize: 12, color: '#8be9fd', marginLeft: 'auto'}}>
                  运行中：{live.step}/{live.status}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

const sceneListStyle: CSSProperties = {display: 'grid', gap: 10};
const sceneCardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
};
const sceneHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 14px',
  cursor: 'pointer',
};
const textareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#070b16',
  color: '#e6edf3',
  padding: 10,
  lineHeight: 1.5,
  fontSize: 14,
};
const actionRowStyle: CSSProperties = {display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 14px 12px'};

function pillStyle(audio = false, caption = false): CSSProperties {
  const color = audio && caption ? '#50fa7b' : audio ? '#ffb86c' : '#ff6b6b';
  return {fontSize: 11, color, border: `1px solid ${color}55`, borderRadius: 999, padding: '3px 8px', background: `${color}14`};
}

function badgeStyle(color: string): CSSProperties {
  return {fontSize: 11, color, border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', background: `${color}12`};
}
