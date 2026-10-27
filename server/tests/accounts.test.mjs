import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AccountError, createAccountStore, digest } from '../accounts.mjs';
import { sqliteD1Adapter } from '../sqlite-adapter.mjs';
import { createD1KnowledgeBase } from '../../workers/knowledge.mjs';
import { createWorkerHandler } from '../../workers/index.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { createAppHandler } from '../index.mjs';
import { facetFixtures } from './fixtures/facet-movies.mjs';

const password = 'Lightmoon-Testing!2026';
const origin = 'https://shhsh993838383-hub.github.io';
const movieId = facetFixtures[0].id;
async function setup(t, options) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON;');
  for (const file of ['0001_movies.sql', '0002_accounts_community.sql']) sql.exec(readFileSync('workers/migrations/' + file, 'utf8'));
  t.after(() => sql.close());
  const db = sqliteD1Adapter(sql), knowledge = createD1KnowledgeBase(db), store = createAccountStore(db, options);
  await knowledge.upsertImported(facetFixtures);
  const handler = createWorkerHandler({ knowledge, accounts: store, allowedOrigins: [origin] });
  const request = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
    const response = await handler(new Request('https://lightmoon.example' + path, { method, headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.40', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    return { response, status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const register = async (email = 'viewer@example.invalid') => {
    const result = await request('/api/auth/register', { method: 'POST', body: { email, password, displayName: '测试影迷' } });
    assert.equal(result.status, 201); return result.data;
  };
  return { sql, store, knowledge, request, register };
}

test('email registration normalizes identity and stores salted password hashes and opaque session digests', async t => {
  const { sql, store, register, request } = await setup(t);
  const first = await register(' Viewer@Example.Invalid '), second = await register('other@example.invalid');
  assert.equal(first.user.email, 'viewer@example.invalid');
  assert.deepEqual(Object.keys(first.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
  const [a, b] = sql.prepare('SELECT * FROM users ORDER BY rowid').all();
  assert.notEqual(a.password_hash, password); assert.notEqual(a.password_hash, b.password_hash); assert.notEqual(a.password_salt, b.password_salt);
  assert.equal(a.password_iterations, 100000);
  assert.equal(sql.prepare('SELECT token_hash FROM user_sessions WHERE user_id=?').get(first.user.id).token_hash, await digest(first.token));
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM user_sessions').all()).includes(first.token));
  assert.equal((await store.authenticate('Bearer ' + first.token)).id, first.user.id);
  assert.equal((await store.authenticate('Bearer ' + second.token)).id, second.user.id);
  const duplicate = await request('/api/auth/register', { method: 'POST', body: { email: 'VIEWER@example.invalid', password } });
  assert.equal(duplicate.status, 409);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'VIEWER@example.invalid', password } })).status, 200);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'viewer@example.invalid', password: 'wrong-password' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'missing@example.invalid', password: 'wrong-password' } })).data.code, 'invalid_credentials');
});

test('registration rejects malformed emails, short passwords, oversized input and invalid nicknames', async t => {
  const { store, request } = await setup(t);
  for (const email of ['hello', 'a@@example.com', 'a..b@example.com', '.a@example.com', 'a.@example.com', 'a@-example.com']) await assert.rejects(store.register({ email, password }), error => error instanceof AccountError && error.status === 400);
  for (const value of ['12345', 'a'.repeat(129), null]) await assert.rejects(store.register({ email: 'a@example.invalid', password: value }), /6 至 128/);
  await assert.rejects(store.register({ email: 'a@example.invalid', password, displayName: '<bad>' }), /昵称/);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: [] })).status, 400);
  const shortPassword = await store.register({ email: 'six@example.invalid', password: 'aB3dE6' });
  assert.equal((await store.login({ email: 'six@example.invalid', password: 'aB3dE6' })).user.id, shortPassword.user.id);
});

