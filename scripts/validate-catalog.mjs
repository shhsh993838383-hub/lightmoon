import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admissionReason, meetsRatingPolicy } from '../src/lib/rating-policy.js';

const movies = JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8'));
const collections = JSON.parse(readFileSync('src/data/series-collections.json', 'utf8'));
const minimumIndex = process.argv.indexOf('--minimum');
const minimum = minimumIndex < 0 ? 10000 : Number(process.argv[minimumIndex + 1]);
assert.ok(movies.length >= minimum, '片库数量不足');
assert.equal(new Set(movies.map(movie => movie.id)).size, movies.length);
assert.equal(new Set(movies.map(movie => movie.tmdbId)).size, movies.length);
assert.ok(movies.every(movie => Number.isSafeInteger(movie.tmdbId) && movie.poster && meetsRatingPolicy(movie)));
assert.ok(movies.every(movie => !movie.releaseDate || movie.releaseDate <= new Date().toISOString().slice(0, 10)));
const byTmdb = new Map(movies.map(movie => [movie.tmdbId, movie]));
for (const collection of collections) for (const entry of collection.movies) {
  const movie = byTmdb.get(entry.tmdbId);
  assert.ok(movie, `${collection.title}中缺少${entry.title}`);
  assert.equal(entry.id, movie.id, `${entry.title}的片单标识不一致`);
}
const top = collections.find(collection => collection.id === 'douban-top250');
assert.equal(top.movies.length, 250);
assert.equal(new Set(top.movies.map(movie => movie.tmdbId)).size, 250);
assert.deepEqual(top.movies.map(movie => movie.rank), Array.from({ length: 250 }, (_, index) => index + 1));
for (const entry of top.movies) assert.equal(String(byTmdb.get(entry.tmdbId).doubanId), String(entry.doubanId));
for (const collection of collections.filter(collection => collection.order === 'release')) assert.deepEqual(collection.movies.map(movie => movie.releaseDate), collection.movies.map(movie => movie.releaseDate).sort());
console.log(JSON.stringify({ movieCount: movies.length, posters: movies.filter(movie => movie.poster).length, top250: top.movies.length, series: collections.length - 1, highScoreExceptions: movies.filter(movie => admissionReason(movie) === 'high-score').length, collectionExceptions: movies.filter(movie => admissionReason(movie) === 'collection').length }));
