# Generated Scene Contract

CLI agents should only edit `SceneX.generated.tsx` for the requested scene.

Required export shape:

```tsx
export const SceneXGenerated: React.FC<{
  cues: SegmentCue[];
  durationInFrames: number;
}> = ({cues, durationInFrames}) => {
  return <AbsoluteFill>{/* scene */}</AbsoluteFill>;
};
```

Rules:

- Do not edit `Root.tsx`, server files, editor files, package files, or other scene files.
- Use `durationInFrames` and `cues[].words[]` to drive timing.
- Keep imports limited to React, `remotion`, local hooks/components, and existing dependencies.
- Do not add network requests or browser-only APIs.
- Keep text inside the frame and avoid overlapping captions.
- Run `npx tsc --noEmit` and `npm run editor:build` after changes.

Creative freedom:

- You may freely invent the visual metaphor, camera movement, typography, spatial layout, abstract shapes, charts, UI mockups, symbolic objects, particle systems, and transitions.
- Treat `designNotes` as a creative brief, not a literal template. You may expand it if the result still supports the narration.
- Do not make a generic background. Every visual beat should support the current narration and timestamped words.
- Align important reveals, highlights, cuts, and motion accents to `cues[].words[]` timing.
- Prefer rich motion and clear visual storytelling over static cards or explanatory text.
