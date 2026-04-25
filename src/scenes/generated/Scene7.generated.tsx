import React from 'react';
import {Scene7 as BaseScene7} from '../Scene7';
import type {SegmentCue} from '../../types';

export const Scene7Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene7 {...props} />;
};
