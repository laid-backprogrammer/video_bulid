import React from 'react';
import {Scene2 as BaseScene2} from '../Scene2';
import type {SegmentCue} from '../../types';

export const Scene2Generated: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = (props) => {
  return <BaseScene2 {...props} />;
};
