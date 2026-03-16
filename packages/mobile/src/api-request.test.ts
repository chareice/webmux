import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApiHeaders } from './api-request.ts';

test('buildApiHeaders does not set JSON content type for empty requests', () => {
  const headers = buildApiHeaders({
    method: 'DELETE',
  }, 'token-1');

  assert.deepEqual(headers, {
    Authorization: 'Bearer token-1',
  });
});

test('buildApiHeaders keeps JSON content type when a body is present', () => {
  const headers = buildApiHeaders({
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  }, 'token-1');

  assert.deepEqual(headers, {
    Authorization: 'Bearer token-1',
    'Content-Type': 'application/json',
  });
});

test('buildApiHeaders preserves explicit content type headers', () => {
  const headers = buildApiHeaders({
    body: JSON.stringify({ ok: true }),
    headers: {
      'Content-Type': 'text/plain',
    },
  });

  assert.deepEqual(headers, {
    'Content-Type': 'text/plain',
  });
});
