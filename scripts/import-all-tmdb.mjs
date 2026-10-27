import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createKnowledgeBase, projectRoot } from '../server/knowledge-base.mjs';
import { createTmdbClient, normalizeTmdbMovie, TmdbError } from '../server/tmdb.mjs';
import { meetsRatingPolicy } from '../src/lib/rating-policy.js';

const dataDirectory = resolve(projectRoot, '.data');
mkdirSync(dataDirectory, { recursive: true });
const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const stateFile = resolve(dataDirectory, 'tmdb-import-state.json');
const lockFile = resolve(dataDirectory, 'tmdb-import.lock');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const batchLimit = Number(option('--batch-limit', '0'));
const workers = Math.max(1, Math.min(8, Number(option('--concurrency', '4')) || 4));
const dateOption = option('--date');
let cancelled = false, knowledge, state;
const saveState = () => { state.updatedAt = new Date().toISOString(); writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2)); renameSync(stateFile + '.tmp', stateFile); };
process.on('SIGINT', () => { cancelled = true; });
process.on('SIGTERM', () => { cancelled = true; });

try {
  if (existsSync(lockFile)) {
    const owner = Number(readFileSync(lockFile, 'utf8'));
    let running = false;
    try { process.kill(owner, 0); running = true; } catch {}
    if (running) throw new Error('another_import_running');
    rmSync(lockFile);
  }
  writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { version: 1, line: 0, checked: 0, imported: 0, skipped: 0 };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const date = dateOption || state.exportDate || yesterday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_export_date');
  if (state.exportDate && state.exportDate !== date) state = { version: 1, line: 0, checked: 0, imported: 0, skipped: 0 };
  state.exportDate = date; state.pid = process.pid; state.status = 'downloading'; state.startedAt ||= new Date().toISOString(); state.error = null;
  saveState();
  const [year, month, day] = date.split('-');
  const exportFile = resolve(dataDirectory, `tmdb-movie-ids-${date}.jsonl`);
  if (!existsSync(exportFile)) {
    const response = await fetch(`https://files.tmdb.org/p/exports/movie_ids_${month}_${day}_${year}.json.gz`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error('export_unavailable');
    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(exportFile + '.part'));
    renameSync(exportFile + '.part', exportFile);
  }
  const client = createTmdbClient();
  const configuration = await client.get('/configuration');
  knowledge = createKnowledgeBase();
  let total = 0;
  if (!state.total) {
    for await (const line of createInterface({ input: createReadStream(exportFile), crlfDelay: Infinity })) if (line) total++;
    state.total = total;
  }
  state.status = 'importing'; saveState();
  console.log(JSON.stringify({ stage: state.status, total: state.total, resumeLine: state.line }));
  let lineNumber = 0, pending = [], pendingLine = state.line, batches = 0;
  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const normalized = await Promise.all(batch.map(async record => {
      if (record.adult || knowledge.hasTmdb(record.id)) return null;
      try {
        const movie = await client.get(`/movie/${record.id}`, { language: 'zh-CN', append_to_response: 'credits,keywords,translations,alternative_titles' });
        return normalizeTmdbMovie(movie, { images: configuration.images });
      } catch (error) { if (['tmdb_not_found', 'tmdb_invalid_record'].includes(error.code)) return null; throw error; }
    }));
    const movies = normalized.filter(movie => movie && movie.poster && meetsRatingPolicy(movie));
    if (movies.length) knowledge.upsertImported(movies);
    state.line = pendingLine; state.checked += batch.length; state.imported += movies.length; state.skipped += batch.length - movies.length;
    saveState(); batches++;
    if (batches % 10 === 0) console.log(JSON.stringify({ stage: 'importing', checked: state.checked, total: state.total, imported: state.imported, movieCount: knowledge.stats().movieCount }));
    if (movies.length) await delay(300);
  }
  for await (const line of createInterface({ input: createReadStream(exportFile), crlfDelay: Infinity })) {
    lineNumber++;
    if (lineNumber <= state.line || !line) continue;
    const record = JSON.parse(line);
    pending.push(record); pendingLine = lineNumber;
    if (pending.length >= workers) {
      await flush();
      if (cancelled || batchLimit > 0 && batches >= batchLimit) break;
    }
  }
  await flush();
  state.status = cancelled || batchLimit > 0 && batches >= batchLimit ? 'paused' : 'complete';
  saveState(); console.log(JSON.stringify({ status: state.status, ...knowledge.stats(), checked: state.checked, total: state.total }));
} catch (error) {
  if (state) { state.status = 'error'; state.error = error instanceof TmdbError ? error.message : '全量导入暂时中断，已保存断点，可重新运行继续。'; saveState(); }
  console.error(error instanceof TmdbError ? error.message : error.message === 'another_import_running' ? '已有全量导入正在运行。' : '全量导入暂时中断，已保存断点，可重新运行继续。');
  process.exitCode = 1;
} finally {
  knowledge?.close();
  if (existsSync(lockFile) && Number(readFileSync(lockFile, 'utf8')) === process.pid) rmSync(lockFile);
}
