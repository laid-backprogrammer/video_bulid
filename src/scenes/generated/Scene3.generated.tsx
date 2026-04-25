import React from 'react';
import {Scene3 as BaseScene3} from '../Scene3';
import type {SegmentCue} from '../../types';

export const Scene3Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene3 {...props} />;
};
