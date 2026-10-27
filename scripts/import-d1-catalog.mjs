import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createD1Api } from './cloudflare-d1-api.mjs';
import { mergeCatalog } from '../server/catalog-merge.mjs';
import { movieDocument, tokenize } from '../server/knowledge-document.mjs';
import { facets, matchesFilters } from '../src/lib/catalog.js';
import { ratingPolicy } from '../src/lib/rating-policy.js';

const seeds = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const movies = mergeCatalog(seeds, JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8')));
const query = createD1Api();
const hash = createHash('sha256').update(JSON.stringify(movies)).digest('hex');
const quote = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const progressPath = '.data/d1-import-progress.json';
let rowsWritten = 0, rowsRead = 0;
const execute = async sql => {
  const result = await query(sql);
  for (const item of result) { rowsWritten += item.meta?.rows_written || 0; rowsRead += item.meta?.rows_read || 0; }
  return result;
};
const completed = new Set((await execute("SELECT key FROM metadata WHERE key LIKE 'seedBatch:" + hash + ":%'"))[0].results.map(row => row.key));
const recordSql = movie => {
  const document = movieDocument(movie);
  return {
    data: '(' + [movie.id, JSON.stringify(movie), document, movie.tmdbId, movie.year, movie.minutes, movie.tmdbRating?.average, movie.tmdbRating?.votes, movie.tagStatus === 'tmdb-unreviewed' ? 0 : 1].map(quote).join(',') + ')',
    search: '(' + [`(SELECT rowid FROM movies WHERE id=${quote(movie.id)})`, quote(movie.id), quote(tokenize(document).join(' '))].join(',') + ')',
  };
};
const chunks = [];
let chunk = [], size = 0;
for (const movie of movies) {
  const row = recordSql(movie), bytes = Buffer.byteLength(row.data + row.search, 'utf8');
  if (chunk.length && (size + bytes > 82000 || chunk.length >= 20)) { chunks.push(chunk); chunk = []; size = 0; }
  chunk.push(row); size += bytes;
}
if (chunk.length) chunks.push(chunk);
mkdirSync('.data', { recursive: true });
for (let index = 0; index < chunks.length; index++) {
  const name = `seedBatch:${hash}:${index}`, rows = chunks[index];
  if (!completed.has(name)) {
    if (rowsWritten > 90000) throw new Error('本次导入写入量已接近 D1 免费每日额度，进度已保留。');
    const sql = 'INSERT INTO movies(id,data,document,tmdb_id,year,minutes,rating,votes,curated) VALUES ' + rows.map(row => row.data).join(',') + ' ON CONFLICT(id) DO UPDATE SET data=excluded.data,document=excluded.document,tmdb_id=excluded.tmdb_id,year=excluded.year,minutes=excluded.minutes,rating=excluded.rating,votes=excluded.votes,curated=excluded.curated;\n'
      + 'INSERT OR REPLACE INTO movie_search(rowid,movie_id,tokens) VALUES ' + rows.map(row => row.search).join(',') + ';\n'
      + `INSERT OR REPLACE INTO metadata(key,value) VALUES (${quote(name)},'complete');`;
    await execute(sql);
  }
  const progress = { hash, batch: index + 1, totalBatches: chunks.length, movies: movies.length, rowsWritten, rowsRead, updatedAt: new Date().toISOString() };
  writeFileSync(progressPath + '.tmp', JSON.stringify(progress, null, 2)); renameSync(progressPath + '.tmp', progressPath);
  if (index % 25 === 0 || index + 1 === chunks.length) console.log(JSON.stringify(progress));
}
const now = new Date().toISOString();
const facetCounts = Object.fromEntries(facets.map(facet => [facet.id, Object.fromEntries(facet.options.map(value => [value, movies.filter(movie => matchesFilters(movie, { [facet.id]: [value] })).length]))]));
const metadata = { seedHash: hash, catalogUpdatedAt: now, indexedAt: now, ratingPolicyVersion: ratingPolicy.version, facetCounts: JSON.stringify(facetCounts) };
await execute('INSERT OR REPLACE INTO metadata(key,value) VALUES ' + Object.entries(metadata).map(([key, value]) => '(' + [key, value].map(quote).join(',') + ')').join(',') + ';');
const status = (await execute('SELECT COUNT(*) AS movieCount,COUNT(DISTINCT tmdb_id) AS tmdbCount FROM movies;SELECT COUNT(*) AS indexedCount,COUNT(DISTINCT movie_id) AS uniqueIndexedCount FROM movie_search;')).map(item => item.results[0]);
if (status[0].movieCount !== movies.length || status[0].tmdbCount !== movies.length || status[1].indexedCount !== movies.length || status[1].uniqueIndexedCount !== movies.length) throw new Error('D1 导入后的数量或索引校验失败。');
console.log(JSON.stringify({ success: true, ...status[0], ...status[1], rowsWritten, rowsRead }));
