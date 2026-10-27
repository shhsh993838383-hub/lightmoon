import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createCloudKnowledgeBase } from '../cloud-knowledge.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { emptyFilters, facets, matchesFilters, toggleFilter } from '../../src/lib/catalog.js';
import { answerQuestion } from '../assistant.mjs';
import { normalizeTmdbMovie } from '../tmdb.mjs';
import { facetFixtures, metadataFilters } from './fixtures/facet-movies.mjs';

test('cloud PostgreSQL supports catalog filters, pagination, retrieval, and persistent metadata', async () => {
  const db = new PGlite();
  const local = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  const seeds = local.movies;
  const query = async (statement, parameters = []) => (await db.query(statement, parameters)).rows;
  const cloud = createCloudKnowledgeBase({ query, seeds, initialMovies: [] });
  try {
    assert.equal((await cloud.stats()).movieCount, seeds.length);
    const options = [emptyFilters(), ...facets.flatMap(facet => facet.options.map(value => ({ ...emptyFilters(), [facet.id]: [value] }))), { ...emptyFilters(), genre: ['爱情', '喜剧'], mood: ['温暖', '浪漫'] }, { ...emptyFilters(), genre: ['爱情'], exclude: ['感伤'] }];
    for (const mode of ['any', 'all']) for (const filters of options) {
      const expected = seeds.filter(movie => matchesFilters(movie, filters, mode)).map(movie => movie.id).sort();
      const actual = await cloud.queryCatalog({ filters, mode, limit: 200 });
      assert.deepEqual(actual.movies.map(movie => movie.id).sort(), expected);
      assert.equal(actual.total, expected.length);
    }
    const first = await cloud.queryCatalog({ limit: 5, facets: true });
    const next = await cloud.queryCatalog({ limit: 5, offset: 5 });
    assert.equal(new Set([...first.movies, ...next.movies].map(movie => movie.id)).size, 10);
    for (const facet of facets) for (const value of facet.options) assert.equal(first.facetCounts[facet.id][value], seeds.filter(movie => matchesFilters(movie, toggleFilter(emptyFilters(), facet.id, value))).length);
    assert.ok((await cloud.search('白日梦想家')).some(hit => hit.id === 'walter-mitty'));
    const answer = await answerQuestion({ knowledge: cloud, messages: [{ role: 'user', content: '爱情片，两个小时以内' }], mode: 'local' });
    assert.ok(answer.recommendations.length);
    for (const item of answer.recommendations) { const movie = await cloud.getMovie(item.id); assert.ok(movie.genre.includes('爱情')); assert.ok(movie.minutes <= 120); }
    await cloud.setMetadata('tmdbImportState', JSON.stringify({ checked: 12 }));
    const second = createCloudKnowledgeBase({ query, seeds, initialMovies: [] });
    assert.equal(JSON.parse(await second.getMetadata('tmdbImportState')).checked, 12);
    assert.equal(await cloud.consumeRateLimit('test', 1), true);
    assert.equal(await cloud.consumeRateLimit('test', 1), false);
    const imported = normalizeTmdbMovie({ id: 990098, title: '云端测试电影', original_title: 'Cloud Fixture', release_date: '2020-01-01', adult: false });
    await cloud.upsertImported([{ ...imported, doubanRating: { average: 8.4 }, rottenTomatoesRating: { critics: { score: 92 } } }]);
    await cloud.upsertImported([imported]);
    const refreshed = await cloud.getByTmdb(990098);
    assert.equal(refreshed.doubanRating.average, 8.4);
    assert.equal(refreshed.rottenTomatoesRating.critics.score, 92);
    await cloud.upsertImported(facetFixtures);
    const library = [...seeds, imported, ...facetFixtures];
    for (const mode of ['any', 'all']) for (const filter of metadataFilters) {
      const filters = { ...emptyFilters(), ...filter };
      const expected = library.filter(movie => matchesFilters(movie, filters, mode)).map(movie => movie.id).sort();
      assert.deepEqual((await cloud.queryCatalog({ filters, mode, limit: 200 })).movies.map(movie => movie.id).sort(), expected);
    }
    assert.ok((await cloud.suggestFacet({ group: 'cast', query: '演员', filters: { director: ['导演甲'] } })).some(row => row.value === '演员乙' && row.count === 2));
  } finally { local.close(); await db.close(); }
});