test('guests may read community data but cannot rate, comment, save, mark watched or impersonate a user', async t => {
  const { request, register } = await setup(t);
  const user = await register();
  assert.equal((await request(`/api/movies/${movieId}/community`)).status, 200);
  for (const [path, method, body] of [
    [`/api/movies/${movieId}/rating`, 'PUT', { score: 10, userId: user.user.id }],
    [`/api/movies/${movieId}/rating`, 'DELETE'],
    [`/api/movies/${movieId}/comments`, 'POST', { content: '测试评论', userId: user.user.id }],
    [`/api/account/library/${movieId}`, 'PUT', { saved: true, watched: true }],
    ['/api/account/library', 'GET'],
  ]) {
    const result = await request(path, { method, body });
    assert.equal(result.status, 401); assert.equal(result.data.code, 'login_required');
  }
  assert.equal((await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: 'f'.repeat(64), body: { score: 10 } })).status, 401);
  assert.equal((await request('/api/auth/me?token=' + user.token)).status, 401);
});

test('one vote per account updates averages, withdraws cleanly and appears immediately in catalog data', async t => {
  const { request, register, knowledge, sql } = await setup(t);
  const a = await register(), b = await register('second@example.invalid');
  const rate = (token, score) => request(`/api/movies/${movieId}/rating`, { method: 'PUT', token, body: { score } });
  for (const score of [0, 11, 7.5, '8', null]) assert.equal((await rate(a.token, score)).status, 400);
  assert.deepEqual((await rate(a.token, 10)).data.rating, { average: 10, votes: 1 });
  assert.deepEqual((await rate(a.token, 8)).data.rating, { average: 8, votes: 1 });
  assert.deepEqual((await rate(b.token, 6)).data.rating, { average: 7, votes: 2 });
  assert.equal((await request(`/api/movies/${movieId}/community`, { token: a.token })).data.myRating, 8);
  assert.equal((await request(`/api/movies/${movieId}/community`)).data.myRating, null);
  assert.deepEqual((await knowledge.getMovie(movieId)).lightmoonRating, { average: 7, votes: 2 });
  assert.deepEqual((await knowledge.queryCatalog({ ids: [movieId] })).movies[0].lightmoonRating, { average: 7, votes: 2 });
  assert.deepEqual((await request(`/api/movies/${movieId}/rating`, { method: 'DELETE', token: a.token })).data.rating, { average: 6, votes: 1 });
  sql.prepare('DELETE FROM users WHERE id=?').run(b.user.id);
  assert.deepEqual((await knowledge.getMovie(movieId)).lightmoonRating, { average: null, votes: 0 });
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM movie_rating_totals').get().total, 0);
  assert.equal((await request('/api/movies/missing-movie/rating', { method: 'PUT', token: a.token, body: { score: 10 } })).status, 404);
});

test('comments are public text with private email, pagination, validation and author-only deletion', async t => {
  const { request, register, store } = await setup(t);
  const a = await register(), b = await register('second@example.invalid');
  const content = '<script>alert("text only")</script>\n这是一段观影感受。';
  const created = await request(`/api/movies/${movieId}/comments`, { method: 'POST', token: a.token, body: { content } });
  assert.equal(created.status, 201);
  const publicPage = await request(`/api/movies/${movieId}/community`);
  assert.equal(publicPage.data.comments[0].content, content); assert.equal(publicPage.data.comments[0].mine, false);
  assert.ok(!JSON.stringify(publicPage.data).includes(a.user.email)); assert.ok(!JSON.stringify(publicPage.data).includes(a.token));
  assert.equal((await request(`/api/movies/${movieId}/community`, { token: a.token })).data.comments[0].mine, true);
  for (const value of ['', '  ', '字'.repeat(1001), '\u0000']) assert.equal((await request(`/api/movies/${movieId}/comments`, { method: 'POST', token: a.token, body: { content: value } })).status, 400);
  for (let index = 0; index < 23; index++) await store.comment(movieId, a.user.id, `影评 ${index}`);
  const first = (await request(`/api/movies/${movieId}/community`)).data;
  const next = (await request(`/api/movies/${movieId}/community?offset=20`)).data;
  assert.equal(first.total, 24); assert.equal(first.comments.length, 20); assert.equal(next.comments.length, 4);
  assert.equal(new Set([...first.comments, ...next.comments].map(row => row.id)).size, 24);
  assert.equal((await request('/api/comments/' + created.data.id, { method: 'DELETE', token: b.token })).status, 403);
  assert.equal((await request('/api/comments/' + created.data.id, { method: 'DELETE', token: a.token })).status, 200);
  assert.equal((await request('/api/comments/' + created.data.id, { method: 'DELETE', token: a.token })).status, 404);
});

