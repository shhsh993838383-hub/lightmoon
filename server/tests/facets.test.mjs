import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { facetFixtures, metadataFilters } from './fixtures/facet-movies.mjs';
import { emptyFilters, matchesFilters, facetSuggestions, toggleFilter } from '../../src/lib/catalog.js';

test('director, cast, production country, language and decade filters agree across browser and SQLite', () => {
  const kb = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  try {
    kb.upsertImported(facetFixtures);
    const movies = kb.movies;
    for (const mode of ['any', 'all']) for (const filter of metadataFilters) {
      const filters = { ...emptyFilters(), ...filter };
      const expected = movies.filter(movie => matchesFilters(movie, filters, mode)).map(movie => movie.id).sort();
      const result = kb.queryCatalog({ filters, mode, limit: 200 });
      assert.deepEqual(result.movies.map(movie => movie.id).sort(), expected);
      assert.equal(result.total, expected.length);
    }
    assert.deepEqual(kb.queryCatalog({ filters: { cast: ['演员甲'] } }).movies.map(movie => movie.id), ['tmdb-999001']);
    assert.ok(kb.queryCatalog({ filters: { country: ['中国大陆'] } }).movies.some(movie => movie.id === 'tmdb-999001'));
    for (const mode of ['any', 'all']) for (const group of ['director', 'cast', 'country', 'language']) {
      const filters = { ...emptyFilters(), director: ['导演甲'], [group]: group === 'cast' ? ['演员乙'] : [] };
      const options = kb.suggestFacet({ group, filters, mode });
      const expected = new Map(facetSuggestions(movies, { group, filters, mode, limit: 1000 }).map(row => [row.value, row.count]));
      assert.equal(options.length, Math.min(12, expected.size));
      for (const option of options) assert.equal(option.count, expected.get(option.value));
      for (const option of options) assert.equal(option.count, kb.queryCatalog({ filters: toggleFilter(filters, group, option.value), mode }).total);
    }
    assert.deepEqual(kb.suggestFacet({ group: 'cast', query: '不存在的演员' }), []);
  } finally { kb.close(); }
});
