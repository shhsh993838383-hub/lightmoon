// End-to-end check for the deployed D1 service. Creates only reserved .invalid
// test identities; the finally block removes these exact identities and votes.
import assert from 'node:assert/strict';
import { createD1Api } from './cloudflare-d1-api.mjs';

if (!process.argv.includes('--remote')) throw new Error('Use --remote to verify the deployed community service.');
const base = 'https://lightmoon-api.lightmoon-movie-explorer.workers.dev';
const origin = 'https://shhsh993838383-hub.github.io';
const tag = Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
const password = crypto.randomUUID() + '-Verification';
const emails = [`qa-${tag}-a@example.invalid`, `qa-${tag}-b@example.invalid`];
const query = createD1Api();
async function request(path, { method = 'GET', token, body, expected = 200, headers } = {}) {
  const result = await fetch(base + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await result.json();
  assert.equal(result.status, expected, `${method} ${path}: ${data.code || result.status}`);
  return data;
}
let baseline, movieId;
try {
  const catalog = await request('/api/catalog?limit=1');
  assert.equal(catalog.movieCount, 10000);
  movieId = catalog.movies[0].id;
  baseline = await request(`/api/movies/${movieId}/community`);
  await request(`/api/movies/${movieId}/rating`, { method: 'PUT', body: { score: 9 }, expected: 401 });
  await request(`/api/movies/${movieId}/comments`, { method: 'POST', body: { content: 'guest' }, expected: 401 });
  const accounts = [];
  for (const email of emails) {
    const started = Date.now();
    accounts.push(await request('/api/auth/register', { method: 'POST', body: { email, password, displayName: '临时功能验证' }, expected: 201 }));
    console.log(`Cloud registration succeeded (${Date.now() - started} ms).`);
  }
  const [a, b] = accounts;
  assert.equal((await request('/api/auth/me', { token: a.token })).user.id, a.user.id);
  await request('/api/auth/login', { method: 'POST', body: { email: emails[0], password: 'wrong-password' }, expected: 401 });
  const login = await request('/api/auth/login', { method: 'POST', body: { email: emails[0].toUpperCase(), password } });
  assert.equal(login.user.id, a.user.id);
  await request('/api/auth/me', { token: a.token, headers: { Origin: 'https://untrusted.example' }, expected: 403 });
  for (const score of [0, 11, 4.5, null]) await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: a.token, body: { score }, expected: 400 });
  await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: a.token, body: { score: 10 } });
  assert.equal((await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: a.token, body: { score: 8 } })).rating.votes, baseline.rating.votes + 1);
  const rating = await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: b.token, body: { score: 6 } });
  assert.equal(rating.rating.votes, baseline.rating.votes + 2);
  const expectedAverage = ((baseline.rating.average || 0) * baseline.rating.votes + 14) / (baseline.rating.votes + 2);
  assert.ok(Math.abs(rating.rating.average - expectedAverage) < 0.000001);
  const fresh = (await request('/api/catalog?ids=' + movieId)).movies[0];
  assert.equal(fresh.lightmoonRating.average, rating.rating.average);
  const created = await request(`/api/movies/${movieId}/comments`, { method: 'POST', token: a.token, body: { content: '光幕部署功能验证（临时记录，验证后自动删除）。' }, expected: 201 });
  const publicPage = await request(`/api/movies/${movieId}/community`);
  assert.equal(publicPage.total, baseline.total + 1);
  assert.ok(!JSON.stringify(publicPage).includes(emails[0]));
  await request('/api/comments/' + created.id, { method: 'DELETE', token: b.token, expected: 403 });
  await request('/api/comments/' + created.id, { method: 'DELETE', token: a.token });
  await request(`/api/account/library/${movieId}`, { method: 'PUT', token: a.token, body: { saved: true, watched: true } });
  assert.deepEqual(await request('/api/account/library', { token: a.token }), { saved: [movieId], watched: [movieId] });
  assert.deepEqual(await request('/api/account/library', { token: b.token }), { saved: [], watched: [] });
  await request(`/api/movies/${movieId}/rating`, { method: 'DELETE', token: a.token });
  await request(`/api/movies/${movieId}/rating`, { method: 'DELETE', token: b.token });
  await request('/api/auth/logout', { method: 'POST', token: a.token });
  await request(`/api/movies/${movieId}/rating`, { method: 'PUT', token: a.token, body: { score: 9 }, expected: 401 });
  console.log('Cloud login, permissions, scores, comments, isolation, CORS and logout verified.');
} finally {
  for (const email of emails) await query('DELETE FROM users WHERE email=?', [email]);
  if (movieId && baseline) {
    const after = await request(`/api/movies/${movieId}/community`);
    assert.deepEqual(after.rating, baseline.rating); assert.equal(after.total, baseline.total);
  }
  console.log('Temporary cloud accounts and contributions removed.');
}
