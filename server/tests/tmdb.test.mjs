import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTmdbClient, matchCuratedResult, normalizeTmdbMovie, syncTmdbCatalog } from '../tmdb.mjs';
import { catalogPath, mergeCatalog, readTmdbCatalog, writeTmdbCatalog } from '../catalog-store.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { createAppServer } from '../index.mjs';
import { eligible, extractPreferences } from '../retrieval.mjs';
import { emptyFilters, matchesFilters, matchesQuery, sortMovies } from '../../src/lib/catalog.js';

const seeds = JSON.parse(readFileSync(catalogPath, 'utf8'));
const rawMovie = (id = 990001) => ({
  id, title: '测试动作片', original_title: 'Action Fixture', adult: false,
  release_date: '2020-01-02', runtime: 95, genres: [{ id: 28, name: 'Action' }],
  overview: '一次远行的故事。', poster_path: '/fixture.jpg', imdb_id: 'tt990001',
  production_countries: [{ iso_3166_1: 'CN' }], spoken_languages: [{ iso_639_1: 'zh' }],
  credits: { crew: [{ job: 'Director', name: '测试导演' }], cast: [{ name: '测试演员', character: '主角' }] },
  keywords: { keywords: [{ name: 'rescue mission' }] }, vote_count: 1234, vote_average: 7.6,
  translations: { translations: [{ iso_639_1: 'en', data: { title: 'Action Fixture', overview: 'A journey.' } }] },
  alternative_titles: { titles: [{ iso_3166_1: 'HK', title: '测试别名' }] },
});

test('TMDB metadata keeps provenance and ratings without inventing subjective annotations', () => {
  const movie = normalizeTmdbMovie(rawMovie(), { importedAt: '2026-10-27T00:00:00Z' });
  assert.equal(movie.id, 'tmdb-990001');
  assert.deepEqual(movie.genre, ['动作']);
  assert.deepEqual(movie.mood, []);
  assert.deepEqual(movie.theme, []);
  assert.equal(movie.tagStatus, 'tmdb-unreviewed');
  assert.equal(movie.country, '中国大陆');
  assert.ok(movie.aliases.includes('测试别名'));
  assert.equal(movie.cast[0].name, '测试演员');
  assert.equal(movie.tmdbRating.votes, 1234);
  assert.equal(movie.source.page, 'https://www.themoviedb.org/movie/990001');
  assert.match(movie.poster, /^https:\/\/image\.tmdb\.org\/t\/p\//);
  const unknown = normalizeTmdbMovie({ ...rawMovie(), runtime: 0, release_date: '', poster_path: 'https://untrusted.example/image.jpg', vote_count: 0 });
  assert.equal(unknown.minutes, null);
  assert.equal(unknown.year, null);
  assert.equal(unknown.poster, null);
  assert.equal(unknown.tmdbRating, null);
  assert.throws(() => normalizeTmdbMovie({ ...rawMovie(), adult: true }), error => error.code === 'tmdb_invalid_record');
});

test('TMDB authentication stays server-side and upstream errors are redacted', async () => {
  const token = 'test-private-token';
  const client = createTmdbClient({ accessToken: token, apiKey: 'ignored-key', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.themoviedb.org');
    assert.equal(new URL(url).searchParams.get('api_key'), null);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(token + ' upstream details', { status: 401 });
  } });
  await assert.rejects(client.get('/configuration'), error => error.code === 'tmdb_auth' && !error.message.includes(token));
  const fallback = createTmdbClient({ accessToken: '', apiKey: 'test-v3-key', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('api_key'), 'test-v3-key');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ ok: true });
  } });
  assert.deepEqual(await fallback.get('/configuration'), { ok: true });
  await assert.rejects(createTmdbClient({ accessToken: '', apiKey: '' }).get('/configuration'), error => error.code === 'tmdb_not_configured');
});

test('TMDB throttling has bounded retries and network failures hide request secrets', async () => {
  let attempts = 0;
  const waits = [];
  const client = createTmdbClient({ accessToken: 'test-only', apiKey: '', wait: async ms => waits.push(ms), fetchImpl: async () => {
    attempts++;
    return attempts < 3 ? new Response('', { status: 429, headers: { 'retry-after': '100' } }) : Response.json({ ok: true });
  } });
  assert.deepEqual(await client.get('/configuration'), { ok: true });
  assert.deepEqual(waits, [30000, 30000]);
  const broken = createTmdbClient({ accessToken: '', apiKey: 'test-private-key', wait: async () => {}, fetchImpl: async () => { throw new Error('api_key=test-private-key'); } });
  await assert.rejects(broken.get('/configuration'), error => error.code === 'tmdb_unavailable' && !error.message.includes('test-private-key'));
});

