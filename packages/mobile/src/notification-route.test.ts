import test from 'node:test';
import assert from 'node:assert/strict';

import { parseThreadNotificationTarget } from './notification-route.ts';

test('parseThreadNotificationTarget returns thread params for valid notification data', () => {
  assert.deepEqual(
    parseThreadNotificationTarget({
      agentId: 'agent-1',
      runId: 'run-1',
    }),
    {
      agentId: 'agent-1',
      runId: 'run-1',
    },
  );
});

test('parseThreadNotificationTarget returns null for malformed notification data', () => {
  assert.equal(parseThreadNotificationTarget(null), null);
  assert.equal(parseThreadNotificationTarget({}), null);
  assert.equal(parseThreadNotificationTarget({ agentId: 'agent-1' }), null);
  assert.equal(parseThreadNotificationTarget({ runId: 'run-1' }), null);
});
