import { describe, expect, it } from 'bun:test';
import {
  decodeListItems,
  decodeDependentIssues,
  decodeTasksFromDepList,
  decodeShowPayload,
  extractBeadContent,
} from './beadDecoders.js';

describe('beadDecoders robustness', () => {
  it('decodeListItems handles items with numeric id', () => {
    const output = JSON.stringify([{ id: 42, title: 'Numeric', status: 'open' }]);
    const items = decodeListItems(output, 'test');
    expect(items[0].id).toBe('42');
  });

  it('decodeListItems handles items with null title', () => {
    const output = JSON.stringify([{ id: 'bd-1', title: null, status: 'open' }]);
    const items = decodeListItems(output, 'test');
    expect(items[0].title).toBe('');
  });

  it('decodeDependentIssues empty array returns empty', () => {
    expect(decodeDependentIssues('[]', 'test')).toEqual([]);
  });

  it('decodeDependentIssues envelope with empty deps', () => {
    expect(decodeDependentIssues('{"dependencies":[]}', 'test')).toEqual([]);
  });

  it('decodeTasksFromDepList empty returns empty', () => {
    expect(decodeTasksFromDepList('[]', 'epic-1')).toEqual([]);
  });

  it('decodeShowPayload returns primitive types', () => {
    expect(decodeShowPayload('"hello"', 'bd-1')).toBe('hello');
    expect(decodeShowPayload('42', 'bd-1')).toBe(42);
    expect(decodeShowPayload('true', 'bd-1')).toBe(true);
    expect(decodeShowPayload('null', 'bd-1')).toBeNull();
  });

  it('extractBeadContent extracts body field', () => {
    expect(extractBeadContent({ body: 'Body text' })).toBe('Body text');
  });

  it('extractBeadContent returns null for empty array', () => {
    expect(extractBeadContent([])).toBeNull();
  });

  it('extractBeadContent returns null for whitespace-only description', () => {
    expect(extractBeadContent({ description: '   ' })).toBeNull();
  });

  it('extractBeadContent handles nested item key', () => {
    expect(extractBeadContent({ item: { description: 'Found' } })).toBe('Found');
  });

  it('extractBeadContent handles nested items array', () => {
    expect(extractBeadContent({ items: [{ content: 'In array' }] })).toBe('In array');
  });
});
