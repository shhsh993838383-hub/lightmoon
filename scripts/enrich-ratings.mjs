import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { lookupRatingLinks, fetchDoubanRating, fetchRottenTomatoesRating } from '../server/movie-ratings.mjs';

const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const source = option('--input', 'server/data/initial-catalog.json');
const output = option('--output', '.data/enriched-catalog.json');
const limit = Math.max(1, Math.min(10000, Number(option('--limit', '2000'))));
const providers = option('--providers', 'douban,rotten').split(',');
const movies = JSON.parse(readFileSync(source, 'utf8'));
const cachePath = '.data/ratings-cache.json';
mkdirSync('.data', { recursive: true });
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const atomic = (file, value) => { writeFileSync(file + '.tmp', JSON.stringify(value)); renameSync(file + '.tmp', file); };
let cancelled = false, linked = 0;
process.on('SIGINT', () => { cancelled = true; });
process.on('SIGTERM', () => { cancelled = true; });
const valid = movie => /^tt\d+$/.test(movie.imdbId || '');
const selected = movies.filter(valid).slice(0, limit);
const missing = selected.filter(movie => !cache[movie.imdbId]?.links);
for (let offset = 0; offset < missing.length && !cancelled; offset += 40) {
  const batch = missing.slice(offset, offset + 40);
  try {
    const links = await lookupRatingLinks(batch.map(movie => movie.imdbId));
    for (const movie of batch) {
      cache[movie.imdbId] ||= {};
      cache[movie.imdbId].links = links.get(movie.imdbId) || { imdbId: movie.imdbId, linkedAt: new Date().toISOString(), linkMethod: 'wikidata-imdb' };
      linked++;
    }
    atomic(cachePath, cache);
  } catch (error) { console.log(JSON.stringify({ stage: 'link_error', code: error.code || 'unavailable', offset })); }
  if ((offset + 40) % 200 === 0 || offset + 40 >= missing.length) console.log(JSON.stringify({ stage: 'links', checked: Math.min(offset + 40, missing.length), total: missing.length }));
  await delay(300);
}
const apply = movie => {
  const row = cache[movie.imdbId];
  return row ? { ...movie, ...row.links, ...(row.doubanRating ? { doubanRating: row.doubanRating } : {}), ...(row.rottenTomatoesRating ? { rottenTomatoesRating: row.rottenTomatoesRating } : {}) } : movie;
};
let checked = 0;
const failures = {};
const stopped = new Set();
const recent = at => at && Date.now() - Date.parse(at) < 7 * 86400000;
async function worker(batch, provider, fetchRating, field) {
  for (const original of batch) {
    if (cancelled || stopped.has(provider)) break;
    const movie = apply(original);
    const row = cache[movie.imdbId] ||= {};
    const id = provider === 'douban' ? movie.doubanId : movie.rottenTomatoesPath;
    if (!id || recent(row[field]?.updatedAt) || recent(row[provider + 'CheckedAt'])) continue;
    try {
      const rating = await fetchRating(movie);
      if (rating) row[field] = rating;
      row[provider + 'CheckedAt'] = new Date().toISOString();
    } catch (error) {
      const code = provider + ':' + (error.code || 'unavailable');
      failures[code] = (failures[code] || 0) + 1;
      if (error.code === 'rating_rate_limit') { stopped.add(provider); break; }
      // Stop a provider after repeated blocking responses instead of retrying every film.
      if (['rating_http_401', 'rating_http_403', 'rating_http_429'].includes(error.code) && failures[code] >= 3) { stopped.add(provider); break; }
    }
    checked++;
    if (checked % 40 === 0) {
      atomic(cachePath, cache);
      atomic(output, movies.map(apply));
      console.log(JSON.stringify({ stage: 'ratings', checked, douban: Object.values(cache).filter(row => row.doubanRating).length, rottenTomatoes: Object.values(cache).filter(row => row.rottenTomatoesRating).length, failures }));
    }
    await delay(provider === 'douban' ? 250 : 300);
  }
}
await Promise.all([0, 1].flatMap(part => [
  ...(providers.includes('douban') ? [worker(selected.filter((_, index) => index % 2 === part), 'douban', fetchDoubanRating, 'doubanRating')] : []),
  ...(providers.includes('rotten') ? [worker(selected.filter((_, index) => index % 2 === part), 'rotten', fetchRottenTomatoesRating, 'rottenTomatoesRating')] : []),
]));
const result = movies.map(apply);
atomic(cachePath, cache); atomic(output, result);
console.log(JSON.stringify({ stage: cancelled ? 'paused' : 'complete', movieCount: result.length, linked, douban: result.filter(movie => movie.doubanRating).length, rottenTomatoes: result.filter(movie => movie.rottenTomatoesRating?.critics).length, failures }));
