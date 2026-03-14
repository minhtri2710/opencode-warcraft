export type PlanScaffoldMode = 'lightweight' | 'standard';

export interface ManualPlanScaffoldTask {
  folder: string;
  name: string;
  brief?: string | null;
}

const SECTION_LABELS = ['Background', 'Impact', 'Safety', 'Verify', 'Rollback', 'Reasoning', 'Scope'] as const;

type SectionLabel = (typeof SECTION_LABELS)[number];

type BriefSections = Partial<Record<Lowercase<SectionLabel>, string>>;

function extractSection(brief: string, label: SectionLabel): string | null {
  const labelsPattern = SECTION_LABELS.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedLabel}\\s*:\\s*([\\s\\S]*?)(?=\\b(?:${labelsPattern})\\s*:|$)`, 'i');
  const match = brief.match(regex);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

function parseBriefSections(brief?: string | null): BriefSections {
  if (!brief?.trim()) return {};

  return {
    background: extractSection(brief, 'Background') ?? undefined,
    impact: extractSection(brief, 'Impact') ?? undefined,
    safety: extractSection(brief, 'Safety') ?? undefined,
    verify: extractSection(brief, 'Verify') ?? undefined,
    rollback: extractSection(brief, 'Rollback') ?? undefined,
    reasoning: extractSection(brief, 'Reasoning') ?? undefined,
    scope: extractSection(brief, 'Scope') ?? undefined,
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function renderDiscoveryField(label: string, values: string[], fallback: string): string[] {
  return [`- **${label}**:`, ...(values.length > 0 ? values.map((value) => `  - ${value}`) : [`  - ${fallback}`])];
}

function buildTaskSection(task: ManualPlanScaffoldTask, index: number): string[] {
  const sections = parseBriefSections(task.brief);
  const briefSummary = uniqueNonEmpty([sections.background, sections.impact, sections.reasoning, sections.scope]).join(' ');
  const verify = sections.verify ?? 'Review and replace with the exact verification command(s) before approval.';

  return [
    `### ${index + 1}. ${task.name}`,
    '',
    `**Depends on**: ${index === 0 ? 'none' : index}`,
    '',
    '**What to do**:',
    `- Carry forward the intent from manual task \`${task.folder}\`.`,
    `- ${briefSummary || 'Refine this task from the existing manual brief before approval.'}`,
    '- Add explicit file targets, references, and guardrails before approval.',
    '',
    '**References**:',
    `- Existing manual task: \`${task.folder}\``,
    '',
    '**Verify**:',
    `- [ ] ${verify}`,
  ];
}

export function buildPlanScaffold(
  featureName: string,
  mode: PlanScaffoldMode,
  tasks: ManualPlanScaffoldTask[],
): string | null {
  if (tasks.length === 0) return null;

  const parsedTasks = tasks.map((task) => ({ task, sections: parseBriefSections(task.brief) }));
  const background = uniqueNonEmpty(parsedTasks.flatMap(({ sections }) => [sections.background, sections.reasoning]));
  const impact = uniqueNonEmpty(parsedTasks.flatMap(({ sections }) => [sections.impact, sections.scope]));
  const safety = uniqueNonEmpty(parsedTasks.map(({ sections }) => sections.safety));
  const verify = uniqueNonEmpty(parsedTasks.map(({ sections }) => sections.verify));
  const rollback = uniqueNonEmpty(parsedTasks.map(({ sections }) => sections.rollback));

  const lines = [
    `# ${featureName}`,
    '',
    ...(mode === 'lightweight' ? ['Workflow Path: lightweight', ''] : []),
    '## Discovery',
    '',
    ...renderDiscoveryField('Background', background, 'Summarize why the instant/manual task(s) should move into a reviewed plan.'),
    ...renderDiscoveryField('Impact', impact, 'List the files or behaviors expected to change.'),
    ...renderDiscoveryField('Safety', safety, 'Capture the main risks and invariants to preserve.'),
    ...renderDiscoveryField('Verify', verify, 'Replace this with exact verification commands before approval.'),
    ...renderDiscoveryField('Rollback', rollback, 'Describe how to undo the work safely if needed.'),
    '',
    '## Non-Goals',
    '',
    '- Confirm and record what this fallback plan will NOT change before approval.',
    '',
    '## Ghost Diffs',
    '',
    '- Record alternatives or shortcuts rejected while promoting this instant/manual work into a reviewed plan.',
    '',
    '## Tasks',
    '',
  ];

  tasks.forEach((task, index) => {
    lines.push(...buildTaskSection(task, index));
    if (index < tasks.length - 1) lines.push('');
  });

  return lines.join('\n');
}
