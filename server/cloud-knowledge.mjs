import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogPath, mergeCatalog, projectRoot } from './catalog-store.mjs';
import { catalogSort, catalogWhere, normalizeFilters } from './catalog-query.mjs';
import { movieDocument, tokenize } from './knowledge-document.mjs';
import { facets, toggleFilter } from '../src/lib/catalog.js';

// The executor is injectable so the PostgreSQL queries can also run against PGlite in tests.
export function createCloudKnowledgeBase({ url = process.env.DATABASE_URL, query, seeds = JSON.parse(readFileSync(catalogPath, 'utf8')), initialMovies } = {}) {
  if (!query && !url) throw new Error('DATABASE_URL is required for cloud storage.');
  const sql = query ? null : neon(url);
  const run = query || ((statement, parameters = []) => sql.query(statement, parameters));
  let ready, cachedStats;
  const seedFile = resolve(projectRoot, 'server/data/initial-catalog.json');
  initialMovies ??= existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, 'utf8')) : [];
  const initial = mergeCatalog(seeds, initialMovies);
  const parameterize = statement => { let index = 0; return statement.replaceAll('?', () => '$' + ++index); };
  const execute = (statement, parameters = []) => run(parameterize(statement), parameters);
  async function getMetadata(key) {
    const rows = await execute('SELECT value FROM metadata WHERE key = ?', [key]);
    return rows[0]?.value ?? null;
  }
  async function setMetadata(key, value) {
    await execute('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  }
  async function writeMovies(movies) {
    if (!movies.length) return;
    const records = movies.map(movie => {
      const document = movieDocument(movie);
      return { id: movie.id, data: movie, document, tokens: tokenize(document).join(' '), tmdb_id: movie.tmdbId ?? null, year: movie.year ?? null, minutes: movie.minutes ?? null, rating: movie.tmdbRating?.average ?? null, votes: movie.tmdbRating?.votes ?? null, curated: movie.tagStatus === 'tmdb-unreviewed' ? 0 : 1 };
    });
    await execute(`INSERT INTO movies(id, data, document, tokens, tmdb_id, year, minutes, rating, votes, curated)
      SELECT id, data, document, to_tsvector('simple', tokens), tmdb_id, year, minutes, rating, votes, curated
      FROM jsonb_to_recordset(?::jsonb) AS x(id TEXT, data JSONB, document TEXT, tokens TEXT, tmdb_id BIGINT, year INTEGER, minutes INTEGER, rating REAL, votes INTEGER, curated INTEGER)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, document=excluded.document, tokens=excluded.tokens, tmdb_id=excluded.tmdb_id, year=excluded.year, minutes=excluded.minutes, rating=excluded.rating, votes=excluded.votes, curated=excluded.curated`, [JSON.stringify(records)]);
    cachedStats = null;
  }
  function initialize() {
    return ready ||= (async () => {
      for (const statement of [
        'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        `CREATE TABLE IF NOT EXISTS movies (id TEXT PRIMARY KEY, sequence BIGSERIAL UNIQUE, document TEXT NOT NULL, data JSONB NOT NULL, tokens TSVECTOR NOT NULL, tmdb_id BIGINT UNIQUE, year INTEGER, minutes INTEGER, rating REAL, votes INTEGER, curated INTEGER NOT NULL DEFAULT 0)`,
        'CREATE INDEX IF NOT EXISTS movies_tokens ON movies USING GIN(tokens)',
        'CREATE INDEX IF NOT EXISTS movies_tags ON movies USING GIN(data jsonb_path_ops)',
        'CREATE INDEX IF NOT EXISTS movies_year ON movies(year)',
        'CREATE INDEX IF NOT EXISTS movies_minutes ON movies(minutes)',
        'CREATE INDEX IF NOT EXISTS movies_curated ON movies(curated, sequence)',
        'CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, requests INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)',
      ]) await run(statement);
      const signature = createHash('sha256').update(JSON.stringify(initial)).digest('hex');
      if (await getMetadata('seedHash') !== signature) {
        const previous = await execute('SELECT data FROM movies WHERE id = ANY(?::text[])', [initial.map(movie => movie.id)]);
        const byId = new Map(previous.map(row => [row.data.id, row.data]));
        await writeMovies(initial.map(movie => {
          const old = byId.get(movie.id);
          return old?.tmdbId ? mergeCatalog([movie], [old])[0] : movie;
        }));
        await setMetadata('seedHash', signature);
        await setMetadata('indexedAt', new Date().toISOString());
      }
    })().catch(error => { ready = null; throw error; });
  }
  async function stats() {
    await initialize();
    if (cachedStats && Date.now() - cachedStats.at < 30000) return cachedStats.value;
    const [row] = await run('SELECT COUNT(*)::integer AS "movieCount", COUNT(tmdb_id)::integer AS "tmdbCount", COALESCE(SUM(curated),0)::integer AS "curatedCount" FROM movies');
    const value = { ...row, index: 'postgres-fulltext', storage: 'cloud', catalogUpdatedAt: await getMetadata('catalogUpdatedAt'), indexedAt: await getMetadata('indexedAt') };
    cachedStats = { at: Date.now(), value };
    return value;
  }
  async function search(query, limit = 30) {
    await initialize();
    const tokens = [...new Set(tokenize(query))].slice(0, 80);
    if (!tokens.length) return [];
    const expression = tokens.map(token => "'" + token.replaceAll("'", "''") + "'").join(' | ');
    return execute("SELECT id, -ts_rank(tokens, to_tsquery('simple', ?)) AS score FROM movies WHERE tokens @@ to_tsquery('simple', ?) ORDER BY score, sequence LIMIT ?", [expression, expression, Math.max(1, Math.min(2000, limit))]);
  }
  async function queryCatalog(options = {}) {
    await initialize();
    const query = String(options.query || '').trim().slice(0, 160);
    const searchIds = query ? (await search(query, 2000)).map(hit => hit.id) : undefined;
    const input = { ...options, searchIds, dialect: 'postgres' };
    const where = catalogWhere(input);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 40));
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    const [count] = await execute('SELECT COUNT(*)::integer AS count FROM movies m' + where.sql, where.params);
    const rows = await execute('SELECT m.data FROM movies m' + where.sql + ' ORDER BY ' + catalogSort(options.sort, 'postgres') + ' LIMIT ? OFFSET ?', [...where.params, limit, offset]);
    let facetCounts;
    if (options.facets) {
      const filters = normalizeFilters(options.filters);
      const queries = [], params = [], entries = [];
      for (const facet of facets) for (const value of facet.options) {
        const toggled = catalogWhere({ ...input, filters: toggleFilter(filters, facet.id, value) });
        queries.push('SELECT ' + entries.length + ' AS facet_index, COUNT(*)::integer AS count FROM movies m' + toggled.sql);
        params.push(...toggled.params); entries.push([facet.id, value]);
      }
      const counts = await execute(queries.join(' UNION ALL '), params);
      facetCounts = Object.fromEntries(facets.map(facet => [facet.id, {}]));
      for (const row of counts) { const [group, tag] = entries[row.facet_index]; facetCounts[group][tag] = row.count; }
    }
    return { movies: rows.map(row => row.data), total: count.count, limit, offset, ...(facetCounts ? { facetCounts } : {}) };
  }
  async function getMovie(id) {
    await initialize();
    const rows = await execute('SELECT data FROM movies WHERE id = ?', [id]);
    return rows[0]?.data || null;
  }
  async function getByTmdb(id) {
    await initialize();
    const rows = await execute('SELECT data FROM movies WHERE tmdb_id = ?', [id]);
    return rows[0]?.data || null;
  }
  async function upsertImported(movies) {
    await initialize();
    const merged = movies.map(movie => mergeCatalog(seeds, [movie]).find(item => item.tmdbId === movie.tmdbId)).filter(Boolean);
    await writeMovies(merged);
    await setMetadata('catalogUpdatedAt', new Date().toISOString());
    await setMetadata('indexedAt', new Date().toISOString());
  }
  return {
    initialize, stats, search, queryCatalog, getMovie, getByTmdb, upsertImported,
    hasTmdb: async id => Boolean(await getByTmdb(id)),
    getMetadata: async key => { await initialize(); return getMetadata(key); },
    setMetadata: async (key, value) => { await initialize(); return setMetadata(key, value); },
    async preferenceMovies(messages) {
      const hits = await search(messages.map(message => message.content).join(' '), 200);
      const base = (await queryCatalog({ limit: 30 })).movies;
      const matches = hits.length ? (await queryCatalog({ ids: hits.map(hit => hit.id), limit: 200 })).movies : [];
      return [...new Map([...base, ...matches].map(movie => [movie.id, movie])).values()];
    },
    selectForPreferences: async preferences => (await queryCatalog({ preferences, limit: 200 })).movies,
    async consumeRateLimit(key, limit = 24) {
      await initialize();
      const [row] = await execute(`INSERT INTO request_limits(key, requests, expires_at) VALUES (?, 1, now() + interval '1 minute')
        ON CONFLICT(key) DO UPDATE SET requests = CASE WHEN request_limits.expires_at <= now() THEN 1 ELSE request_limits.requests + 1 END,
        expires_at = CASE WHEN request_limits.expires_at <= now() THEN now() + interval '1 minute' ELSE request_limits.expires_at END RETURNING requests`, [key]);
      return row.requests <= limit;
    },
    async databaseSize() { const [row] = await run('SELECT pg_database_size(current_database())::float8 AS bytes'); return row.bytes; },
    close() {},
  };
}
