import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqliteD1Adapter } from '../sqlite-adapter.mjs';
import { createD1KnowledgeBase } from '../../workers/knowledge.mjs';
import { catalogWhere } from '../catalog-query.mjs';
import { facets, facetValues } from '../../src/lib/catalog.js';
import { facetFixtures } from './fixtures/facet-movies.mjs';

const migration = readFileSync('workers/migrations/0003_catalog_tag_index.sql', 'utf8');
function storage(t, { migrate = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0001_movies.sql', '0002_accounts_community.sql']) sql.exec(readFileSync('workers/migrations/' + file, 'utf8'));
  if (migrate) sql.exec(migration);
  t.after(() => sql.close());
  const adapter = sqliteD1Adapter(sql), queries = [];
  return { sql, queries, db: { ...adapter, prepare(statement) { queries.push(statement); return adapter.prepare(statement); } } };
}

test('D1 tag migration backfills existing films and tracks direct SQL imports, edits and deletion', t => {
  const { sql } = storage(t, { migrate: false });
  const film = { ...facetFixtures[0], director: '导演甲 / 导演乙', country: '中国大陆 / 法国', language: '汉语普通话 / 法语', cast: [{ name: '演员甲' }, { name: '演员甲' }, { name: '演员乙' }] };
  const insert = sql.prepare('INSERT INTO movies(id,data,document,year) VALUES (?,?,?,?)');
  insert.run(film.id, JSON.stringify(film), '', film.year);
  sql.prepare('INSERT INTO movie_tags(movie_id,facet,tag) VALUES (?,?,?)').run(film.id, 'director', '旧标签');
  sql.exec(migration);
  const values = () => sql.prepare('SELECT facet,tag FROM movie_tags WHERE movie_id=? ORDER BY facet,tag').all(film.id).map(row => [row.facet, row.tag]);
  const expected = movie => facets.filter(facet => !['duration', 'exclude'].includes(facet.id)).flatMap(facet => facetValues(movie, facet.id).map(tag => [facet.id, tag])).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  assert.deepEqual(values(), expected(film));
  const edited = { ...film, director: '新导演', cast: [{ name: '新演员' }], year: 2024 };
  sql.prepare('UPDATE movies SET data=?,year=? WHERE id=?').run(JSON.stringify(edited), edited.year, film.id);
  assert.deepEqual(values(), expected(edited));
  sql.prepare('DELETE FROM movies WHERE id=?').run(film.id);
  assert.deepEqual(values(), []);
});

test('D1 selective tag queries use the covering index and movie primary key', t => {
  const { sql } = storage(t);
  const where = catalogWhere({ dialect: 'd1', filters: { director: ['导演甲'] } });
  const plan = sql.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) AS total FROM movies m' + where.sql).all(...where.params).map(row => row.detail).join('\n');
  assert.match(plan, /SEARCH movie_tags USING COVERING INDEX movie_tags_lookup/);
  assert.match(plan, /SEARCH m USING COVERING INDEX/);
  assert.doesNotMatch(plan, /SCAN m\b/);
});

test('D1 deployment works before backfill and activates indexed queries only after migration', async t => {
  const { db, sql, queries } = storage(t, { migrate: false });
  let time = 0;
  const kb = createD1KnowledgeBase(db, { now: () => time });
  await kb.upsertImported(facetFixtures);
  const options = { filters: { country: ['中国大陆'] }, facets: true };
  const before = await kb.queryCatalog(options);
  assert.ok(before.total > 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM movie_tags').get().total, 0);
  const suggestions = await kb.suggestFacet({ group: 'cast', filters: options.filters });
  assert.ok(suggestions.length > 0);
  sql.exec(migration);
  time = 30001; queries.length = 0;
  const after = await kb.queryCatalog(options);
  assert.deepEqual(after, before);
  assert.deepEqual(await kb.suggestFacet({ group: 'cast', filters: options.filters }), suggestions);
  assert.ok(queries.some(statement => statement.includes('movie_tags')));
  assert.ok(queries.every(statement => !statement.includes('json_extract(m.data')));
});

test('D1 caches public totals and suggestions, expires despite repeated reads, and invalidates after imports', async t => {
  const { db, queries } = storage(t);
  let time = 0;
  const kb = createD1KnowledgeBase(db, { now: () => time });
  await kb.upsertImported(facetFixtures);
  const options = { filters: { director: ['导演甲'] }, facets: true };
  const first = await kb.queryCatalog(options);
  assert.ok(first.total > 0);
  queries.length = 0;
  for (const next of [10000, 20000]) {
    time = next;
    const repeated = await kb.queryCatalog(options);
    assert.equal(repeated.total, first.total);
    assert.deepEqual(repeated.facetCounts, first.facetCounts);
  }
  assert.equal(queries.length, 2, 'repeated pages only fetch visible film records and live rating totals');
  assert.ok(queries.every(statement => statement.startsWith('SELECT m.data, rt.score_sum')));
  time = 30001; queries.length = 0;
  await kb.queryCatalog(options);
  assert.ok(queries.some(statement => statement.includes('COUNT(*) AS total')), 'traffic must not extend cached counts indefinitely');

  const suggestion = { group: 'cast', filters: {} };
  const before = await kb.suggestFacet(suggestion);
  queries.length = 0;
  assert.deepEqual(await kb.suggestFacet(suggestion), before);
  assert.equal(queries.length, 0);
  await kb.upsertImported([{ ...facetFixtures[0], id: 'tmdb-999004', tmdbId: 999004, title: '新导入的影片' }]);
  assert.equal((await kb.queryCatalog(options)).total, first.total + 1);
  assert.notDeepEqual(await kb.suggestFacet(suggestion), before);
});

test('D1 aggregate caches never serve stale community ratings', async t => {
  const { db } = storage(t);
  const kb = createD1KnowledgeBase(db);
  await kb.upsertImported(facetFixtures);
  const options = { ids: [facetFixtures[0].id], facets: true };
  assert.equal((await kb.queryCatalog(options)).movies[0].lightmoonRating.votes, 0);
  const account = await kb.accounts.register({ email: 'efficiency@example.invalid', password: 'six123' });
  await kb.accounts.rate(facetFixtures[0].id, account.user.id, 9);
  const result = await kb.queryCatalog(options);
  assert.deepEqual(result.movies[0].lightmoonRating, { average: 9, votes: 1 });
});
