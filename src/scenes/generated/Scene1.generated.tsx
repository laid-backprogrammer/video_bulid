import React from 'react';
import {Scene1 as BaseScene1} from '../Scene1';
import type {SegmentCue} from '../../types';

export const Scene1Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene1 {...props} />;
};
