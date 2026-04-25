import React from 'react';
import {Scene6 as BaseScene6} from '../Scene6';
import type {SegmentCue} from '../../types';

export const Scene6Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene6 {...props} />;
};
