import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const catalogPath = resolve(projectRoot, 'src/data/movies.json');
export const tmdbCatalogPath = resolve(projectRoot, '.data/tmdb-movies.json');

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

export { mergeCatalog } from './catalog-merge.mjs';
