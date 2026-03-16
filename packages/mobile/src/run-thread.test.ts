import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunTurnDetail } from './types.ts';
import { appendTurnItem, canContinueRun, latestRunTurn, upsertRunTurn } from './run-thread.ts';

const turnOne: RunTurnDetail = {
  id: 'run-1:turn:1',
  runId: 'run-1',
  index: 1,
  prompt: 'Inspect the repo',
  attachments: [],
  status: 'success',
  createdAt: 1,
  updatedAt: 2,
  hasDiff: false,
  items: [],
};

test('upsertRunTurn preserves existing items and keeps turn order', () => {
  const turns = upsertRunTurn(
    [{ ...turnOne, items: [{ id: 1, createdAt: 3, type: 'activity', status: 'info', label: 'Done' }] }],
    {
      ...turnOne,
      status: 'interrupted',
      updatedAt: 4,
    },
  );

  assert.equal(turns[0]?.status, 'interrupted');
  assert.equal(turns[0]?.items.length, 1);
});

test('appendTurnItem appends to the matching turn only', () => {
  const turns = appendTurnItem(
    [turnOne],
    turnOne.id,
    { id: 2, createdAt: 4, type: 'message', role: 'assistant', text: 'Done' },
  );

  assert.equal(turns[0]?.items.length, 1);
  assert.equal(turns[0]?.items[0]?.type, 'message');
});

test('canContinueRun only allows terminal turns', () => {
  assert.equal(canContinueRun({ ...turnOne, status: 'running' }), false);
  assert.equal(canContinueRun({ ...turnOne, status: 'success' }), true);
  assert.equal(canContinueRun(null), false);
  assert.equal(latestRunTurn([turnOne])?.id, turnOne.id);
});
