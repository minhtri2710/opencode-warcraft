import * as fs from 'fs';
import * as path from 'path';
import type { BeadsModeProvider, ContextFile } from '../types.js';
import { ensureDir, fileExists, readText, writeText } from '../utils/fs.js';
import { getContextPath, sanitizeName } from '../utils/paths.js';
import { appendContextContent, renderContextSections } from './context-markdown.js';
export type { ContextFile };

export class ContextService {
  private static readonly WARNING_THRESHOLD_CHARS = 20_000;

  constructor(
    private readonly projectRoot: string,
    private readonly beadsModeProvider: BeadsModeProvider,
  ) {}

  write(featureName: string, fileName: string, content: string, mode: 'replace' | 'append' = 'replace'): string {
    const contextPath = getContextPath(this.projectRoot, featureName, this.beadsModeProvider.getBeadsMode());
    ensureDir(contextPath);

    const filePath = path.join(contextPath, this.normalizeFileName(fileName));
    const nextContent = mode === 'append' ? appendContextContent(readText(filePath), content) : content;
    writeText(filePath, nextContent);

    const totalChars = this.list(featureName).reduce((sum, c) => sum + c.content.length, 0);
    if (totalChars > ContextService.WARNING_THRESHOLD_CHARS) {
      return `${filePath}\n\n⚠️ Context total: ${totalChars} chars (exceeds ${ContextService.WARNING_THRESHOLD_CHARS.toLocaleString()} char budget). Consider moving older notes into a smaller context file or deleting stale context files before writing more.`;
    }

    return filePath;
  }

  read(featureName: string, fileName: string): string | null {
    const contextPath = getContextPath(this.projectRoot, featureName, this.beadsModeProvider.getBeadsMode());
    const filePath = path.join(contextPath, this.normalizeFileName(fileName));
    return readText(filePath);
  }

  list(featureName: string): ContextFile[] {
    const contextPath = getContextPath(this.projectRoot, featureName, this.beadsModeProvider.getBeadsMode());
    if (!fileExists(contextPath)) return [];

    const files = fs
      .readdirSync(contextPath, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.md'))
      .map((f) => f.name);

    return files.map((name) => {
      const filePath = path.join(contextPath, name);
      const stat = fs.statSync(filePath);
      const content = readText(filePath) || '';
      return {
        name: name.replace(/\.md$/, ''),
        content,
        updatedAt: stat.mtime.toISOString(),
      };
    });
  }

  delete(featureName: string, fileName: string): boolean {
    const contextPath = getContextPath(this.projectRoot, featureName, this.beadsModeProvider.getBeadsMode());
    const filePath = path.join(contextPath, this.normalizeFileName(fileName));

    if (fileExists(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  compile(featureName: string): string {
    const files = this.list(featureName);
    if (files.length === 0) return '';

    return renderContextSections(files);
  }

  archive(featureName: string): { archived: string[]; archivePath: string } {
    const contexts = this.list(featureName);
    if (contexts.length === 0) return { archived: [], archivePath: '' };

    const contextPath = getContextPath(this.projectRoot, featureName, this.beadsModeProvider.getBeadsMode());
    const archiveDir = path.join(path.dirname(contextPath), 'archive');
    ensureDir(archiveDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archived: string[] = [];

    for (const ctx of contexts) {
      const archiveName = `${timestamp}_${ctx.name}.md`;
      const src = path.join(contextPath, `${ctx.name}.md`);
      const dest = path.join(archiveDir, archiveName);
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      archived.push(ctx.name);
    }

    return { archived, archivePath: archiveDir };
  }

  stats(featureName: string): { count: number; totalChars: number; oldest?: string; newest?: string } {
    const contexts = this.list(featureName);
    if (contexts.length === 0) return { count: 0, totalChars: 0 };

    const sorted = [...contexts].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

    return {
      count: contexts.length,
      totalChars: contexts.reduce((sum, c) => sum + c.content.length, 0),
      oldest: sorted[0].name,
      newest: sorted[sorted.length - 1].name,
    };
  }

  private normalizeFileName(name: string): string {
    const normalized = name.replace(/\.md$/, '');
    const sanitized = sanitizeName(normalized);
    return `${sanitized}.md`;
  }
}
