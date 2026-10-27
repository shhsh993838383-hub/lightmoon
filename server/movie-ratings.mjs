import { setTimeout as delay } from 'node:timers/promises';

const userAgent = 'Lightmoon/0.1 (movie discovery; https://github.com/shhsh993838383-hub/lightmoon)';
const key = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const number = (value, max) => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= max ? Number(value) : null;
const count = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export class RatingError extends Error {
  constructor(message, code = 'rating_unavailable') { super(message); this.code = code; }
}

async function get(url, { fetchImpl = fetch, headers = {}, timeout = 18000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try { response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, ...headers }, signal: AbortSignal.timeout(timeout) }); }
    catch { if (!attempt) { await delay(600); continue; } throw new RatingError('评分服务暂时无法连接。'); }
    if ((response.status === 429 || response.status >= 500) && !attempt) { await delay(2000); continue; }
    if (!response.ok) {
      let data;
      try { data = await response.json(); } catch {}
      if (data?.code === 1309 || data?.msg === 'subject_ip_rate_limit') throw new RatingError('豆瓣详情评分读取受限，已暂停请求。', 'rating_rate_limit');
      throw new RatingError('评分服务暂时没有提供资料。', 'rating_http_' + response.status);
    }
    return response;
  }
}

export async function lookupRatingLinks(imdbIds, { fetchImpl = fetch } = {}) {
  const ids = [...new Set(imdbIds)].filter(id => /^tt\d+$/.test(id)).slice(0, 50);
  if (!ids.length) return new Map();
  const query = `SELECT ?imdb ?douban ?rt WHERE { VALUES ?imdb { ${ids.map(id => '"' + id + '"').join(' ')} } ?item wdt:P345 ?imdb . OPTIONAL { ?item wdt:P4529 ?douban } OPTIONAL { ?item wdt:P1258 ?rt } }`;
  const url = new URL('https://query.wikidata.org/sparql');
  url.searchParams.set('query', query); url.searchParams.set('format', 'json');
  const response = await get(url, { fetchImpl, headers: { Accept: 'application/sparql-results+json' }, timeout: 30000 });
  let data;
  try { data = await response.json(); } catch { throw new RatingError('影片关联资料格式不正确。', 'link_format'); }
  if (!Array.isArray(data.results?.bindings)) throw new RatingError('影片关联资料格式不正确。', 'link_format');
  const rows = new Map();
  for (const item of data.results.bindings) {
    const imdbId = item.imdb?.value;
    if (!ids.includes(imdbId)) continue;
    const previous = rows.get(imdbId) || { doubanIds: new Set(), rottenPaths: new Set() };
    if (/^\d+$/.test(item.douban?.value || '')) previous.doubanIds.add(item.douban.value);
    if (/^m\/[a-z0-9_-]+$/.test(item.rt?.value || '')) previous.rottenPaths.add(item.rt.value);
    rows.set(imdbId, previous);
  }
  return new Map([...rows].map(([imdbId, row]) => [imdbId, {
    imdbId, doubanId: row.doubanIds.size === 1 ? [...row.doubanIds][0] : null,
    rottenTomatoesPath: row.rottenPaths.size === 1 ? [...row.rottenPaths][0] : null,
    linkedAt: new Date().toISOString(), linkMethod: 'wikidata-imdb',
  }]));
}

export function normalizeDoubanRating(raw, movie, { updatedAt = new Date().toISOString() } = {}) {
  if (raw?.isMockData || raw?.is_tv || raw?.subtype === 'tv' || String(raw?.id) !== String(movie.doubanId)) throw new RatingError('豆瓣影片标识不一致。', 'rating_identity');
  const year = Number(raw.year);
  const names = new Set([movie.title, movie.originalTitle, ...(movie.aliases || [])].map(key).filter(Boolean));
  const matchesTitle = [raw.title, raw.original_title, ...(raw.aka || [])].some(title => names.has(key(title)));
  if (!matchesTitle || Number.isInteger(movie.year) && year !== movie.year) throw new RatingError('豆瓣片名或年份未通过核对。', 'rating_identity');
  const average = number(raw.rating?.value, 10);
  if (average === null || average <= 0 || Number(raw.rating?.max || 10) !== 10) return null;
  return { average, votes: count(raw.rating?.count), updatedAt };
}

export async function fetchDoubanRating(movie, { fetchImpl = fetch } = {}) {
  if (!/^\d+$/.test(String(movie.doubanId || ''))) return null;
  const response = await get('https://m.douban.com/rexxar/api/v2/movie/' + movie.doubanId, { fetchImpl, headers: {
    Referer: 'https://m.douban.com/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  } });
  let raw;
  try { raw = await response.json(); } catch { throw new RatingError('豆瓣评分格式暂时无法读取。', 'rating_format'); }
  return normalizeDoubanRating(raw, movie);
}

export function parseRottenTomatoes(html, path, { updatedAt = new Date().toISOString() } = {}) {
  if (!/^m\/[a-z0-9_-]+$/.test(path)) throw new RatingError('烂番茄影片地址不正确。', 'rating_identity');
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  if (canonical && new URL(canonical).pathname.replace(/\/$/, '') !== '/' + path) throw new RatingError('烂番茄影片标识不一致。', 'rating_identity');
  const found = html.match(/<script\b[^>]*id=["']media-scorecard-json["'][^>]*>([\s\S]*?)<\/script>/i);
  let card;
  if (found) { try { card = JSON.parse(found[1]); } catch { throw new RatingError('烂番茄评分格式暂时无法读取。', 'rating_format'); } }
  const criticsScore = number(card?.criticsScore?.score, 100);
  const audienceScore = number(card?.audienceScore?.score, 100);
  if (criticsScore === null && audienceScore === null) return null;
  return {
    critics: criticsScore === null ? null : { score: criticsScore, reviews: count(card.criticsScore.reviewCount), certified: card.criticsScore.certified === true },
    audience: audienceScore === null ? null : { score: audienceScore, ratings: card.audienceScore.bandedRatingCount || null, verified: card.audienceScore.scoreType === 'VERIFIED' },
    updatedAt,
  };
}

export async function fetchRottenTomatoesRating(movie, { fetchImpl = fetch } = {}) {
  const path = movie.rottenTomatoesPath;
  if (!/^m\/[a-z0-9_-]+$/.test(path || '')) return null;
  const response = await get('https://www.rottentomatoes.com/' + path, { fetchImpl });
  const html = await response.text();
  const resolved = response.url ? new URL(response.url) : new URL('https://www.rottentomatoes.com/' + path);
  if (resolved.hostname !== 'www.rottentomatoes.com' || !/^\/m\/[a-z0-9_-]+\/?$/.test(resolved.pathname)) throw new RatingError('烂番茄影片地址不正确。', 'rating_identity');
  if (resolved.pathname.replace(/\/$/, '') !== '/' + path) {
    // Wikidata can retain an older URL. Accept the site's own canonical redirect only after checking the movie title and year.
    const names = new Set([movie.title, movie.originalTitle, ...(movie.aliases || [])].map(key).filter(Boolean));
    const titles = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(match => {
      try { const data = JSON.parse(match[1]); return data['@type'] === 'Movie' ? [data.name] : []; } catch { return []; }
    });
    const year = html.match(/"releaseYear"\s*:\s*"(\d{4})"/)?.[1];
    if (!titles.some(title => names.has(key(title))) || movie.year && Number(year) !== movie.year) throw new RatingError('烂番茄跳转后的片名或年份未通过核对。', 'rating_identity');
  }
  return parseRottenTomatoes(html, resolved.pathname.replace(/^\//, '').replace(/\/$/, ''));
}
