import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { TmdbError } from '../server/tmdb.mjs';
import { expandTmdbCatalog } from '../server/expand-tmdb.mjs';
import { writeTmdbCatalog } from '../server/catalog-store.mjs';
import knownLowRatings from '../src/data/rating-exclusions.json' with { type: 'json' };

const index = process.argv.indexOf('--limit');
const target = index < 0 ? 10000 : Number(process.argv[index + 1]);
if (existsSync('.env')) process.loadEnvFile('.env');
const source = JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8'));
const checkpoint = existsSync('.data/expanded-catalog.json') ? JSON.parse(readFileSync('.data/expanded-catalog.json', 'utf8')).movies : [];
const special = existsSync('server/data/collection-movies.json') ? JSON.parse(readFileSync('server/data/collection-movies.json', 'utf8')) : [];
const existing = [...new Map([...knownLowRatings, ...source, ...checkpoint, ...special].map(movie => [movie.tmdbId, movie])).values()];
mkdirSync('.data', { recursive: true });
try {
  const result = await expandTmdbCatalog({ existing, target,
    onBatch: movies => writeTmdbCatalog({ version: 1, updatedAt: new Date().toISOString(), movies }, '.data/expanded-catalog.json'),
    onProgress: progress => {
      if (progress.processed % 100 < 4 || progress.movieCount >= target) console.log(JSON.stringify(progress));
    },
  });
  writeTmdbCatalog(result, '.data/expanded-catalog.json');
  console.log(JSON.stringify({ existing: existing.length, movieCount: result.movies.length, added: result.movies.length - existing.length, skipped: result.skipped }));
} catch (error) {
  console.error(error instanceof TmdbError ? error.message : '电影导入未完成，已保留成功获取的记录。');
  process.exitCode = 1;
}