test('matching and merging keep stable saved-film ids and editorial tags', () => {
  const seed = seeds.find(movie => movie.id === 'grand-budapest');
  assert.equal(matchCuratedResult(seed, [{ id: 2, title: seed.title, release_date: `${seed.year + 1}-01-01` }, { id: 1, title: seed.title, release_date: `${seed.year}-01-01` }]).id, 1);
  const imported = normalizeTmdbMovie({ ...rawMovie(), title: seed.title, release_date: `${seed.year}-01-01` }, { curatedId: seed.id });
  const merged = mergeCatalog([seed], [imported, imported, normalizeTmdbMovie(rawMovie(990002))]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, seed.id);
  assert.deepEqual(merged[0].mood, seed.mood);
  assert.deepEqual(merged[0].theme, seed.theme);
  assert.equal(merged[0].poster, seed.poster);
  assert.equal(merged[0].tmdbRating.average, 7.6);
  assert.equal(merged[1].id, 'tmdb-990002');
});

test('finite sync upserts records and does not replace the snapshot on a failed run', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'lightmoon-sync-'));
  const path = join(temp, 'movies.json');
  try {
    const client = { get: async route => {
      if (route === '/configuration') return { images: {} };
      if (route.startsWith('/movie/99000')) return rawMovie(Number(route.split('/').at(-1)));
      return { results: [rawMovie(990001), rawMovie(990002)] };
    } };
    const first = await syncTmdbCatalog({ client, seeds: [], limit: 2 });
    writeTmdbCatalog(first, path);
    const again = await syncTmdbCatalog({ client, seeds: [], existing: readTmdbCatalog(path).movies, limit: 2 });
    assert.equal(again.movies.length, 2);
    assert.equal(again.processed, 2);
    const before = readFileSync(path, 'utf8');
    await assert.rejects(syncTmdbCatalog({ client: { get: async () => { throw new Error('offline'); } }, seeds: [], existing: first.movies, limit: 2 }));
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('imported films become searchable, visible through HTTP, and usable in AI retrieval without restart', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'lightmoon-kb-'));
  const path = join(temp, 'movies.json');
  const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: path });
  const server = createAppServer({ knowledge, config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(knowledge.stats().movieCount, 22);
    writeTmdbCatalog({ version: 1, updatedAt: '2026-10-27T00:00:00Z', movies: [normalizeTmdbMovie(rawMovie())] }, path);
    assert.equal(knowledge.stats().movieCount, 23);
    assert.ok(knowledge.search('测试演员').some(hit => hit.id === 'tmdb-990001'));
    const catalog = await (await fetch(base + '/api/catalog')).json();
    assert.equal(catalog.tmdbCount, 1);
    assert.ok(catalog.movies.some(movie => movie.id === 'tmdb-990001'));
    assert.ok(!JSON.stringify(catalog).includes('ACCESS_TOKEN'));
    const answer = await (await fetch(base + '/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '想看动作片' }] }) })).json();
    assert.ok(answer.recommendations.some(movie => movie.id === 'tmdb-990001'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    knowledge.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('unknown runtime, year or mood cannot satisfy explicit constraints', () => {
  const movie = normalizeTmdbMovie({ ...rawMovie(), runtime: 0, release_date: '' });
  for (const content of ['不要悲伤的电影', '100分钟以内', '2010年以后']) {
    assert.equal(eligible(movie, extractPreferences([{ role: 'user', content }], [movie])), false);
  }
  assert.equal(matchesFilters(movie, { ...emptyFilters(), exclude: ['感伤'] }), false);
  assert.equal(matchesFilters(movie, { ...emptyFilters(), duration: ['100 分钟以内'] }), false);
  assert.equal(matchesQuery(movie, '测试演员'), true);
  for (const sort of ['shortest', 'oldest', 'newest']) assert.equal(sortMovies([movie, seeds[0]], sort).at(-1).id, movie.id);
});
