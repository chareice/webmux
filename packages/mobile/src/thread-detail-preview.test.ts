import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePreviewText,
  shouldForcePreviewText,
} from './thread-detail-preview.ts';

test('shouldForcePreviewText collapses long claude-style completion messages', () => {
  const content = `
Tool finished: Agent

Perfect! Now I have a comprehensive understanding of the project. Let me compile the findings into a summary report.

## Comprehensive Project Summary: z1

**z1** is an AI-powered code generation platform with live preview capabilities, similar to Vercel's v0. Users describe what they want to build, and AI generates code in real-time with a sandboxed live preview environment. The project uses a monorepo structure and includes shared UI packages, a web frontend, and backend services.
`.trim();

  assert.equal(
    shouldForcePreviewText(content, {
      charLimit: 260,
      lineLimit: 6,
    }),
    true,
  );
});

test('shouldForcePreviewText keeps short messages expanded', () => {
  assert.equal(
    shouldForcePreviewText('Done. Updated the button color.', {
      charLimit: 260,
      lineLimit: 6,
    }),
    false,
  );
});

test('normalizePreviewText trims outer whitespace and normalizes line endings', () => {
  assert.equal(
    normalizePreviewText('\r\n  Hello\r\nWorld  \r\n'),
    'Hello\nWorld',
  );
});
