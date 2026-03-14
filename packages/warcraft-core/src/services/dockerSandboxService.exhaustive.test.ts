import { describe, expect, it } from 'bun:test';
import { DockerSandboxService } from './dockerSandboxService.js';

describe('DockerSandboxService exhaustive', () => {
  const VALID_IMAGES = [
    'ubuntu:latest',
    'node:20',
    'alpine',
    'python:3.12',
    'golang:1.22',
    'rust:latest',
    'ruby:3.3',
    'docker.io/library/ubuntu:22.04',
  ];

  describe('validateImage accepts valid images', () => {
    for (const image of VALID_IMAGES) {
      it(`"${image}" is valid`, () => {
        expect(() => DockerSandboxService.validateImage(image)).not.toThrow();
      });
    }
  });

  describe('buildRunCommand for each image', () => {
    for (const image of VALID_IMAGES) {
      it(`builds command for "${image}"`, () => {
        const result = DockerSandboxService.buildRunCommand('/workspace', 'echo hello', image);
        expect(result.command).toBe('docker');
        expect(result.args.join(' ')).toContain(image);
      });
    }
  });
});
