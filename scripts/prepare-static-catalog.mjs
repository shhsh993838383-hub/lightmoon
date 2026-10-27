import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mergeCatalog } from '../server/catalog-store.mjs';
const seeds = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const imported = existsSync('server/data/initial-catalog.json') ? JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8')) : [];
const movies = mergeCatalog(seeds, imported);
const catalogUpdatedAt = movies.flatMap(movie => [movie.source?.importedAt, movie.tmdbRating?.updatedAt, movie.doubanRating?.updatedAt, movie.rottenTomatoesRating?.updatedAt]).filter(Boolean).sort().at(-1) || null;
writeFileSync('public/catalog.json', JSON.stringify({ movies, movieCount: movies.length, tmdbCount: movies.filter(movie => movie.tmdbId).length, catalogUpdatedAt }));
console.log(`Static catalog: ${movies.length} movies`);
