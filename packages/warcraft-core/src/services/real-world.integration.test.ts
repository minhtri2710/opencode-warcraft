import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, getWarcraftPath } from '../utils/paths.js';
import { ConfigService } from './configService.js';
import { ContextService } from './contextService.js';
import { FeatureService } from './featureService.js';
import { PlanService } from './planService.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';
import { FilesystemPlanStore } from './state/fs-plan-store.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('Full service integration: real-world scenario', () => {
  let tempDir: string;
  let featureService: FeatureService;
  let planService: PlanService;
  let taskService: TaskService;
  let contextService: ContextService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-world-'));
    const featureStore = new FilesystemFeatureStore(tempDir);
    const planStore = new FilesystemPlanStore(tempDir);
    const taskStore = new FilesystemTaskStore(tempDir);
    const provider = { getBeadsMode: () => 'off' as const };
    featureService = new FeatureService(tempDir, featureStore, 'off', taskStore);
    planService = new PlanService(tempDir, planStore, 'off');
    taskService = new TaskService(tempDir, taskStore, 'off', createNoopLogger());
    contextService = new ContextService(tempDir, provider);
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(feat: string, content: string) {
    const planPath = getPlanPath(tempDir, feat, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('microservice API: full lifecycle with context and iterations', () => {
    // 1. Create feature
    featureService.create('add-payment-api');

    // 2. Write discovery context
    contextService.write('add-payment-api', 'decisions', '# Decisions\n- Use Stripe SDK\n- REST over GraphQL');
    contextService.write('add-payment-api', 'architecture', '# Architecture\n- Controller → Service → Stripe');

    // 3. Write plan
    writePlan(
      'add-payment-api',
      `# Plan

## Discovery

### Findings
- Stripe API available
- Need webhook handling

### Risks
- Rate limits on sandbox

### 1. Setup Stripe SDK
Depends on: none
Install and configure the Stripe SDK

### 2. Payment Intent API
Depends on: 1
Create /payments/intent endpoint

### 3. Webhook Handler
Depends on: 1
Handle Stripe webhook events

### 4. Integration Tests
Depends on: 2, 3
End-to-end payment flow tests
`,
    );

    // 4. Approve plan
    planService.approve('add-payment-api');

    // 5. Sync tasks
    const sync = taskService.sync('add-payment-api');
    expect(sync.created.length).toBe(4);

    // 6. Verify dependency structure
    const runnable = taskService.getRunnableTasks('add-payment-api');
    expect(runnable.runnable.length).toBe(1); // Only Setup
    expect(runnable.blocked.length).toBe(3); // Payment, Webhook, Tests

    // 7. Execute tasks in order
    const tasks = taskService.list('add-payment-api');

    // Complete Setup
    taskService.update('add-payment-api', tasks[0].folder, { status: 'in_progress' });
    taskService.update('add-payment-api', tasks[0].folder, {
      status: 'done',
      summary: 'Stripe SDK configured with API keys',
    });

    // Now Payment and Webhook should be runnable
    const after1 = taskService.getRunnableTasks('add-payment-api');
    expect(after1.runnable.length).toBe(2); // Payment + Webhook
    expect(after1.completed.length).toBe(1);

    // Complete Payment and Webhook in parallel
    taskService.update('add-payment-api', tasks[1].folder, { status: 'in_progress' });
    taskService.update('add-payment-api', tasks[2].folder, { status: 'in_progress' });
    taskService.update('add-payment-api', tasks[1].folder, { status: 'done', summary: 'Payment intent API ready' });
    taskService.update('add-payment-api', tasks[2].folder, { status: 'done', summary: 'Webhook handler ready' });

    // Now Tests should be runnable
    const after3 = taskService.getRunnableTasks('add-payment-api');
    expect(after3.runnable.length).toBe(1); // Tests
    expect(after3.completed.length).toBe(3);

    // Complete Tests
    taskService.update('add-payment-api', tasks[3].folder, { status: 'in_progress' });
    taskService.update('add-payment-api', tasks[3].folder, { status: 'done', summary: 'All tests passing' });

    // 8. Sync completion
    const synced = featureService.syncCompletionFromTasks('add-payment-api');
    expect(synced!.status).toBe('completed');

    // 9. Verify context survived
    expect(contextService.read('add-payment-api', 'decisions')).toContain('Stripe');
    expect(contextService.read('add-payment-api', 'architecture')).toContain('Controller');
  });
});
