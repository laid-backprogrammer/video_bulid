import React from 'react';
import {Scene4 as BaseScene4} from '../Scene4';
import type {SegmentCue} from '../../types';

export const Scene4Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene4 {...props} />;
};
