import React from 'react';
import {Scene5 as BaseScene5} from '../Scene5';
import type {SegmentCue} from '../../types';

export const Scene5Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene5 {...props} />;
};
