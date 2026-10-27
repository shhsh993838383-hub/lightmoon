import { catalogOrder, catalogWhere, normalizeFilters, facetSuggestionQuery } from '../server/catalog-query.mjs';
import { movieDocument, tokenize } from '../server/knowledge-document.mjs';
import { mergeCatalog } from '../server/catalog-merge.mjs';
import { facets, toggleFilter } from '../src/lib/catalog.js';
import seeds from '../src/data/movies.json' with { type: 'json' };

export function createD1KnowledgeBase(db) {
  const prepared = (sql, params = []) => params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const all = async (sql, params = []) => (await prepared(sql, params).all()).results;
  const first = (sql, params = []) => prepared(sql, params).first();
  let cachedStats;
  async function stats() {
    if (cachedStats && Date.now() - cachedStats.at < 30000) return cachedStats.value;
    const counts = await first('SELECT COUNT(*) AS movieCount, COUNT(tmdb_id) AS tmdbCount, SUM(curated) AS curatedCount FROM movies');
    const metadata = Object.fromEntries((await all('SELECT key, value FROM metadata')).map(row => [row.key, row.value]));
    const value = { ...counts, index: 'd1-fts5', storage: 'cloud', catalogUpdatedAt: metadata.catalogUpdatedAt, indexedAt: metadata.indexedAt };
    cachedStats = { at: Date.now(), value };
    return value;
  }
  async function search(query, limit = 30, { allTokens = false } = {}) {
    const tokens = [...new Set(tokenize(query))].slice(0, 80);
    if (!tokens.length) return [];
    const expression = tokens.map(token => '"' + token.replaceAll('"', '""') + '"').join(allTokens ? ' AND ' : ' OR ');
    return all('SELECT movie_id AS id, bm25(movie_search) AS score FROM movie_search WHERE movie_search MATCH ? ORDER BY score LIMIT ?', [expression, Math.max(1, Math.min(2000, limit))]);
  }
  async function queryCatalog(options = {}) {
    const searchIds = options.query?.trim() ? (await search(options.query.trim().slice(0, 160), 2000, { allTokens: true })).map(hit => hit.id) : undefined;
    const input = { ...options, searchIds, dialect: 'd1' };
    const where = catalogWhere(input);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(options.limit) || 40)));
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    const count = await first('SELECT COUNT(*) AS total FROM movies m' + where.sql, where.params);
    const order = catalogOrder(options, 'd1');
    const rows = await all('SELECT m.data FROM movies m' + where.sql + ' ORDER BY ' + order.sql + ' LIMIT ? OFFSET ?', [...where.params, ...order.params, limit, offset]);
    let facetCounts;
    if (options.facets) {
      const filters = normalizeFilters(options.filters);
      const global = !searchIds && !options.ids && !options.preferences && Object.values(filters).every(values => values.length === 0);
      if (global) {
        const cached = await first("SELECT value FROM metadata WHERE key = 'facetCounts'");
        if (cached) facetCounts = JSON.parse(cached.value);
      }
      if (!facetCounts) {
      const entries = [], groups = [];
      let queries = [], params = [];
      const flush = () => { if (queries.length) groups.push(prepared('SELECT ' + queries.join(', ') + ' FROM movies m', params)); queries = []; params = []; };
      for (const facet of facets) for (const value of facet.options) {
        const clause = catalogWhere({ ...input, filters: toggleFilter(filters, facet.id, value) });
        if (params.length + clause.params.length > 90 || queries.length >= 8) flush();
        queries.push('COALESCE(SUM(CASE WHEN ' + (clause.sql ? clause.sql.slice(7) : '1') + ' THEN 1 ELSE 0 END),0) AS c' + entries.length);
        params.push(...clause.params); entries.push([facet.id, value]);
      }
      flush();
      facetCounts = Object.fromEntries(facets.map(facet => [facet.id, {}]));
      const result = groups.length ? await db.batch(groups) : [];
      for (const row of result.flatMap(item => item.results)) for (const [key, count] of Object.entries(row)) { const [group, value] = entries[Number(key.slice(1))]; facetCounts[group][value] = count; }
      if (global) await setMetadata('facetCounts', JSON.stringify(facetCounts));
      }
    }
    return { movies: rows.map(row => JSON.parse(row.data)), total: count.total, limit, offset, ...(facetCounts ? { facetCounts } : {}) };
  }
  async function suggestFacet(options) {
    const searchIds = options.search ? (await search(options.search, 2000, { allTokens: true })).map(hit => hit.id) : undefined;
    const { sql, params, current } = facetSuggestionQuery({ ...options, searchIds }, 'd1');
    const total = current ? (await first('SELECT COUNT(*) AS count FROM movies m' + current.sql, current.params)).count : 0;
    return (await all(sql, params)).map(row => ({ value: row.value, count: row.count + total }));
  }
  async function getMovie(id) { const row = await first('SELECT data FROM movies WHERE id = ?', [id]); return row ? JSON.parse(row.data) : null; }
  async function getByTmdb(id) { const row = await first('SELECT data FROM movies WHERE tmdb_id = ?', [id]); return row ? JSON.parse(row.data) : null; }
  async function setMetadata(key, value) { await prepared('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]).run(); }
  async function upsertImported(movies) {
    if (!movies.length) return;
    const old = await all('SELECT data FROM movies WHERE tmdb_id IN (SELECT value FROM json_each(?))', [JSON.stringify(movies.map(movie => movie.tmdbId))]);
    const existing = new Map(old.map(row => { const movie = JSON.parse(row.data); return [movie.tmdbId, movie]; }));
    const statements = [];
    for (const incoming of movies) {
      const movie = mergeCatalog(seeds, [{ ...existing.get(incoming.tmdbId), ...incoming }]).find(item => item.tmdbId === incoming.tmdbId);
      if (!movie) {
        const previous = existing.get(incoming.tmdbId);
        if (previous) statements.push(prepared('DELETE FROM movie_search WHERE movie_id = ?', [previous.id]), prepared('DELETE FROM movie_tags WHERE movie_id = ?', [previous.id]), prepared('DELETE FROM movies WHERE id = ?', [previous.id]));
        continue;
      }
      const document = movieDocument(movie);
      statements.push(prepared(`INSERT INTO movies(id,data,document,tmdb_id,year,minutes,rating,votes,curated) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,document=excluded.document,tmdb_id=excluded.tmdb_id,year=excluded.year,minutes=excluded.minutes,rating=excluded.rating,votes=excluded.votes,curated=excluded.curated`, [movie.id, JSON.stringify(movie), document, movie.tmdbId, movie.year, movie.minutes, movie.tmdbRating?.average ?? null, movie.tmdbRating?.votes ?? null, movie.tagStatus === 'tmdb-unreviewed' ? 0 : 1]));
      statements.push(prepared('INSERT OR REPLACE INTO movie_search(rowid,movie_id,tokens) SELECT rowid,id,? FROM movies WHERE id=?', [tokenize(document).join(' '), movie.id]));
    }
    if (statements.length) await db.batch(statements);
    cachedStats = null;
    await prepared("DELETE FROM metadata WHERE key = 'facetCounts'").run();
    await setMetadata('catalogUpdatedAt', new Date().toISOString());
  }
  return {
    stats, search, queryCatalog, suggestFacet, getMovie, getByTmdb, upsertImported, setMetadata,
    getMetadata: async key => (await first('SELECT value FROM metadata WHERE key = ?', [key]))?.value ?? null,
    async preferenceMovies(messages) {
      const hits = await search(messages.map(message => message.content).join(' '), 150);
      const base = (await queryCatalog({ limit: 30 })).movies;
      const matched = hits.length ? (await queryCatalog({ ids: hits.map(hit => hit.id), limit: 150 })).movies : [];
      return [...new Map([...base, ...matched].map(movie => [movie.id, movie])).values()];
    },
    selectForPreferences: async preferences => (await queryCatalog({ preferences, limit: 150 })).movies,
    async consumeRateLimit(key, limit = 24, windowSeconds = 60) {
      const now = Math.floor(Date.now() / 1000);
      const row = await first(`INSERT INTO request_limits(key,requests,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET requests=CASE WHEN request_limits.expires_at <= ? THEN 1 ELSE request_limits.requests+1 END, expires_at=CASE WHEN request_limits.expires_at <= ? THEN excluded.expires_at ELSE request_limits.expires_at END RETURNING requests`, [key, now + windowSeconds, now, now]);
      return row.requests <= limit;
    },
    close() {},
  };
}
