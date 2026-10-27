import test from 'node:test';
import assert from 'node:assert/strict';
import { meetsRatingPolicy, ratingPolicyViolations } from '../../src/lib/rating-policy.js';
import { mergeCatalog } from '../catalog-merge.mjs';
import { normalizeTmdbMovie } from '../tmdb.mjs';
import { expandTmdbCatalog } from '../expand-tmdb.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { createMovieDiscovery } from '../movie-discovery.mjs';

// Isolated synthetic records for import and admission checks.
const raw = (id, average = 7) => ({ id, title: `合成测试影片 ${id}`, adult: false, poster_path: '/test.jpg', release_date: '2020-01-01', runtime: 90, vote_average: average, vote_count: 100, genres: [{ id: 35 }] });
const movie = id => normalizeTmdbMovie(raw(id));

test('admission accepts threshold equality, rejects any known low rating, and preserves unknown ratings', () => {
  const boundary = { tmdbRating: { average: 6 }, doubanRating: { average: 6 }, rottenTomatoesRating: { critics: { score: 60 }, audience: { score: 20 } } };
  assert.equal(meetsRatingPolicy(boundary), true);
  assert.equal(meetsRatingPolicy({ tmdbRating: null, doubanRating: null, rottenTomatoesRating: null }), true);
  for (const [field, value] of [['tmdbRating', { average: 5.99 }], ['doubanRating', { average: 5.99 }], ['rottenTomatoesRating', { critics: { score: 59 } }]]) assert.equal(meetsRatingPolicy({ ...boundary, [field]: value }), false);
  assert.deepEqual(ratingPolicyViolations({ tmdbRating: { average: 0 }, rottenTomatoesRating: { critics: { score: 0 } } }), ['tmdb', 'rottenTomatoes']);
  assert.equal(mergeCatalog([], [boundary, { ...movie(990111), doubanRating: { average: 5.5 } }]).length, 0);
});

test('expansion counts only distinct eligible films with posters and checks detailed ratings again', async () => {
  const rejected = { ...movie(2), rottenTomatoesRating: { critics: { score: 59 } } };
  const calls = [], checkpoints = [];
  const client = { async get(path, params) {
    calls.push(path);
    if (path === '/configuration') return { images: {} };
    if (path === '/discover/movie') {
      assert.equal(params['vote_average.gte'], 6);
      return { results: [raw(2), raw(3, 5.9), { ...raw(4), poster_path: null }, raw(5), raw(6), raw(7)] };
    }
    const id = Number(path.split('/').at(-1));
    return raw(id, id === 5 ? 5.5 : id === 6 ? 6 : 7);
  } };
  const result = await expandTmdbCatalog({ client, existing: [movie(1), rejected], target: 3, onBatch: films => checkpoints.push(films) });
  assert.deepEqual(result.movies.map(film => film.tmdbId), [1, 6, 7]);
  assert.equal(result.skipped, 1);
  for (const id of [2, 3, 4]) assert.ok(!calls.includes(`/movie/${id}`));
  assert.equal(checkpoints.at(-1).length, 3);
  assert.equal(new Set(result.movies.map(film => film.tmdbId)).size, 3);
});

test('a rating downgrade removes a stored film from catalog, search, and later discovery imports', async () => {
  const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  try {
    const initial = knowledge.stats().movieCount;
    knowledge.upsertImported([movie(990112)]);
    assert.equal(knowledge.stats().movieCount, initial + 1);
    knowledge.upsertImported([{ ...movie(990112), doubanRating: { average: 5.9 } }]);
    assert.equal(knowledge.stats().movieCount, initial);
    assert.equal(knowledge.getByTmdb(990112), null);
    assert.ok(!knowledge.search('990112').some(hit => hit.id === 'tmdb-990112'));
    const discovery = createMovieDiscovery({ knowledge, client: { get: async path => path === '/configuration' ? { images: {} } : raw(990112, 5.9) } });
    assert.deepEqual(await discovery.importIds([990112]), []);
    assert.equal(knowledge.getByTmdb(990112), null);
  } finally { knowledge.close(); }
});
