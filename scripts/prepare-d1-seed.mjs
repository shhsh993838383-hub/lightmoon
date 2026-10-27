import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { movieDocument, tokenize } from '../server/knowledge-document.mjs';
import { facets, matchesFilters } from '../src/lib/catalog.js';
import { mergeCatalog } from '../server/catalog-merge.mjs';

const input = JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8'));
const movies = mergeCatalog(JSON.parse(readFileSync('src/data/movies.json', 'utf8')), input);
const quote = value => value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const statements = [];
for (const movie of movies) {
  const document = movieDocument(movie);
  statements.push(`INSERT INTO movies(id,data,document,tmdb_id,year,minutes,rating,votes,curated) VALUES (${[movie.id, JSON.stringify(movie), document, movie.tmdbId, movie.year, movie.minutes, movie.tmdbRating?.average, movie.tmdbRating?.votes, movie.tagStatus === 'tmdb-unreviewed' ? 0 : 1].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=json_patch(movies.data,excluded.data),document=excluded.document,tmdb_id=excluded.tmdb_id,year=excluded.year,minutes=excluded.minutes,rating=excluded.rating,votes=excluded.votes,curated=excluded.curated;`);
  statements.push(`DELETE FROM movie_search WHERE movie_id=${quote(movie.id)};`, `INSERT INTO movie_search(movie_id,tokens) VALUES (${quote(movie.id)},${quote(tokenize(document).join(' '))});`);
}
const now = new Date().toISOString();
const facetCounts = Object.fromEntries(facets.map(facet => [facet.id, Object.fromEntries(facet.options.map(value => [value, movies.filter(movie => matchesFilters(movie, { [facet.id]: [value] })).length]))]));
for (const [key, value] of Object.entries({ catalogUpdatedAt: now, indexedAt: now, seedHash: createHash('sha256').update(JSON.stringify(movies)).digest('hex'), facetCounts: JSON.stringify(facetCounts) })) statements.push(`INSERT INTO metadata(key,value) VALUES (${quote(key)},${quote(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
mkdirSync('.data', { recursive: true });
writeFileSync('.data/cloudflare-seed.sql', statements.join('\n') + '\n');
console.log(JSON.stringify({ movies: movies.length, statements: statements.length, path: '.data/cloudflare-seed.sql' }));
