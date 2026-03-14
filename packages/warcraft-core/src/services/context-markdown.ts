const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/;
const TRAILING_BLANK_LINES = /(?:\r?\n[ \t]*)+$/;

function normalizeHeadingValue(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function trimBoundaryBlankLines(value: string): string {
  return value.replace(LEADING_BLANK_LINES, '').replace(TRAILING_BLANK_LINES, '');
}

function stripRedundantLeadingHeading(sectionName: string, content: string): string {
  const withoutBom = content.replace(/^\uFEFF/, '');
  const withoutLeadingBlankLines = withoutBom.replace(LEADING_BLANK_LINES, '');
  const headingMatch = withoutLeadingBlankLines.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);

  if (!headingMatch) {
    return withoutBom;
  }

  if (normalizeHeadingValue(headingMatch[2]) !== normalizeHeadingValue(sectionName)) {
    return withoutBom;
  }

  return withoutLeadingBlankLines.slice(headingMatch[0].length).replace(LEADING_BLANK_LINES, '');
}

export function appendContextContent(existingContent: string | null | undefined, incomingContent: string): string {
  const normalizedIncoming = trimBoundaryBlankLines(incomingContent);
  if (!existingContent) {
    return normalizedIncoming;
  }

  const normalizedExisting = trimBoundaryBlankLines(existingContent);
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

export function renderContextSection(sectionName: string, content: string): string {
  const renderedBody = stripRedundantLeadingHeading(sectionName, content);
  if (renderedBody.length === 0) {
    return `## ${sectionName}`;
  }

  return `## ${sectionName}\n\n${renderedBody}`;
}

export function renderContextSections(sections: Array<{ name: string; content: string }>): string {
  return sections.map((section) => renderContextSection(section.name, section.content)).join('\n\n---\n\n');
}
