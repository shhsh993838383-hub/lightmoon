import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createCloudKnowledgeBase } from '../cloud-knowledge.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { emptyFilters, facets, matchesFilters, toggleFilter } from '../../src/lib/catalog.js';
import { answerQuestion } from '../assistant.mjs';

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
  } finally { local.close(); await db.close(); }
});
