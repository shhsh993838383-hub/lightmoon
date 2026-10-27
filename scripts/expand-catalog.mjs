import { readFileSync, mkdirSync } from 'node:fs';
import { syncTmdbCatalog, TmdbError } from '../server/tmdb.mjs';
import { writeTmdbCatalog } from '../server/catalog-store.mjs';

const index = process.argv.indexOf('--limit');
const limit = index < 0 ? 2000 : Number(process.argv[index + 1]);
const seeds = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const existing = JSON.parse(readFileSync('server/data/initial-catalog.json', 'utf8'));
mkdirSync('.data', { recursive: true });
try {
  const result = await syncTmdbCatalog({ seeds, existing, limit, skipExisting: true,
    onBatch: movies => writeTmdbCatalog({ version: 1, updatedAt: new Date().toISOString(), movies }, '.data/expanded-catalog.json'),
    onProgress: progress => {
      if (progress.stage === 'importing' && (progress.current % 60 === 0 || progress.current === progress.total)) console.log(JSON.stringify(progress));
    },
  });
  writeTmdbCatalog(result, '.data/expanded-catalog.json');
  console.log(JSON.stringify({ existing: existing.length, movieCount: result.movies.length, added: result.movies.length - existing.length, skipped: result.skipped }));
} catch (error) {
  console.error(error instanceof TmdbError ? error.message : '电影导入未完成，已保留成功获取的记录。');
  process.exitCode = 1;
}
