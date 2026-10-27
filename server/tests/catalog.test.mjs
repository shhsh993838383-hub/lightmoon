import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { createDoubanClient, normalizeDoubanItems } from '../douban.mjs';
import { emptyFilters, facets, matchesFilters, sortMovies, toggleFilter } from '../../src/lib/catalog.js';

test('database filtering agrees with the frontend for individual and combined tags', () => {
  const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  try {
    const movies = knowledge.movies;
    const filters = [emptyFilters(), ...facets.flatMap(facet => facet.options.map(value => ({ ...emptyFilters(), [facet.id]: [value] }))), { ...emptyFilters(), genre: ['爱情', '喜剧'], mood: ['温暖', '浪漫'] }, { ...emptyFilters(), genre: ['爱情'], exclude: ['感伤'], duration: ['100 分钟以内'] }];
    for (const mode of ['any', 'all']) for (const filter of filters) {
      const expected = movies.filter(movie => matchesFilters(movie, filter, mode)).map(movie => movie.id).sort();
      const actual = knowledge.queryCatalog({ filters: filter, mode, limit: 200 });
      assert.deepEqual(actual.movies.map(movie => movie.id).sort(), expected);
      assert.equal(actual.total, expected.length);
    }
    const first = knowledge.queryCatalog({ limit: 5, facets: true });
    const next = knowledge.queryCatalog({ offset: 5, limit: 5 });
    assert.equal(new Set([...first.movies, ...next.movies].map(movie => movie.id)).size, 10);
    for (const facet of facets) for (const value of facet.options) assert.equal(first.facetCounts[facet.id][value], movies.filter(movie => matchesFilters(movie, toggleFilter(emptyFilters(), facet.id, value))).length);
    for (const sort of ['oldest', 'newest', 'shortest']) assert.deepEqual(knowledge.queryCatalog({ sort, limit: 200 }).movies.map(movie => movie.id), sortMovies(movies, sort).map(movie => movie.id));
    assert.equal(knowledge.queryCatalog({ ids: [] }).total, 0);
    assert.deepEqual(knowledge.queryCatalog({ ids: ['flipped'] }).movies.map(movie => movie.id), ['flipped']);
    const ids = ['totoro', 'flipped', 'inception'];
    assert.deepEqual(knowledge.queryCatalog({ ids, sort: 'collection', limit: 2, offset: 1 }).movies.map(movie => movie.id), ids.slice(1));
  } finally { knowledge.close(); }
});

const fixture = { items: [{ id: '1292052', title: '肖申克的救赎', year: '1994', rating: { value: 9.7, count: 100 }, pic: { normal: 'https://img1.doubanio.com/view/photo/public/test.jpg' } }], total: 1 };
test('Douban adapter normalizes real records and reuses cached rankings', async () => {
  let calls = 0;
  const client = createDoubanClient({ cachePath: null, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, 'm.douban.com');
    assert.equal(options.headers.Referer, 'https://m.douban.com/');
    return Response.json(fixture);
  } });
  const first = await client.getRanking();
  assert.equal(first.items[0].rating.average, 9.7);
  assert.equal(first.items[0].page, 'https://movie.douban.com/subject/1292052/');
  const cached = await client.getRanking();
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  await assert.rejects(client.getRanking({ category: 'invented' }), error => error.code === 'invalid_request');
  assert.throws(() => normalizeDoubanItems({ isMockData: true, ...fixture }), error => error.code === 'douban_mock');
});

test('Douban errors do not become simulated success and expired cached data is labeled', async () => {
  let clock = 0, offline = false;
  const client = createDoubanClient({ cachePath: null, now: () => clock, fetchImpl: async () => offline ? new Response('{}', { status: 403 }) : Response.json(fixture) });
  await client.getRanking();
  offline = true; clock = 3600001;
  const stale = await client.getRanking();
  assert.equal(stale.stale, true);
  assert.ok(stale.warning);
  const broken = createDoubanClient({ cachePath: null, apiKey: 'test-private-douban-key', fetchImpl: async url => new URL(url).hostname === 'm.douban.com' ? new Response('{}', { status: 400 }) : Response.json({ code: 109, msg: 'test-private-douban-key' }, { status: 400 }) });
  await assert.rejects(broken.getRanking({ category: 'top' }), error => error.code === 'douban_auth' && !error.message.includes('test-private-douban-key'));
});
