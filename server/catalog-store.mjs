import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const catalogPath = resolve(projectRoot, 'src/data/movies.json');
export const tmdbCatalogPath = resolve(projectRoot, '.data/tmdb-movies.json');
const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function readTmdbCatalog(path = tmdbCatalogPath) {
  if (!path || !existsSync(path)) return { version: 1, updatedAt: null, movies: [] };
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  if (catalog.version !== 1 || !Array.isArray(catalog.movies)) throw new Error('TMDB 片库快照格式不正确。');
  return catalog;
}

export function writeTmdbCatalog(catalog, path = tmdbCatalogPath) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(catalog, null, 2) + '\n');
  renameSync(temporary, path);
}

export function mergeCatalog(seeds, imported) {
  const result = new Map(seeds.map(movie => [movie.id, movie]));
  for (const movie of imported) {
    if (!Number.isSafeInteger(movie.tmdbId) || movie.source?.provider !== 'tmdb') continue;
    const names = new Set([movie.title, movie.originalTitle, ...(movie.aliases || [])].map(key).filter(Boolean));
    const seed = seeds.find(item => movie.curatedId === item.id || item.tmdbId === movie.tmdbId || item.imdbId && item.imdbId === movie.imdbId || item.year === movie.year && [item.title, item.originalTitle].some(name => name && names.has(key(name))));
    if (seed) {
      result.set(seed.id, { ...seed, ...movie, id: seed.id, title: seed.title, originalTitle: seed.originalTitle || movie.originalTitle, aliases: [...new Set([movie.title, movie.originalTitle, ...(seed.aliases || []), ...(movie.aliases || [])].filter(Boolean))], year: movie.year ?? seed.year, minutes: movie.minutes ?? seed.minutes, director: seed.director || movie.director, text: movie.text || seed.text, poster: seed.poster || movie.poster, genre: [...new Set([...seed.genre, ...movie.genre])], mood: seed.mood, theme: seed.theme, pace: seed.pace, structure: seed.structure, tagStatus: seed.tagStatus, editorialSource: seed.source });
    } else result.set(movie.id, movie);
  }
  return [...result.values()];
}
