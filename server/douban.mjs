// Adapted from x1ao4/douban-api (MIT). License and revision: THIRD_PARTY_NOTICES.md.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from './catalog-store.mjs';

export class DoubanError extends Error {
  constructor(message, code = 'douban_unavailable', status = 502) { super(message); this.code = code; this.status = status; }
}
export const doubanCategories = { hot: '热门', latest: '最新', top: '豆瓣高分', underrated: '冷门佳片' };
export const doubanRegions = ['全部', '华语', '欧美', '韩国', '日本'];

export function normalizeDoubanItems(payload) {
  const data = payload?.data || payload;
  if (payload?.isMockData || data?.isMockData) throw new DoubanError('豆瓣接口返回了模拟数据，未载入榜单。', 'douban_mock');
  const items = data?.items || data?.subjects;
  if (!Array.isArray(items)) throw new DoubanError('豆瓣返回的资料格式暂时无法读取。', 'douban_format');
  return items.filter(item => /^\d+$/.test(String(item.id)) && typeof item.title === 'string').map(item => {
    const value = Number(item.rating?.value ?? item.rating?.average);
    const count = Number(item.rating?.count ?? item.rating?.numRaters ?? item.collect_count);
    const image = item.pic?.normal || item.cover?.url || (typeof item.cover === 'string' ? item.cover : null) || item.images?.large;
    const cardSubtitle = String(item.card_subtitle || '');
    const year = String(item.year || cardSubtitle.match(/(?:19|20)\d{2}/)?.[0] || '');
    return { id: `douban-${item.id}`, doubanId: String(item.id), title: item.title, year: year ? Number(year) : null,
      poster: typeof image === 'string' && /^https:\/\/[^/]+\.doubanio\.com\//.test(image) ? image : null,
      rating: Number.isFinite(value) && value > 0 && value <= 10 ? { average: value, votes: Number.isInteger(count) && count > 0 ? count : null } : null,
      subtitle: cardSubtitle.slice(0, 300), page: `https://movie.douban.com/subject/${item.id}/` };
  });
}

export function createDoubanClient({ apiKey = process.env.DOUBAN_API_KEY, fetchImpl = fetch, cachePath = resolve(projectRoot, '.data/douban-cache.json'), now = () => Date.now() } = {}) {
  let cache = {};
  if (cachePath && existsSync(cachePath)) { try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch {} }
  const inflight = new Map();
  const save = () => { if (cachePath) { mkdirSync(resolve(cachePath, '..'), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); } };
  async function request(url, headers = {}) {
    let response;
    try { response = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new DoubanError('暂时无法连接豆瓣榜单，请稍后重试。'); }
    let data;
    try { data = await response.json(); } catch { throw new DoubanError('豆瓣接口暂时没有返回可用资料。', 'douban_format'); }
    if (!response.ok || data.code && !data.items && !data.subjects) {
      if (data.code === 109 || response.status === 401) throw new DoubanError('豆瓣未接受当前 API Key，请核对密钥对应的接口服务。', 'douban_auth', 401);
      if (response.status === 429) throw new DoubanError('豆瓣请求受限，请稍后再试。', 'douban_rate_limit', 503);
      throw new DoubanError('豆瓣榜单接口暂时不可用。', 'douban_rejected');
    }
    return data;
  }
  async function getRanking({ category = 'hot', region = '全部', start = 0, limit = 20 } = {}) {
    if (!doubanCategories[category] || !doubanRegions.includes(region) || !Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new DoubanError('豆瓣榜单参数不正确。', 'invalid_request', 400);
    const cacheKey = `${category}:${region}:${start}:${limit}`;
    const previous = cache[cacheKey];
    if (previous && now() - previous.savedAt < 3600000) return { ...previous.result, cached: true, stale: false };
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const work = (async () => {
      try {
        const url = new URL('https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie');
        for (const [key, value] of Object.entries({ start, limit, category: doubanCategories[category], type: region })) url.searchParams.set(key, String(value));
        let raw;
        try { raw = await request(url.toString(), { Referer: 'https://m.douban.com/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' }); }
        catch (error) {
          // The supplied key belongs to the legacy endpoint, not the mobile ranking API.
          if (!apiKey || category !== 'top' || region !== '全部' || error.code === 'douban_rate_limit') throw error;
          const legacy = new URL('https://api.douban.com/v2/movie/top250');
          for (const [key, value] of Object.entries({ apikey: apiKey, start, count: limit })) legacy.searchParams.set(key, String(value));
          raw = await request(legacy.toString());
        }
        const result = { items: normalizeDoubanItems(raw), category, region, start, limit, total: Number(raw.total) || null, updatedAt: new Date(now()).toISOString(), cached: false, stale: false };
        cache[cacheKey] = { savedAt: now(), result }; save();
        return result;
      } catch (error) {
        if (previous) return { ...previous.result, cached: true, stale: true, warning: error.message };
        throw error;
      } finally { inflight.delete(cacheKey); }
    })();
    inflight.set(cacheKey, work);
    return work;
  }
  return { getRanking };
}
