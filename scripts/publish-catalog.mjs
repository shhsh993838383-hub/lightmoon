import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { normalizeDoubanRating } from '../server/movie-ratings.mjs';
import { mergeCatalog } from '../server/catalog-store.mjs';
import { meetsRatingPolicy } from '../src/lib/rating-policy.js';

const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const source = option('--input', '.data/enriched-catalog.json');
const rankings = JSON.parse(readFileSync(option('--douban', '.data/douban-rating-index.json'), 'utf8'));
const payload = JSON.parse(readFileSync(source, 'utf8'));
const input = Array.isArray(payload) ? payload : payload.movies;
const minimum = Number(option('--minimum', '1'));
if (!Array.isArray(input) || !Number.isInteger(minimum) || minimum < 1) throw new Error('Catalog input or minimum is invalid.');
const seeds = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const skipped = [];
const movies = mergeCatalog(seeds, input.map(movie => {
  const regions = { 中国: '中国大陆', 中国香港特别行政区: '中国香港', 中国澳门特别行政区: '中国澳门', 台湾: '中国台湾' };
  movie = { ...movie, country: String(movie.country || '').split(' / ').map(value => regions[value] || value).join(' / ') };
  const row = rankings[movie.doubanId];
  if (!row) return movie;
  try {
    const rating = normalizeDoubanRating({ id: row.doubanId, title: row.title, year: row.year, rating: { value: row.rating.average, count: row.rating.votes, max: 10 } }, movie, { updatedAt: row.rating.updatedAt });
    return rating && (!movie.doubanRating || rating.updatedAt > movie.doubanRating.updatedAt) ? { ...movie, doubanRating: rating } : movie;
  } catch { skipped.push(movie.id); return movie; }
}));
if (movies.length < minimum || movies.some(movie => !meetsRatingPolicy(movie)) || new Set(movies.map(movie => movie.id)).size !== movies.length || new Set(movies.map(movie => movie.tmdbId)).size !== movies.length) throw new Error('Catalog validation failed.');
const target = 'server/data/initial-catalog.json';
writeFileSync(target + '.tmp', '[\n' + movies.map(movie => '  ' + JSON.stringify(movie)).join(',\n') + '\n]\n');
renameSync(target + '.tmp', target);
console.log(JSON.stringify({ movies: movies.length, posters: movies.filter(movie => movie.poster).length, tmdb: movies.filter(movie => movie.tmdbRating).length, douban: movies.filter(movie => movie.doubanRating).length, rottenTomatoes: movies.filter(movie => movie.rottenTomatoesRating?.critics).length, audience: movies.filter(movie => movie.rottenTomatoesRating?.audience).length, skippedUnconfirmed: skipped.length }));
