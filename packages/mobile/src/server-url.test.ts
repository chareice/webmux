import { normalizeServerUrl } from './server-url';

function expectEqual(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected "${expected}", got "${actual}"`);
  }
}

expectEqual(normalizeServerUrl(''), '');
expectEqual(
  normalizeServerUrl('webmux.nas.chareice.site/'),
  'https://webmux.nas.chareice.site',
);
expectEqual(
  normalizeServerUrl(' https://webmux.nas.chareice.site/// '),
  'https://webmux.nas.chareice.site',
);
expectEqual(
  normalizeServerUrl('http://localhost:8787/'),
  'http://localhost:8787',
);
