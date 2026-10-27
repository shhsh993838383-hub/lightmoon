import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mergeCatalog } from '../server/catalog-store.mjs';
const seeds = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const imported = existsSync('server/data/initial-catalog.json') ? JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8')) : [];
const movies = mergeCatalog(seeds, imported);
writeFileSync('public/catalog.json', JSON.stringify({ movies, movieCount: movies.length, tmdbCount: movies.filter(movie => movie.tmdbId).length }));
console.log(`Static catalog: ${movies.length} movies`);
