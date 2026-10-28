import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStorage, sessionKey } from '../../src/lib/session-storage.js';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
const token = 'a'.repeat(64);
const expiry = 2000000000;

test('browser sessions survive a new tab or browser session and store no password or user profile', () => {
  const persistent = storage();
  const sessions = () => createSessionStorage({ persistent: () => persistent, transient: () => storage(), now: () => (expiry - 60) * 1000 });
  sessions().save({ token, expiresAt: expiry, password: 'never-store-password', user: { email: 'private@example.invalid' } });
  assert.deepEqual(sessions().load(), { token, expiresAt: expiry });
  assert.deepEqual(JSON.parse(persistent.getItem(sessionKey)), { token, expiresAt: expiry });
  assert.doesNotMatch(persistent.getItem(sessionKey), /password|email|private/);
  sessions().clear();
  assert.equal(sessions().load(), null);
});

test('current tab credentials migrate without renewing the server session and do not return after logout', () => {
  const persistent = storage(), transient = storage();
  transient.setItem(sessionKey, token);
  const sessions = createSessionStorage({ persistent: () => persistent, transient: () => transient });
  assert.deepEqual(sessions.load(), { token, expiresAt: null });
  assert.equal(transient.getItem(sessionKey), null);
  assert.ok(persistent.getItem(sessionKey));
  transient.setItem(sessionKey, token);
  persistent.removeItem(sessionKey);
  assert.equal(sessions.load({ migrateLegacy: false }), null);
  sessions.clear();
  assert.equal(sessions.load(), null);
});

test('expired or corrupted saved sessions are removed and never override a valid newer session', () => {
  const persistent = storage(), transient = storage();
  let time = (expiry - 1) * 1000;
  const sessions = createSessionStorage({ persistent: () => persistent, transient: () => transient, now: () => time });
  sessions.save({ token, expiresAt: expiry });
  transient.setItem(sessionKey, 'b'.repeat(64));
  assert.equal(sessions.load().token, token);
  time = expiry * 1000;
  assert.equal(sessions.load(), null);
  assert.equal(persistent.getItem(sessionKey), null);
  assert.equal(transient.getItem(sessionKey), null);
  for (const raw of ['invalid', '{}', JSON.stringify({ token, expiresAt: 'never' })]) {
    persistent.setItem(sessionKey, raw);
    assert.equal(sessions.load(), null);
    assert.equal(persistent.getItem(sessionKey), null);
  }
});

test('storage restrictions retain a tab session when possible and never crash login', () => {
  const transient = storage();
  const sessions = createSessionStorage({ persistent: () => { throw new Error('blocked'); }, transient: () => transient, now: () => 0 });
  sessions.save({ token, expiresAt: expiry });
  assert.deepEqual(sessions.load(), { token, expiresAt: expiry });
  sessions.clear();
  assert.equal(sessions.load(), null);
  const blocked = () => { throw new Error('blocked'); };
  const memoryOnly = createSessionStorage({ persistent: blocked, transient: blocked });
  assert.doesNotThrow(() => memoryOnly.save({ token }));
  assert.doesNotThrow(() => memoryOnly.clear());
});
