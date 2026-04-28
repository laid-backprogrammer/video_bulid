export const BASE_RULE_FILES = [
  'skills/SKILL.md',
  'skills/rules/timing.md',
  'skills/rules/animations.md',
  'skills/rules/sequencing.md',
  'skills/rules/display-captions.md',
];

export const ruleCatalog = [
  {
    file: 'skills/rules/assets.md',
    description: 'How generated scenes should receive uploaded image/video/audio assets through props, derive staticFile paths at runtime, and respect @mentioned asset roles.',
    useWhen: [
      'The scene includes uploaded user assets or visual references.',
      'The brief asks to render, adapt, or avoid rendering user-provided media.',
      'Asset deletion safety matters because stale public paths must not be embedded in code.',
    ],
    avoidWhen: [
      'The scene has no user assets and does not mention asset handling.',
    ],
  },
  {
    file: 'skills/rules/images.md',
    description: 'Image rendering practices for Remotion, including Img/staticFile usage, sizing, cropping, masks, overlays, and frame-safe image composition.',
    useWhen: [
      'The scene should show photos, screenshots, PNG/WebP/JPEG assets, mockups, or image-like panels.',
      'The brief depends on visual reference matching, collage, reveal, or image treatment.',
    ],
    avoidWhen: [
      'The scene is entirely vector, text, chart, or abstract shape driven.',
    ],
  },
  {
    file: 'skills/rules/text-animations.md',
    description: 'Word/line reveal, emphasis, type-like motion, kinetic typography, and narration-derived text effects using cue and word timings.',
    useWhen: [
      'The scene needs keyword emphasis, headline motion, word-by-word reveals, or typography as a main visual layer.',
      'The visual idea relies on text rhythm rather than only background captions.',
    ],
    avoidWhen: [
      'Text is only a subtitle overlay and the main visual is not typography-led.',
    ],
  },
  {
    file: 'skills/rules/transitions.md',
    description: 'Frame-driven scene/camera transitions, wipes, pushes, zooms, reveals, and paced phase changes inside a generated scene.',
    useWhen: [
      'The brief names multiple visual phases, camera movement, wipes, pushes, zooms, or clear before/after states.',
      'The scene needs transitions between cue-driven panels or sections.',
    ],
    avoidWhen: [
      'The scene is a single continuous composition without distinct phase changes.',
    ],
  },
  {
    file: 'skills/rules/charts.md',
    description: 'Remotion-safe data visualization patterns for bars, lines, counters, comparisons, progress rings, dashboards, and metric animations.',
    useWhen: [
      'The brief asks for metrics, comparisons, dashboards, growth/decline, timelines, or quantified claims.',
      'A chart-like visual metaphor would make the narration clearer.',
    ],
    avoidWhen: [
      'There is no data, comparison, or metric structure in the brief.',
    ],
  },
  {
    file: 'skills/rules/measuring-text.md',
    description: 'Text fitting, wrapping, density management, and layout protection for long CJK/English narration or compact UI surfaces.',
    useWhen: [
      'The scene has dense captions, long phrases, many cues, or compact panels where overflow is likely.',
      'The generated design includes cards, labels, tickers, callouts, or dynamically sized text blocks.',
    ],
    avoidWhen: [
      'Only short, low-density labels are used.',
    ],
  },
  {
    file: 'skills/rules/fonts.md',
    description: 'Typography guidance for font loading, font stacks, hierarchy, weights, and consistent type choices in Remotion scenes.',
    useWhen: [
      'The brief specifies typography, brand feeling, editorial style, or type hierarchy.',
      'The scene relies on typographic tone as part of the visual identity.',
    ],
    avoidWhen: [
      'Default typography is sufficient and not central to the scene.',
    ],
  },
  {
    file: 'skills/rules/3d.md',
    description: '3D and perspective-style composition techniques suitable for Remotion scenes, including depth, parallax, and spatial layouts.',
    useWhen: [
      'The brief asks for depth, perspective, 3D, spatial layers, camera orbit, or immersive dimensional metaphors.',
      'The scene would benefit from a pseudo-3D layout without adding unavailable packages.',
    ],
    avoidWhen: [
      'A flat 2D composition better matches the brief and style guide.',
    ],
  },
  {
    file: 'skills/rules/audio-visualization.md',
    description: 'Voice/audio-inspired visual systems such as waveforms, meters, pulse fields, rhythm bars, and speech-energy motion.',
    useWhen: [
      'The brief mentions audio, voice, beats, rhythm, waveform, spectrum, or sound-reactive visuals.',
      'The narration timing should visibly drive pulses or signal-like elements.',
    ],
    avoidWhen: [
      'The scene has no sound or rhythm visual metaphor beyond normal subtitle timing.',
    ],
  },
  {
    file: 'skills/rules/videos.md',
    description: 'Video asset handling patterns for Remotion, including clips, loops, trimming, fitting, and compositing.',
    useWhen: [
      'The scene includes or may render video clips as user assets.',
      'The brief asks for footage, screen recording, or moving media layers.',
    ],
    avoidWhen: [
      'Only still images, vectors, text, or generated shapes are needed.',
    ],
  },
  {
    file: 'skills/rules/audio.md',
    description: 'Audio asset handling patterns for Remotion, including timed SFX, click sounds, music beds, trimming, volume, speed, and looping.',
    useWhen: [
      'The scene includes uploaded audio assets.',
      'The brief asks for a click sound, whoosh, sound effect, music cue, or timed audio layer.',
    ],
    avoidWhen: [
      'The scene has no audio media beyond the narration voiceover.',
    ],
  },
  {
    file: 'skills/rules/maps.md',
    description: 'Map, route, geospatial, location, and navigation-inspired visual patterns without relying on network APIs.',
    useWhen: [
      'The brief asks for maps, routes, geography, locations, movement across places, or navigation UI.',
      'A route/map metaphor would clarify the scene.',
    ],
    avoidWhen: [
      'There is no spatial or geographic concept in the scene.',
    ],
  },
];

