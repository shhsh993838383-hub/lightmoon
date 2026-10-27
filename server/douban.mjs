import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {projectRoot} from './catalog-store.mjs';
import {createDoubanClient as createApiClient} from './douban-api.mjs';
export {DoubanError, doubanCategories, doubanRegions, normalizeDoubanItems} from './douban-api.mjs';

export function createDoubanClient({apiKey = process.env.DOUBAN_API_KEY, cachePath = resolve(projectRoot, '.data/douban-cache.json'), ...options} = {}) {
  let initialCache = {};
  if(cachePath && existsSync(cachePath)) {try {initialCache = JSON.parse(readFileSync(cachePath, 'utf8'));} catch {}}
  return createApiClient({...options, apiKey, initialCache, saveCache(cache) {if(cachePath) {mkdirSync(dirname(cachePath), {recursive:true}); writeFileSync(cachePath, JSON.stringify(cache));}}});
}