test('personal movie lists are isolated, persistent per account and retain independent saved/watched changes', async t => {
  const { request, register, sql } = await setup(t);
  const a = await register(), b = await register('second@example.invalid');
  const path = `/api/account/library/${movieId}`;
  await request(path, { method: 'PUT', token: a.token, body: { saved: true } });
  const watched = await request(path, { method: 'PUT', token: a.token, body: { watched: true } });
  assert.deepEqual(watched.data, { saved: [movieId], watched: [movieId] });
  assert.deepEqual((await request('/api/account/library', { token: b.token })).data, { saved: [], watched: [] });
  assert.equal((await request(path, { method: 'PUT', token: a.token, body: { saved: 'yes' } })).status, 400);
  assert.deepEqual((await request(path, { method: 'PUT', token: a.token, body: { saved: false } })).data, { saved: [], watched: [movieId] });
  await request(path, { method: 'PUT', token: a.token, body: { watched: false } });
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM user_library').get().total, 0);
});

test('expired and logged-out sessions cannot write, and auth endpoints respect CORS and rate limits', async t => {
  let time = Date.now();
  const { request, register, store } = await setup(t, { now: () => time });
  const a = await register();
  const preflight = await request(`/api/movies/${movieId}/rating`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.ok(preflight.response.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  for (const method of ['PUT', 'DELETE']) assert.ok(preflight.response.headers.get('Access-Control-Allow-Methods').includes(method));
  assert.equal((await request('/api/auth/me', { token: a.token, headers: { Origin: 'https://malicious.example' } })).status, 403);
  await request('/api/auth/logout', { method: 'POST', token: a.token });
  assert.equal((await request('/api/auth/me', { token: a.token })).status, 401);
  const b = await register('second@example.invalid');
  time += 8 * 86400000;
  assert.equal(await store.authenticate('Bearer ' + b.token), null);
  assert.equal((await request(`/api/movies/${movieId}/comments`, { method: 'POST', token: b.token, body: { content: 'expired' } })).status, 401);
  for (let index = 0; index < 20; index++) await store.consumeLimit('test-login', 20, 900);
  await assert.rejects(store.consumeLimit('test-login', 20, 900), error => error.status === 429);
  time += 901000; await store.consumeLimit('test-login', 20, 900);
  for (let index = 0; index < 5; index++) await request('/api/auth/register', { method: 'POST', body: { email: 'bad' } });
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { email: 'bad' } })).status, 429);
});

test('the local HTTP server uses the same cloud-compatible authentication and community contract', async t => {
  const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  const server = createServer(createAppHandler({ knowledge, config: {} }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); server.closeAllConnections(); await once(server, 'close'); knowledge.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const signup = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'local@example.invalid', password }) });
  assert.equal(signup.status, 201);
  const { token } = await signup.json();
  const rate = await fetch(base + '/api/movies/flipped/rating', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ score: 9 }) });
  assert.equal(rate.status, 200); assert.deepEqual((await rate.json()).rating, { average: 9, votes: 1 });
  assert.equal((await (await fetch(base + '/api/catalog?ids=flipped')).json()).movies[0].lightmoonRating.average, 9);
});
