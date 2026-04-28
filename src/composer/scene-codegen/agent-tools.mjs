export const mainAgentReadTools = [
  {
    name: 'read_scene_brief',
    purpose: 'Read scene text, designNotes, tuningNotes, uploaded asset metadata, and caption timing summaries.',
    scope: 'Current scene only.',
  },
  {
    name: 'list_skill_rules',
    purpose: 'Inspect available Remotion skill/rule files before deciding which capabilities are relevant.',
    scope: 'skills/SKILL.md and skills/rules/*.md metadata.',
  },
  {
    name: 'read_selected_skill_rule',
    purpose: 'Read a selected skill/rule file after the need is identified from the scene brief or timing.',
    scope: 'Only selected rules are injected into the code-writing context.',
  },
  {
    name: 'read_reference_component',
    purpose: 'Read stable local references such as types, hooks, CaptionOverlay, and Background components.',
    scope: 'Read-only repository references required by the generated scene contract.',
  },
];

export const codeWriterEditTools = [
  {
    name: 'edit_generated_scene',
    purpose: 'Write the complete target SceneX.generated.tsx file.',
    scope: 'Only the single file in allowedWriteFiles may be edited.',
  },
  {
    name: 'validate_generated_scene',
    purpose: 'Run local guards, TypeScript, and editor build checks after editing.',
    scope: 'Read-only validation commands from validationCommands.',
  },
  {
    name: 'repair_generated_scene',
    purpose: 'Apply a complete-file repair when validation fails.',
    scope: 'Only the failed candidate and validation error should drive the repair.',
  },
];

export const agentToolsMarkdown = ({allowedWriteFiles = [], validationCommands = []} = {}) => [
  'Main Agent read tools:',
  ...mainAgentReadTools.map((tool) => `- ${tool.name}: ${tool.purpose} Scope: ${tool.scope}`),
  '',
  'Code Writer edit tools:',
  ...codeWriterEditTools.map((tool) => `- ${tool.name}: ${tool.purpose} Scope: ${tool.scope}`),
  '',
  `Allowed edit files: ${allowedWriteFiles.length ? allowedWriteFiles.join(', ') : '(none)'}`,
  `Validation commands: ${validationCommands.length ? validationCommands.join(' && ') : '(none)'}`,
].join('\n');