export const createBaseSkillSelection = ({mode = 'generate', reason = 'base generation capabilities before LLM skill selection'} = {}) => ({
  mode,
  baseRuleFiles: BASE_RULE_FILES,
  selectedRuleFiles: BASE_RULE_FILES,
  selected: [],
  skipped: ruleCatalog.map((rule) => ({file: rule.file, reason: 'not selected yet'})),
  budget: {
    maxConditionalRules: 0,
    selectedConditionalRules: 0,
  },
  source: 'base',
  reason,
});

export const normalizeSkillSelection = ({selectedRuleFiles = [], reasons = {}, mode = 'generate', source = 'llm'} = {}) => {
  const knownFiles = new Set([...BASE_RULE_FILES, ...ruleCatalog.map((rule) => rule.file)]);
  const selected = [...new Set([...BASE_RULE_FILES, ...selectedRuleFiles])]
    .filter((file) => knownFiles.has(file));
  const selectedConditional = selected
    .filter((file) => !BASE_RULE_FILES.includes(file))
    .map((file) => ({
      file,
      reason: reasons[file] || 'selected by main agent',
    }));
  const skipped = ruleCatalog
    .filter((rule) => !selected.includes(rule.file))
    .map((rule) => ({file: rule.file, reason: 'not selected by main agent'}));

  return {
    mode,
    baseRuleFiles: BASE_RULE_FILES,
    selectedRuleFiles: selected,
    selected: selectedConditional,
    skipped,
    budget: {
      maxConditionalRules: ruleCatalog.length,
      selectedConditionalRules: selectedConditional.length,
    },
    source,
  };
};

export const applyRequiredSkillRules = (selection, {sceneAssets = []} = {}) => {
  const insertableAssets = Array.isArray(sceneAssets)
    ? sceneAssets.filter((asset) => asset.role === 'render' || asset.role === 'both')
    : [];
  if (insertableAssets.length === 0) return selection;

  const hasImageAssets = insertableAssets.some((asset) => asset.assetType === 'image');
  const hasVideoAssets = insertableAssets.some((asset) => asset.assetType === 'video');
  const hasAudioAssets = insertableAssets.some((asset) => asset.assetType === 'audio');

  const required = [
    {
      file: 'skills/rules/assets.md',
      reason: 'required because the scene has @mentioned uploaded media assets that must be selected from runtime assets',
    },
    hasImageAssets ? {
      file: 'skills/rules/images.md',
      reason: 'required because visible uploaded images must use Remotion Img/staticFile correctly',
    } : null,
    hasVideoAssets ? {
      file: 'skills/rules/videos.md',
      reason: 'required because uploaded video assets must use Remotion Video/staticFile correctly',
    } : null,
    hasAudioAssets ? {
      file: 'skills/rules/audio.md',
      reason: 'required because uploaded audio/SFX assets must use Remotion Audio/staticFile and Sequence timing correctly',
    } : null,
  ].filter(Boolean);
  const selectedRuleFiles = [...new Set([...selection.selectedRuleFiles, ...required.map((item) => item.file)])];
  const selected = [
    ...selection.selected.filter((item) => !required.some((requiredItem) => requiredItem.file === item.file)),
    ...required,
  ];
  const skipped = selection.skipped.filter((item) => !required.some((requiredItem) => requiredItem.file === item.file));

  return {
    ...selection,
    selectedRuleFiles,
    selected,
    skipped,
    budget: {
      ...selection.budget,
      selectedConditionalRules: selected.filter((item) => !BASE_RULE_FILES.includes(item.file)).length,
    },
    required: [
      ...(selection.required ?? []),
      ...required,
    ],
  };
};

export const skillCatalogMarkdown = () => [
  'Base rules are always injected:',
  ...BASE_RULE_FILES.map((file) => `- ${file}`),
  '',
  'Conditional rules the Main Agent may choose. Select by semantic fit, not keyword matching:',
  ...ruleCatalog.flatMap((rule) => [
    `- ${rule.file}`,
    `  Description: ${rule.description}`,
    `  Use when: ${rule.useWhen.join(' | ')}`,
    `  Avoid when: ${rule.avoidWhen.join(' | ')}`,
  ]),
].join('\n');

export const skillSelectionMarkdown = (selection) => [
  `Selection source: ${selection.source || 'unknown'}`,
  selection.reason ? `Selection reason: ${selection.reason}` : null,
  selection.required?.length ? `Required by structured context: ${selection.required.map((item) => item.file).join(', ')}` : null,
  '',
  'Selected skill/rule files:',
  ...selection.selectedRuleFiles.map((file) => {
    const detail = selection.selected.find((item) => item.file === file);
    const reason = detail?.reason || 'base Remotion generation capability';
    return `- ${file}: ${reason}`;
  }),
  '',
  'Skipped conditional rule files:',
  ...selection.skipped.map((item) => `- ${item.file}: ${item.reason}`),
].filter((line) => line !== null).join('\n');
