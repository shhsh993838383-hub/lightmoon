import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { catalogPath, mergeCatalog, projectRoot, readTmdbCatalog, tmdbCatalogPath } from './catalog-store.mjs';
import { catalogSort, catalogWhere, normalizeFilters } from './catalog-query.mjs';
import { facets, toggleFilter } from '../src/lib/catalog.js';

export { projectRoot, catalogPath };
export const knowledgeDatabasePath = resolve(projectRoot, '.data/knowledge.sqlite');

export function tokenize(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  const words = normalized.match(/[a-z0-9]+/g) || [];
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) words.push(run);
    for (let index = 0; index < run.length - 1; index++) words.push(run.slice(index, index + 2));
  }
  return words;
}

const movieDocument = movie => [movie.title, movie.originalTitle, ...(movie.aliases || []), movie.director, ...(movie.cast || []).map(person => person.name), ...(movie.keywords || []), movie.year || '', movie.minutes ? `${movie.minutes} 分钟` : '', movie.country, movie.language, ...movie.genre, ...movie.mood, ...movie.theme, ...movie.pace, ...movie.structure, movie.text].join('。');

export function createKnowledgeBase({ dbPath = knowledgeDatabasePath, sourcePath = catalogPath, importedPath = sourcePath === catalogPath ? tmdbCatalogPath : null } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS movies (id TEXT PRIMARY KEY, document TEXT NOT NULL, data TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS movie_search USING fts5(movie_id UNINDEXED, tokens, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS movie_tags (movie_id TEXT, facet TEXT, tag TEXT, PRIMARY KEY(movie_id, facet, tag)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS movie_tags_lookup ON movie_tags(facet, tag, movie_id);`);
  const columns = new Set(db.prepare('PRAGMA table_info(movies)').all().map(column => column.name));
  for (const [name, type] of Object.entries({ tmdb_id: 'INTEGER', year: 'INTEGER', minutes: 'INTEGER', rating: 'REAL', votes: 'INTEGER', curated: 'INTEGER NOT NULL DEFAULT 0' })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE movies ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS movies_tmdb ON movies(tmdb_id); CREATE INDEX IF NOT EXISTS movies_year ON movies(year); CREATE INDEX IF NOT EXISTS movies_minutes ON movies(minutes); CREATE INDEX IF NOT EXISTS movies_curated ON movies(curated);');
  const putMetadata = db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)');
  const getMetadata = name => db.prepare('SELECT value FROM metadata WHERE key = ?').get(name)?.value;
  const putMovie = db.prepare(`INSERT INTO movies(id, document, data, tmdb_id, year, minutes, rating, votes, curated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET document=excluded.document, data=excluded.data, tmdb_id=excluded.tmdb_id, year=excluded.year, minutes=excluded.minutes, rating=excluded.rating, votes=excluded.votes, curated=excluded.curated`);
  const putSearch = db.prepare('INSERT INTO movie_search(rowid, movie_id, tokens) VALUES (?, ?, ?)');
  const putTag = db.prepare('INSERT OR IGNORE INTO movie_tags(movie_id, facet, tag) VALUES (?, ?, ?)');
  const deleteSearch = db.prepare('DELETE FROM movie_search WHERE rowid = ?');
  const deleteTags = db.prepare('DELETE FROM movie_tags WHERE movie_id = ?');
  let signature, seeds = [], closed = false;
  const transaction = callback => { db.exec('BEGIN IMMEDIATE'); try { callback(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } };
  function upsert(movie) {
    const previous = db.prepare('SELECT rowid FROM movies WHERE id = ?').get(movie.id);
    if (previous) deleteSearch.run(previous.rowid);
    const document = movieDocument(movie);
    putMovie.run(movie.id, document, JSON.stringify(movie), movie.tmdbId ?? null, movie.year ?? null, movie.minutes ?? null, movie.tmdbRating?.average ?? null, movie.tmdbRating?.votes ?? null, movie.tagStatus === 'tmdb-unreviewed' ? 0 : 1);
    const row = db.prepare('SELECT rowid FROM movies WHERE id = ?').get(movie.id);
    putSearch.run(row.rowid, movie.id, tokenize(document).join(' '));
    deleteTags.run(movie.id);
    for (const group of ['genre', 'mood', 'theme', 'pace', 'structure']) for (const tag of movie[group] || []) putTag.run(movie.id, group, tag);
  }
  function upsertImported(movies) {
    transaction(() => {
      for (const movie of movies) {
        const merged = mergeCatalog(seeds, [movie]).find(item => item.tmdbId === movie.tmdbId);
        if (merged) upsert(merged);
      }
      putMetadata.run('catalogUpdatedAt', new Date().toISOString());
      putMetadata.run('indexedAt', new Date().toISOString());
    });
  }
  const stamp = path => { if (!path || !existsSync(path)) return 'missing'; const stat = statSync(path); return `${stat.mtimeMs}:${stat.size}`; };
  function refresh() {
    const nextSignature = `${stamp(sourcePath)}|${stamp(importedPath)}`;
    if (signature === nextSignature) return;
    const source = readFileSync(sourcePath, 'utf8');
    seeds = JSON.parse(source);
    const seedHash = createHash('sha256').update(source).digest('hex');
    if (getMetadata('catalogSchema') !== '3') {
      const oldMovies = db.prepare('SELECT data FROM movies ORDER BY rowid').all().map(row => JSON.parse(row.data));
      transaction(() => {
        db.exec('DELETE FROM movie_search; DELETE FROM movie_tags;');
        for (const movie of oldMovies) upsert(movie);
        putMetadata.run('catalogSchema', '3');
      });
    }
    if (getMetadata('seedHash') !== seedHash) transaction(() => {
      for (const seed of seeds) {
        const old = db.prepare('SELECT data FROM movies WHERE id = ?').get(seed.id);
        const existing = old ? JSON.parse(old.data) : null;
        upsert(existing?.tmdbId ? mergeCatalog([seed], [existing])[0] : seed);
      }
      putMetadata.run('seedHash', seedHash); putMetadata.run('indexedAt', new Date().toISOString());
    });
    const imported = readTmdbCatalog(importedPath);
    const importHash = createHash('sha256').update(JSON.stringify(imported)).digest('hex');
    if (getMetadata('importHash') !== importHash) {
      upsertImported(imported.movies);
      putMetadata.run('importHash', importHash);
      if (imported.updatedAt) putMetadata.run('catalogUpdatedAt', imported.updatedAt);
    }
    signature = nextSignature;
  }
  refresh();
  const parseRows = rows => rows.map(row => JSON.parse(row.data));
  function search(query, limit = 30) {
    refresh();
    const tokens = [...new Set(tokenize(query))].slice(0, 80);
    if (!tokens.length) return [];
    const expression = tokens.map(token => '"' + token.replaceAll('"', '""') + '"').join(' OR ');
    return db.prepare('SELECT movie_id AS id, bm25(movie_search) AS score FROM movie_search WHERE movie_search MATCH ? ORDER BY score LIMIT ?').all(expression, limit);
  }
  function stats() {
    refresh();
    const row = db.prepare('SELECT COUNT(*) AS movieCount, COUNT(tmdb_id) AS tmdbCount, SUM(curated) AS curatedCount FROM movies').get();
    return { ...row, curatedCount: row.curatedCount || 0, catalogUpdatedAt: getMetadata('catalogUpdatedAt') || null, indexedAt: getMetadata('indexedAt'), index: 'sqlite-fts5' };
  }
  function queryCatalog(options = {}) {
    refresh();
    const query = String(options.query || '').trim().slice(0, 160);
    const searchIds = query ? search(query, 2000).map(hit => hit.id) : undefined;
    const input = { ...options, searchIds };
    const where = catalogWhere(input);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 40));
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    const total = db.prepare('SELECT COUNT(*) AS count FROM movies m' + where.sql).get(...where.params).count;
    const movies = parseRows(db.prepare('SELECT m.data FROM movies m' + where.sql + ' ORDER BY ' + catalogSort(options.sort) + ' LIMIT ? OFFSET ?').all(...where.params, limit, offset));
    let facetCounts;
    if (options.facets) {
      const filters = normalizeFilters(options.filters);
      facetCounts = Object.fromEntries(facets.map(facet => [facet.id, Object.fromEntries(facet.options.map(value => {
        const toggled = catalogWhere({ ...input, filters: toggleFilter(filters, facet.id, value) });
        return [value, db.prepare('SELECT COUNT(*) AS count FROM movies m' + toggled.sql).get(...toggled.params).count];
      }))]));
    }
    return { movies, total, limit, offset, ...(facetCounts ? { facetCounts } : {}) };
  }
  return {
    get movies() { refresh(); return parseRows(db.prepare('SELECT data FROM movies ORDER BY rowid').all()); },
    refresh, stats, search, queryCatalog, upsertImported,
    getMovie(id) { refresh(); const row = db.prepare('SELECT data FROM movies WHERE id = ?').get(id); return row ? JSON.parse(row.data) : null; },
    getByTmdb(id) { refresh(); const row = db.prepare('SELECT data FROM movies WHERE tmdb_id = ?').get(id); return row ? JSON.parse(row.data) : null; },
    hasTmdb(id) { return Boolean(db.prepare('SELECT 1 FROM movies WHERE tmdb_id = ?').get(id)); },
    preferenceMovies(messages) {
      const ids = search(messages.map(message => message.content).join(' '), 200).map(hit => hit.id);
      const base = queryCatalog({ limit: 30 }).movies;
      return [...new Map([...base, ...ids.map(id => { const row = db.prepare('SELECT data FROM movies WHERE id = ?').get(id); return row ? JSON.parse(row.data) : null; }).filter(Boolean)].map(movie => [movie.id, movie])).values()];
    },
    selectForPreferences(preferences) { return queryCatalog({ preferences, limit: 200 }).movies; },
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
