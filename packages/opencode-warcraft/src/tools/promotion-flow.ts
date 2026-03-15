export type PromotionFlowStep =
  | {
      type: 'tool';
      tool: 'warcraft_task_expand' | 'warcraft_plan_approve' | 'warcraft_tasks_sync';
      args: unknown;
      purpose: string;
    }
  | {
      type: 'review';
      message: string;
    };

export interface TaskExpandArgs {
  feature: string;
  tasks: string[];
  mode: 'lightweight' | 'standard';
}

export interface PlanApproveArgs {
  feature: string;
}

export interface TaskSyncArgs {
  feature: string;
  mode: 'sync';
}

export function buildPendingManualPromotionFlow(
  taskExpandArgs: TaskExpandArgs,
  planApproveArgs: PlanApproveArgs,
  taskSyncArgs: TaskSyncArgs,
): PromotionFlowStep[] {
  return [
    {
      type: 'tool',
      tool: 'warcraft_task_expand',
      args: taskExpandArgs,
      purpose: 'Promote the pending manual tasks into a reviewed draft plan.',
    },
    {
      type: 'review',
      message: 'Review or refine the drafted plan before approval so the reviewed path stays intentional.',
    },
    {
      type: 'tool',
      tool: 'warcraft_plan_approve',
      args: planApproveArgs,
      purpose: 'Approve the reviewed plan once it is ready to execute.',
    },
    {
      type: 'tool',
      tool: 'warcraft_tasks_sync',
      args: taskSyncArgs,
      purpose: 'Generate or reconcile canonical tasks from the approved plan.',
    },
  ];
}

export function buildDraftPlanPromotionFlow(
  planApproveArgs: PlanApproveArgs,
  taskSyncArgs: TaskSyncArgs,
): PromotionFlowStep[] {
  return [
    {
      type: 'review',
      message: 'Review or refine the drafted plan before approval so the reviewed path stays intentional.',
    },
    {
      type: 'tool',
      tool: 'warcraft_plan_approve',
      args: planApproveArgs,
      purpose: 'Approve the reviewed plan once it is ready to execute.',
    },
    {
      type: 'tool',
      tool: 'warcraft_tasks_sync',
      args: taskSyncArgs,
      purpose: 'Generate or reconcile canonical tasks from the approved plan.',
    },
  ];
}

export function buildApprovedPlanSyncFlow(taskSyncArgs: TaskSyncArgs): PromotionFlowStep[] {
  return [
    {
      type: 'tool',
      tool: 'warcraft_tasks_sync',
      args: taskSyncArgs,
      purpose: 'Generate or reconcile canonical tasks from the approved plan.',
    },
  ];
}

export function buildChecklistApprovalRecoveryFlow(planApproveArgs: PlanApproveArgs): PromotionFlowStep[] {
  return [
    {
      type: 'review',
      message: 'Finish the required `## Plan Review Checklist` confirmations before attempting approval again.',
    },
    {
      type: 'tool',
      tool: 'warcraft_plan_approve',
      args: planApproveArgs,
      purpose: 'Retry approval once the reviewed checklist is complete.',
    },
  ];
}
