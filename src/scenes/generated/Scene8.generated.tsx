import React from 'react';
import {Scene8 as BaseScene8} from '../Scene8';
import type {SegmentCue} from '../../types';

export const Scene8Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene8 {...props} />;
};
