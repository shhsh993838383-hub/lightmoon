import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { catalogPath, projectRoot, readTmdbCatalog, writeTmdbCatalog } from '../server/catalog-store.mjs';
import { syncTmdbCatalog, TmdbError } from '../server/tmdb.mjs';
import { createKnowledgeBase } from '../server/knowledge-base.mjs';

const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const limitFlag = process.argv.indexOf('--limit');
const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : 120;
try {
  const result = await syncTmdbCatalog({ seeds: JSON.parse(readFileSync(catalogPath, 'utf8')), existing: readTmdbCatalog().movies, limit, onProgress: progress => {
    if (progress.stage === 'matching') console.log(`Matching curated films: ${progress.current}`);
    else console.log(`TMDB movie details: ${progress.current}/${progress.total}`);
  } });
  writeTmdbCatalog(result);
  const knowledge = createKnowledgeBase();
  console.log(JSON.stringify({ synced: result.processed, skipped: result.skipped, ...knowledge.stats() }));
  knowledge.close();
} catch (error) {
  console.error(error instanceof TmdbError ? error.message : '同步未完成；原有片库仍可使用。');
  process.exitCode = 1;
}
