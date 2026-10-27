import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createD1KnowledgeBase } from '../../workers/knowledge.mjs';
import { createWorkerHandler } from '../../workers/index.mjs';
import { emptyFilters, matchesFilters, toggleFilter } from '../../src/lib/catalog.js';
import { facetFixtures, metadataFilters } from './fixtures/facet-movies.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('workers/migrations/0001_movies.sql', 'utf8'));
  sql.exec(readFileSync('workers/migrations/0002_accounts_community.sql', 'utf8'));
  sql.exec(readFileSync('workers/migrations/0003_catalog_tag_index.sql', 'utf8'));
  const db = { prepare(statement) {
    const build = params => ({
      bind(...values) { assert.ok(values.length <= 100, 'D1 statement exceeds 100 bindings'); return build(values); },
      async all() { return { success: true, results: sql.prepare(statement).all(...params) }; },
      async first() { return sql.prepare(statement).get(...params) || null; },
      async run() { sql.prepare(statement).run(...params); return { success: true }; },
    });
    return build([]);
  }, async batch(statements) {
    sql.exec('BEGIN');
    try { const rows = []; for (const statement of statements) rows.push(await statement.all()); sql.exec('COMMIT'); return rows; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { db, close: () => sql.close() };
}

test('D1 persists searchable films and combined filters within binding limits', async () => {
  const storage = database(), kb = createD1KnowledgeBase(storage.db);
  try {
    await kb.upsertImported(facetFixtures);
    assert.equal((await kb.stats()).movieCount, 3);
    assert.ok((await kb.search('演员甲')).some(row => row.id === 'tmdb-999001'));
    const ids = [...facetFixtures].reverse().map(movie => movie.id);
    assert.deepEqual((await kb.queryCatalog({ ids, sort: 'collection', limit: 2, offset: 1 })).movies.map(movie => movie.id), ids.slice(1));
    assert.deepEqual((await kb.queryCatalog({ query: '跨国测试甲' })).movies.map(movie => movie.id), ['tmdb-999001']);
    for (const mode of ['any', 'all']) for (const filter of metadataFilters) {
      const filters = { ...emptyFilters(), ...filter };
      const expected = facetFixtures.filter(movie => matchesFilters(movie, filters, mode)).map(movie => movie.id).sort();
      const actual = await kb.queryCatalog({ filters, mode, facets: true, ids: Array.from({ length: 2000 }, (_, index) => 'tmdb-' + (999001 + index)) });
      assert.deepEqual(actual.movies.map(movie => movie.id).sort(), expected);
      assert.equal(actual.total, expected.length);
    }
    for (const mode of ['any', 'all']) {
      const filters = { ...emptyFilters(), cast: ['演员乙'] };
      for (const option of await kb.suggestFacet({ group: 'cast', query: '演员', filters, mode })) assert.equal(option.count, (await kb.queryCatalog({ filters: toggleFilter(filters, 'cast', option.value), mode })).total);
    }
    await kb.upsertImported([{ ...facetFixtures[0], doubanRating: { average: 8.1 }, rottenTomatoesRating: { critics: { score: 88 } } }]);
    await kb.upsertImported([facetFixtures[0]]);
    const refreshed = await kb.getByTmdb(999001);
    assert.equal(refreshed.doubanRating.average, 8.1);
    assert.equal(refreshed.rottenTomatoesRating.critics.score, 88);
  } finally { storage.close(); }
});

test('Worker serves CORS-protected catalog and grounded AI without returning credentials', async () => {
  const storage = database(), kb = createD1KnowledgeBase(storage.db);
  try {
    await kb.upsertImported(facetFixtures);
    let deepseekCalls = 0;
    const origin = 'https://shhsh993838383-hub.github.io';
    const handler = createWorkerHandler({ knowledge: kb, allowedOrigins: [origin], dailyLimit: 1, config: { apiKey: 'private-worker-test-key' }, fetchImpl: async (url, options) => {
      deepseekCalls++;
      assert.equal(options.headers.Authorization, 'Bearer private-worker-test-key');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ message: '试试这部喜剧。', recommendations: [{ id: 'tmdb-999001', reason: '片长 90 分钟。' }] }) } }] });
    } });
    const request = (path, options = {}) => new Request('https://lightmoon.example' + path, { ...options, headers: { Origin: origin, ...options.headers } });
    const status = await handler(request('/api/assistant/status'));
    assert.equal(status.status, 200); assert.equal(status.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal((await status.json()).movieCount, 3);
    assert.equal((await handler(request('/api/catalog', { headers: { Origin: 'https://unknown.example' } }))).status, 403);
    assert.equal((await handler(request('/api/assistant/chat', { method: 'OPTIONS' }))).status, 204);
    const post = messages => request('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    const answer = await handler(post([{ role: 'user', content: '想看喜剧，100分钟以内' }]));
    assert.equal(answer.status, 200);
    const text = await answer.text(); assert.ok(!text.includes('private-worker-test-key'));
    const result = JSON.parse(text); assert.equal(result.mode, 'deepseek'); assert.equal(result.recommendations[0].id, 'tmdb-999001');
    const limited = await handler(post([{ role: 'user', content: '再推荐喜剧' }]));
    assert.equal(limited.status, 429); assert.equal((await limited.json()).code, 'daily_limit'); assert.equal(deepseekCalls, 1);
    const oversized = await handler(new Request('https://lightmoon.example/api/assistant/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(48001) }));
    assert.equal(oversized.status, 413);
    assert.equal((await handler(request('/api/catalog?filters=[]'))).status, 400);
  } finally { storage.close(); }
});

test('D1 admission removes a film and its indexes when any refreshed score falls below the threshold', async () => {
  const storage = database(), kb = createD1KnowledgeBase(storage.db);
  try {
    await kb.upsertImported([facetFixtures[0]]);
    assert.equal((await kb.stats()).movieCount, 1);
    await kb.upsertImported([{ ...facetFixtures[0], rottenTomatoesRating: { critics: { score: 59 } } }]);
    assert.equal((await kb.stats()).movieCount, 0);
    assert.equal(await kb.getByTmdb(facetFixtures[0].tmdbId), null);
    assert.deepEqual(await kb.search('演员甲'), []);
    assert.equal((await kb.queryCatalog({ facets: true })).total, 0);
  } finally { storage.close(); }
});

test('D1 keeps a low-rated film while another platform exceeds 80 percent and removes it when the exception ends', async () => {
  const storage = database(), kb = createD1KnowledgeBase(storage.db);
  try {
    const film = { ...facetFixtures[0], doubanRating: { average: 8.1 }, rottenTomatoesRating: { critics: { score: 45 } } };
    await kb.upsertImported([film]);
    assert.equal((await kb.stats()).movieCount, 1);
    assert.equal((await kb.getByTmdb(film.tmdbId)).rottenTomatoesRating.critics.score, 45);
    assert.ok((await kb.search('演员甲')).some(row => row.id === film.id));
    await kb.upsertImported([{ ...film, doubanRating: { average: 8 } }]);
    assert.equal((await kb.stats()).movieCount, 0);
    assert.deepEqual(await kb.search('演员甲'), []);
  } finally { storage.close(); }
});
