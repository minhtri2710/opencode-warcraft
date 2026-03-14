import { describe, expect, it } from 'bun:test';
import * as warcraftCore from './index.js';

describe('index comprehensive export validation', () => {
  // Utilities
  it('exports readText', () => expect(typeof warcraftCore.readText).toBe('function'));
  it('exports writeText', () => expect(typeof warcraftCore.writeText).toBe('function'));
  it('exports readJson', () => expect(typeof warcraftCore.readJson).toBe('function'));
  it('exports writeJson', () => expect(typeof warcraftCore.writeJson).toBe('function'));
  it('exports fileExists', () => expect(typeof warcraftCore.fileExists).toBe('function'));
  it('exports ensureDir', () => expect(typeof warcraftCore.ensureDir).toBe('function'));

  // Paths
  it('exports getWarcraftPath', () => expect(typeof warcraftCore.getWarcraftPath).toBe('function'));
  it('exports getWarcraftDir', () => expect(typeof warcraftCore.getWarcraftDir).toBe('function'));
  it('exports getFeaturePath', () => expect(typeof warcraftCore.getFeaturePath).toBe('function'));
  it('exports getPlanPath', () => expect(typeof warcraftCore.getPlanPath).toBe('function'));
  it('exports getTasksPath', () => expect(typeof warcraftCore.getTasksPath).toBe('function'));
  it('exports getTaskPath', () => expect(typeof warcraftCore.getTaskPath).toBe('function'));
  it('exports getTaskStatusPath', () => expect(typeof warcraftCore.getTaskStatusPath).toBe('function'));
  it('exports getTaskReportPath', () => expect(typeof warcraftCore.getTaskReportPath).toBe('function'));
  it('exports getContextPath', () => expect(typeof warcraftCore.getContextPath).toBe('function'));
  it('exports sanitizeName', () => expect(typeof warcraftCore.sanitizeName).toBe('function'));

  // Slug
  it('exports slugifyTaskName', () => expect(typeof warcraftCore.slugifyTaskName).toBe('function'));
  it('exports slugifyIdentifierSegment', () => expect(typeof warcraftCore.slugifyIdentifierSegment).toBe('function'));
  it('exports deriveDeterministicLocalId', () =>
    expect(typeof warcraftCore.deriveDeterministicLocalId).toBe('function'));
  it('exports deriveTaskFolder', () => expect(typeof warcraftCore.deriveTaskFolder).toBe('function'));

  // Shell
  it('exports shellQuoteArg', () => expect(typeof warcraftCore.shellQuoteArg).toBe('function'));
  it('exports structuredToCommandString', () => expect(typeof warcraftCore.structuredToCommandString).toBe('function'));

  // Logger
  it('exports createNoopLogger', () => expect(typeof warcraftCore.createNoopLogger).toBe('function'));
  it('exports createConsoleLogger', () => expect(typeof warcraftCore.createConsoleLogger).toBe('function'));
  it('exports LOG_LEVELS', () => expect(warcraftCore.LOG_LEVELS).toBeDefined());

  // Detection
  it('exports detectContext', () => expect(typeof warcraftCore.detectContext).toBe('function'));
  it('exports findProjectRoot', () => expect(typeof warcraftCore.findProjectRoot).toBe('function'));

  // Defaults
  it('exports DEFAULT_AGENT_MODELS', () => expect(warcraftCore.DEFAULT_AGENT_MODELS).toBeDefined());
  it('exports DEFAULT_WARCRAFT_CONFIG', () => expect(warcraftCore.DEFAULT_WARCRAFT_CONFIG).toBeDefined());

  // Outcomes
  it('exports ok', () => expect(typeof warcraftCore.ok).toBe('function'));
  it('exports okVoid', () => expect(typeof warcraftCore.okVoid).toBe('function'));
  it('exports degraded', () => expect(typeof warcraftCore.degraded).toBe('function'));
  it('exports fatal', () => expect(typeof warcraftCore.fatal).toBe('function'));
  it('exports diagnostic', () => expect(typeof warcraftCore.diagnostic).toBe('function'));
  it('exports isUsable', () => expect(typeof warcraftCore.isUsable).toBe('function'));
  it('exports worstSeverity', () => expect(typeof warcraftCore.worstSeverity).toBe('function'));
  it('exports withDiagnostics', () => expect(typeof warcraftCore.withDiagnostics).toBe('function'));
  it('exports fromError', () => expect(typeof warcraftCore.fromError).toBe('function'));
  it('exports collectOutcomes', () => expect(typeof warcraftCore.collectOutcomes).toBe('function'));

  // Task state machine
  it('exports isTransitionAllowed', () => expect(typeof warcraftCore.isTransitionAllowed).toBe('function'));
  it('exports validateTransition', () => expect(typeof warcraftCore.validateTransition).toBe('function'));

  // Trace context
  it('exports createTraceContext', () => expect(typeof warcraftCore.createTraceContext).toBe('function'));
  it('exports createChildSpan', () => expect(typeof warcraftCore.createChildSpan).toBe('function'));

  // Task dependency graph
  it('exports computeRunnableAndBlocked', () => expect(typeof warcraftCore.computeRunnableAndBlocked).toBe('function'));

  // Format
  it('exports formatSpecContent', () => expect(typeof warcraftCore.formatSpecContent).toBe('function'));
});
