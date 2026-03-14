import { describe, expect, it } from 'bun:test';
import { analyzeWorkflowRequest } from './workflow-analysis.js';

describe('analyzeWorkflowRequest', () => {
  it('defaults to standard when request text is empty', () => {
    expect(analyzeWorkflowRequest('').workflowPath).toBe('standard');
  });

  it('classifies tiny wording fixes as instant', () => {
    const result = analyzeWorkflowRequest('Fix the wording in the feature-create prompt message.');
    expect(result.workflowPath).toBe('instant');
    expect(result.rationale.join(' ')).toContain('direct manual task');
  });

  it('classifies broader but still small work as lightweight', () => {
    const result = analyzeWorkflowRequest('Add a small status section to the README and docs so users can see the instant workflow path.');
    expect(result.workflowPath).toBe('lightweight');
  });

  it('classifies cross-cutting system work as standard', () => {
    const result = analyzeWorkflowRequest(
      'Design a new workflow across packages, add a new tool, update beads integration, and refactor orchestration prompts.',
    );
    expect(result.workflowPath).toBe('standard');
  });
});
