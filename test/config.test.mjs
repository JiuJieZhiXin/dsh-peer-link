import assert from 'node:assert/strict';
import test from 'node:test';
import { Config } from '../index.js';

test('plugin Config exposes the optional transport settings with safe defaults', () => {
  const defaults = Config({});
  assert.deepEqual(defaults.transports, ['local']);
  assert.equal(defaults.relayUrl, '');
  assert.equal(defaults.relayToken, '');
  assert.equal(defaults.requireSameAccount, true);
  assert.equal(defaults.autoReply, false);
  assert.equal(defaults.maxMessages, 300);

  const selected = Config({
    transports: ['local', 'relay'],
    relayUrl: 'wss://relay.example/peer',
    relayToken: 'token',
    sharedSecret: 'secret',
  });
  assert.deepEqual(selected.transports, ['local', 'relay']);
  assert.equal(selected.relayUrl, 'wss://relay.example/peer');
  assert.equal(selected.relayToken, 'token');
  assert.equal(selected.sharedSecret, 'secret');
});
