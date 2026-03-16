import test from 'node:test';
import assert from 'node:assert/strict';

import type { Run } from './types.ts';
import { normalizeRunDetailResponse } from './run-detail-response.ts';

const run: Run = {
  id: 'run-1',
  agentId: 'agent-1',
  tool: 'codex',
  repoPath: '/tmp/project',
  branch: 'main',
  prompt: 'Fix it',
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
  hasDiff: false,
  unread: false,
};

test('normalizeRunDetailResponse falls back to an empty items array', () => {
  const normalized = normalizeRunDetailResponse({
    run,
  });

  assert.deepEqual(normalized, {
    run,
    turns: [],
  });
});

test('normalizeRunDetailResponse keeps turns and timeline items when present', () => {
  const normalized = normalizeRunDetailResponse({
    run,
    turns: [
      {
        id: 'run-1:turn:1',
        runId: 'run-1',
        index: 1,
        prompt: 'Fix it',
        status: 'success',
        createdAt: 10,
        updatedAt: 11,
        hasDiff: false,
        items: [
          {
            id: 1,
            createdAt: 10,
            type: 'message',
            role: 'assistant',
            text: 'Done',
          },
        ],
      },
    ],
  });

  assert.deepEqual(normalized.turns, [
    {
      id: 'run-1:turn:1',
      runId: 'run-1',
      index: 1,
      prompt: 'Fix it',
      status: 'success',
      createdAt: 10,
      updatedAt: 11,
      hasDiff: false,
      items: [
        {
          id: 1,
          createdAt: 10,
          type: 'message',
          role: 'assistant',
          text: 'Done',
        },
      ],
    },
  ]);
});
