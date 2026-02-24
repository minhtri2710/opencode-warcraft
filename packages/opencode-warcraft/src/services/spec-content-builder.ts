import type { SpecData } from 'warcraft-core';

interface TaskInfo {
  folder: string;
  name: string;
  order: number;
}

interface ContextFile {
  name: string;
  content: string;
}

interface CompletedTask {
  name: string;
  summary: string;
}

/**
 * Format SpecData into markdown content for worker specs.
 * This is the plugin-side formatter that takes structured data from core
 * and produces the final markdown output.
 *
 * @param data - The structured spec data from TaskService.buildSpecData()
 * @returns Markdown formatted spec content
 */
export function formatSpecContent(data: SpecData): string {
  const { featureName, task, dependsOn, allTasks, planSection, contextFiles, completedTasks } = data;

  const taskType = inferTaskType(planSection, task.name);

  const specLines: string[] = [
    `# Task: ${task.folder}`,
    '',
    `## Feature: ${featureName}`,
    '',
    '## Dependencies',
    '',
  ];

  if (dependsOn.length > 0) {
    for (const dep of dependsOn) {
      const depTask = allTasks.find((t: TaskInfo) => t.folder === dep);
      if (depTask) {
        specLines.push(`- **${depTask.order}. ${depTask.name}** (${dep})`);
      } else {
        specLines.push(`- ${dep}`);
      }
    }
  } else {
    specLines.push('_None_');
  }

  specLines.push('', '## Plan Section', '');

  if (planSection) {
    specLines.push(planSection.trim());
  } else {
    specLines.push('_No plan section available._');
  }

  specLines.push('');

  if (taskType) {
    specLines.push('## Task Type', '', taskType, '');
  }

  if (contextFiles.length > 0) {
    const contextCompiled = contextFiles
      .map((f: ContextFile) => `## ${f.name}\n\n${f.content}`)
      .join('\n\n---\n\n');
    specLines.push('## Context', '', contextCompiled, '');
  }

  if (completedTasks.length > 0) {
    const completedLines = completedTasks.map((t: CompletedTask) => `- ${t.name}: ${t.summary}`);
    specLines.push('## Completed Tasks', '', ...completedLines, '');
  }

  return specLines.join('\n');
}

/**
 * Infer the task type from the plan section content and task name.
 *
 * @param planSection - The extracted plan section content (or null)
 * @param taskName - The name of the task
 * @returns The inferred task type or null if cannot be inferred
 */
function inferTaskType(planSection: string | null, taskName: string): string | null {
  if (!planSection) {
    return taskName.toLowerCase().includes('test') ? 'testing' : null;
  }

  const fileTypeMatches = Array.from(planSection.matchAll(/-\s*(Create|Modify|Test):/gi)).map(
    match => match[1].toLowerCase()
  );
  const fileTypes = new Set(fileTypeMatches);

  if (fileTypes.size === 0) {
    return taskName.toLowerCase().includes('test') ? 'testing' : null;
  }

  if (fileTypes.size === 1) {
    const onlyType = Array.from(fileTypes)[0];
    if (onlyType === 'create') return 'greenfield';
    if (onlyType === 'test') return 'testing';
  }

  if (fileTypes.has('modify')) {
    return 'modification';
  }

  return null;
}
