import type {CSSProperties} from 'react';
import {STEP_META, STEP_ORDER} from '../../app/workflow';
import type {SceneItem, WorkflowStep} from '../../types';

export function WorkflowStepper({
  step,
  scenes,
  completedScenes,
  totalScenes,
  onStepChange,
}: {
  step: WorkflowStep;
  scenes: SceneItem[];
  completedScenes: number;
  totalScenes: number;
  onStepChange: (step: WorkflowStep) => void;
}) {
  return (
    <div style={stepperStyle}>
      {STEP_ORDER.map((item) => {
        const active = step === item;
        const clickable =
          item === 'script'
            ? true
            : item === 'audio'
              ? completedScenes > 0 || scenes.some((scene) => scene.audioExists)
              : item === 'design'
                ? scenes.some((scene) => scene.captionExists)
                : item === 'preview'
                  ? scenes.some((scene) => scene.captionExists)
                  : item === 'render'
                    ? completedScenes === totalScenes && totalScenes > 0
                    : true;
        return (
          <button
            type="button"
            key={item}
            style={stepButtonStyle(active, clickable)}
            onClick={() => clickable && onStepChange(item)}
            disabled={!clickable}
          >
            <span style={stepDotStyle(active)} />
            <span style={{display: 'block'}}>
              <span style={{display: 'block', fontWeight: 700, fontSize: 13}}>{STEP_META[item].label}</span>
              <span style={{display: 'block', fontSize: 11, opacity: 0.7, marginTop: 2}}>{STEP_META[item].desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const stepperStyle: CSSProperties = {display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14};

function stepButtonStyle(active: boolean, clickable: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 8px',
    borderRadius: 10,
    border: `1px solid ${active ? 'rgba(139,233,253,0.35)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(139,233,253,0.08)' : 'rgba(255,255,255,0.02)',
    color: clickable ? '#e6edf3' : '#5a6a80',
    cursor: clickable ? 'pointer' : 'not-allowed',
    textAlign: 'left',
    opacity: clickable ? 1 : 0.6,
  };
}

function stepDotStyle(active: boolean): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
    background: active ? '#8be9fd' : 'rgba(255,255,255,0.2)',
    boxShadow: active ? '0 0 8px #8be9fd80' : 'none',
  };
}
