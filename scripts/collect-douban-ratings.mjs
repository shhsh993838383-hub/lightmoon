import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createDoubanClient } from '../server/douban.mjs';

const file = '.data/douban-rating-index.json';
mkdirSync('.data', { recursive: true });
const ratings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const client = createDoubanClient({ apiKey: '' });
const jobs = [
  ...[0, 100, 200, 300, 400].map(start => ({ category: 'top', region: '全部', start })),
  ...[0, 100, 200].map(start => ({ category: 'top', region: '华语', start })),
  { category: 'hot', region: '全部', start: 0 },
  { category: 'underrated', region: '全部', start: 0 },
];
for (const job of jobs) {
  try {
    const result = await client.getRanking({ ...job, limit: 100 });
    for (const movie of result.items) if (movie.rating) ratings[movie.doubanId] = { ...movie, rating: { ...movie.rating, updatedAt: result.updatedAt } };
    writeFileSync(file + '.tmp', JSON.stringify(ratings)); renameSync(file + '.tmp', file);
    console.log(JSON.stringify({ ...job, read: result.items.length, unique: Object.keys(ratings).length, cached: result.cached }));
  } catch (error) {
    console.log(JSON.stringify({ ...job, error: error.code }));
    if (['douban_rate_limit', 'douban_rejected', 'douban_auth'].includes(error.code)) break;
  }
  await delay(1200);
}
