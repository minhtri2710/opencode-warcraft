import type { WorkflowPath } from './workflow-path.js';

export type WorkflowRecommendation = WorkflowPath | 'instant';

export interface WorkflowAnalysisResult {
  workflowPath: WorkflowRecommendation;
  rationale: string[];
}

const INSTANT_SIGNALS = [
  /\btypo\b/i,
  /\bwording\b/i,
  /\bcopy\b/i,
  /\brename\b/i,
  /\btext\b/i,
  /\bmessage\b/i,
  /\bprompt\b/i,
  /\bcomment\b/i,
  /\bdocs?\b/i,
  /\breadme\b/i,
  /\btiny\b/i,
  /\bsmall\b/i,
  /\bquick fix\b/i,
  /\bsingle file\b/i,
  /\bone file\b/i,
];

const STANDARD_SIGNALS = [
  /\barchitecture\b/i,
  /\bcross[ -]?cutting\b/i,
  /\bmigration\b/i,
  /\brefactor\b/i,
  /\bacross packages\b/i,
  /\bmultiple files\b/i,
  /\bmulti-file\b/i,
  /\bnew tool\b/i,
  /\bnew service\b/i,
  /\bnew workflow\b/i,
  /\bplugin and core\b/i,
  /\bapi and ui\b/i,
  /\borchestrat/i,
  /\bplan\b/i,
  /\bbeads\b/i,
];

function countMatches(input: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(input) ? 1 : 0), 0);
}

export function analyzeWorkflowRequest(request: string): WorkflowAnalysisResult {
  const normalized = request.trim();
  if (!normalized) {
    return {
      workflowPath: 'standard',
      rationale: ['No request details were provided, so default to the safer plan-first workflow.'],
    };
  }

  const instantSignals = countMatches(normalized, INSTANT_SIGNALS);
  const standardSignals = countMatches(normalized, STANDARD_SIGNALS);
  const pathMentions = (normalized.match(/[\w-]+\/[\w./-]+/g) || []).length;
  const sentenceCount = normalized.split(/[.!?]\s+/).filter(Boolean).length;

  if (standardSignals >= 2 || pathMentions >= 3 || normalized.length > 220 || sentenceCount >= 4) {
    return {
      workflowPath: 'standard',
      rationale: [
        'The request looks broad or system-level, so a reviewed plan is safer than instant execution.',
        'Use the standard beads-aligned path: discovery, plan, approval, then synced tasks.',
      ],
    };
  }

  if (instantSignals >= 1 && standardSignals === 0 && pathMentions <= 1 && normalized.length <= 140) {
    if (/\band\b/i.test(normalized) || /\bdocs?\b/i.test(normalized) || /\breadme\b/i.test(normalized)) {
      return {
        workflowPath: 'lightweight',
        rationale: [
          'The request is still small, but it touches enough visible surface area that a short reviewed plan is safer than a direct task.',
          'Use Workflow Path: lightweight and keep the task list short and traceable.',
        ],
      };
    }

    return {
      workflowPath: 'instant',
      rationale: [
        'The request looks tiny and self-contained, so a direct manual task can likely replace a formal plan.',
        'Capture Background, Impact, Safety, Verify, and Rollback in the task description before dispatching.',
      ],
    };
  }

  return {
    workflowPath: 'lightweight',
    rationale: [
      'The request is small enough to avoid a full plan, but still benefits from a lightweight reviewed plan.',
      'Use Workflow Path: lightweight and keep the task list short and traceable.',
    ],
  };
}
