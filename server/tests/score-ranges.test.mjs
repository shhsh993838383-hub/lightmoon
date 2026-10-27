import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import { emptyFilters, matchesFilters, facetSuggestions } from '../../src/lib/catalog.js';
import { scoreFacets, parseScoreRange } from '../../src/lib/score-ranges.js';
import { catalogWhere, normalizeFilters, facetSuggestionQuery } from '../catalog-query.mjs';
import { facetFixtures } from './fixtures/facet-movies.mjs';

const scores = [
  [6, 6, { critics: { score: 60 } }],
  [8, 8, { critics: { score: 80 } }],
  [9.1, 9, { critics: { score: 90 } }],
  [8.5, null, { audience: { score: 95 } }],
  [8.2, '8', { critics: { score: 0 } }],
  [null, 8, { critics: { score: 80 } }],
];
const movies = scores.map(([tmdb, douban, rottenTomatoesRating], index) => ({
  ...facetFixtures[index % 3], id: 'score-' + index,
  tmdbRating: { average: tmdb }, doubanRating: { average: douban }, rottenTomatoesRating,
}));

test('score ranges validate limits, precision and unsupported input', () => {
  for (const facet of scoreFacets) {
    assert.deepEqual(parseScoreRange(facet, '0:' + facet.maximum), { min: 0, max: facet.maximum });
    for (const invalid of ['8:6', '-1:8', '0:101', 'NaN:10', '6:10 OR 1=1', '', '6.12:9']) assert.equal(parseScoreRange(facet, invalid), null);
  }
  assert.equal(parseScoreRange(scoreFacets[2], '60.5:90'), null);
  assert.deepEqual(normalizeFilters({ tmdbScore: ['8:9', '6:10'], doubanScore: ['10:6'], rottenTomatoesScore: ['60:100'] }), { ...emptyFilters(), tmdbScore: ['8:9'], rottenTomatoesScore: ['60:100'] });
  assert.deepEqual(movies.filter(movie => matchesFilters(movie, { rottenTomatoesScore: ['0:0'] })).map(movie => movie.id), ['score-4']);
  assert.deepEqual(movies.filter(movie => matchesFilters(movie, { doubanScore: ['8:8'] })).map(movie => movie.id), ['score-1', 'score-5']);
});

test('browser, SQLite, D1 and PostgreSQL agree on inclusive score ranges, combinations and pagination', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync('workers/migrations/0001_movies.sql', 'utf8'));
  sqlite.exec(readFileSync('workers/migrations/0003_catalog_tag_index.sql', 'utf8'));
  for (const movie of movies) sqlite.prepare('INSERT INTO movies(id,data,document,year,rating) VALUES (?,?,?,?,?)').run(movie.id, JSON.stringify(movie), '', movie.year, movie.tmdbRating.average);
  const postgres = new PGlite();
  t.after(() => postgres.close());
  await postgres.exec('CREATE TABLE movies(id TEXT PRIMARY KEY,data JSONB,year INTEGER,rating REAL)');
  for (const movie of movies) await postgres.query('INSERT INTO movies(id,data,year,rating) VALUES ($1,$2,$3,$4)', [movie.id, JSON.stringify(movie), movie.year, movie.tmdbRating.average]);
  const execute = async (dialect, sql, params) => {
    if (dialect !== 'postgres') return sqlite.prepare(sql).all(...params);
    let index = 0;
    return (await postgres.query(sql.replaceAll('?', () => '$' + ++index), params)).rows;
  };
  const cases = [
    { tmdbScore: ['6:8'] }, { tmdbScore: ['8:8'] }, { doubanScore: ['6:8'] },
    { doubanScore: ['8:8'] }, { rottenTomatoesScore: ['60:80'] }, { rottenTomatoesScore: ['0:0'] },
    { tmdbScore: ['6:10'], doubanScore: ['6:10'], rottenTomatoesScore: ['60:100'] },
    { tmdbScore: ['8:9'], genre: ['喜剧'], director: ['导演甲'] },
    { rottenTomatoesScore: ['60:90'], cast: ['演员甲', '演员乙'] },
  ];
  for (const mode of ['any', 'all']) for (const dialect of ['sqlite', 'd1', 'postgres']) for (const indexedTags of dialect === 'd1' ? [true, false] : [true]) for (const selected of cases) {
    const filters = { ...emptyFilters(), ...selected };
    const ids = movies.slice(0, 5).map(movie => movie.id);
    const expected = movies.filter(movie => ids.includes(movie.id) && matchesFilters(movie, filters, mode)).map(movie => movie.id).sort();
    const where = catalogWhere({ filters, mode, ids, dialect, indexedTags });
    const actual = await execute(dialect, 'SELECT m.id FROM movies m' + where.sql + ' ORDER BY m.id', where.params);
    assert.deepEqual(actual.map(movie => movie.id), expected, JSON.stringify({ mode, dialect, indexedTags, filters }));
    const page = await execute(dialect, 'SELECT m.id FROM movies m' + where.sql + ' ORDER BY m.id LIMIT 1 OFFSET 1', where.params);
    assert.deepEqual(page.map(movie => movie.id), expected.slice(1, 2));
    const suggestion = facetSuggestionQuery({ group: 'director', filters, mode, ids, indexedTags }, dialect);
    const options = await execute(dialect, suggestion.sql, suggestion.params);
    const current = suggestion.current ? Number((await execute(dialect, 'SELECT COUNT(*) AS count FROM movies m' + suggestion.current.sql, suggestion.current.params))[0].count) : 0;
    const expectedSuggestions = facetSuggestions(movies.filter(movie => ids.includes(movie.id)), { group: 'director', filters, mode });
    assert.deepEqual(Object.fromEntries(options.map(row => [row.value, Number(row.count) + current])), Object.fromEntries(expectedSuggestions.map(row => [row.value, row.count])));
  }
});
