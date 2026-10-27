import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionReason, highScorePlatforms, meetsRatingPolicy, movieCollectionNames, ratingPolicyViolations, withKnownRatings } from '../../src/lib/rating-policy.js';
import specialCollections from '../../src/data/series-collections.json' with { type: 'json' };
import { mergeCatalog } from '../catalog-merge.mjs';
import { normalizeTmdbMovie } from '../tmdb.mjs';
import { expandTmdbCatalog } from '../expand-tmdb.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { createMovieDiscovery } from '../movie-discovery.mjs';

// Isolated synthetic records for import and admission checks.
const raw = (id, average = 7) => ({ id, title: `合成测试影片 ${id}`, adult: false, poster_path: '/test.jpg', release_date: '2020-01-01', runtime: 90, vote_average: average, vote_count: 100, genres: [{ id: 35 }] });
const movie = id => normalizeTmdbMovie(raw(id));

test('admission accepts threshold equality, rejects unrescued low ratings, and preserves unknown ratings', () => {
  const boundary = { tmdbRating: { average: 6 }, doubanRating: { average: 6 }, rottenTomatoesRating: { critics: { score: 60 }, audience: { score: 20 } } };
  assert.equal(meetsRatingPolicy(boundary), true);
  assert.equal(meetsRatingPolicy({ tmdbRating: null, doubanRating: null, rottenTomatoesRating: null }), true);
  for (const [field, value] of [['tmdbRating', { average: 5.99 }], ['doubanRating', { average: 5.99 }], ['rottenTomatoesRating', { critics: { score: 59 } }]]) assert.equal(meetsRatingPolicy({ ...boundary, [field]: value }), false);
  assert.deepEqual(ratingPolicyViolations({ tmdbRating: { average: 0 }, rottenTomatoesRating: { critics: { score: 0 } } }), ['tmdb', 'rottenTomatoes']);
  assert.equal(mergeCatalog([], [boundary, { ...movie(990111), doubanRating: { average: 5.5 } }]).length, 0);
  assert.equal(admissionReason({ id: 'flipped' }), 'high-score');
  assert.equal(admissionReason({ tmdbId: 43949, tmdbRating: { average: 8 } }), 'high-score');
  assert.equal(meetsRatingPolicy({ tmdbId: 43949, rottenTomatoesRating: { critics: { score: 60 } } }), true);
  assert.equal(withKnownRatings({ id: 'flipped', doubanRating: null }).doubanRating.average, 9.1);
  assert.equal(meetsRatingPolicy(null), false);
});

test('another platform must strictly exceed 80 percent to rescue a low score', () => {
  const low = { tmdbRating: { average: 5.9 }, doubanRating: { average: 8 }, rottenTomatoesRating: { critics: { score: 80 }, audience: { score: 100 } } };
  assert.equal(admissionReason(low), 'rejected');
  for (const [field, score, provider] of [['tmdbRating', { average: 8.01 }, 'TMDB'], ['doubanRating', { average: 8.01 }, '豆瓣'], ['rottenTomatoesRating', { critics: { score: 81 } }, '烂番茄']]) {
    const input = { tmdbRating: { average: 5 }, doubanRating: { average: 5 }, rottenTomatoesRating: { critics: { score: 50 } }, [field]: score };
    assert.equal(admissionReason(input), 'high-score');
    assert.deepEqual(highScorePlatforms(input), [provider]);
  }
  assert.equal(admissionReason({ ...low, doubanRating: { average: '9.0' } }), 'rejected');
  assert.equal(admissionReason({ ...low, doubanRating: { average: 11 } }), 'rejected');
});

test('only trusted Top250 or series memberships grant a collection exception', () => {
  const collection = specialCollections.find(item => item.id === 'harry-potter');
  assert.ok(collection?.movies.length === 8);
  const film = collection.movies[0];
  const low = { id: film.id, tmdbId: film.tmdbId, tmdbRating: { average: 5 }, doubanRating: { average: 5 }, rottenTomatoesRating: { critics: { score: 50 } } };
  assert.equal(admissionReason(low), 'collection');
  assert.ok(movieCollectionNames(low).includes(collection.title));
  assert.equal(admissionReason({ ...low, id: 'tmdb-990199', tmdbId: 990199, collections: ['哈利波特'], doubanTop250Rank: 1 }), 'rejected');
});

test('expansion counts only distinct eligible films with posters and checks detailed ratings again', async () => {
  const rejected = { ...movie(990022), rottenTomatoesRating: { critics: { score: 59 } } };
  const calls = [], checkpoints = [];
  const client = { async get(path, params) {
    calls.push(path);
    if (path === '/configuration') return { images: {} };
    if (path === '/discover/movie') {
      assert.equal(params['vote_average.gte'], 6);
      return { results: [raw(990022), raw(990023, 5.9), { ...raw(990024), poster_path: null }, raw(990025), raw(990026), raw(990027)] };
    }
    const id = Number(path.split('/').at(-1));
    return raw(id, id === 990025 ? 5.5 : id === 990026 ? 6 : 7);
  } };
  const result = await expandTmdbCatalog({ client, existing: [movie(990021), rejected], target: 3, onBatch: films => checkpoints.push(films) });
  assert.deepEqual(result.movies.map(film => film.tmdbId), [990021, 990026, 990027]);
  assert.equal(result.skipped, 1);
  for (const id of [990022, 990023, 990024]) assert.ok(!calls.includes(`/movie/${id}`));
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
