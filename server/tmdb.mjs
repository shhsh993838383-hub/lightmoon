import { setTimeout as delay } from 'node:timers/promises';

const apiRoot = 'https://api.themoviedb.org/3';
const genreNames = { 28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 99: '纪录片', 18: '剧情', 10751: '家庭', 14: '奇幻', 36: '历史', 27: '恐怖', 10402: '音乐', 9648: '悬疑', 10749: '爱情', 878: '科幻', 10770: '电视电影', 53: '惊悚', 10752: '战争', 37: '西部' };
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
const titleKey = title => String(title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export class TmdbError extends Error {
  constructor(message, code = 'tmdb_unavailable', status = 502) { super(message); this.code = code; this.status = status; }
}

export function createTmdbClient({ accessToken = process.env.TMDB_ACCESS_TOKEN, apiKey = process.env.TMDB_API_KEY, fetchImpl = fetch, timeoutMs = 18000, wait = delay } = {}) {
  async function get(path, parameters = {}) {
    if (!accessToken && !apiKey) throw new TmdbError('尚未配置 TMDB。请在本地窗口填写 Read Access Token 或 API Key。', 'tmdb_not_configured', 503);
    const url = new URL(apiRoot + path);
    for (const [name, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(name, String(value));
    if (!accessToken) url.searchParams.set('api_key', apiKey);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchImpl(url.toString(), { headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        if (attempt < 2) { await wait(1000 * (attempt + 1)); continue; }
        throw new TmdbError('暂时无法连接 TMDB，请检查网络后重试。');
      }
      if (response.status === 429) {
        if (attempt === 2) throw new TmdbError('TMDB 请求较多，请稍后重新同步。', 'tmdb_rate_limit', 503);
        const retry = Number(response.headers.get('retry-after'));
        await wait(Math.max(1000, Math.min(30000, Number.isFinite(retry) ? retry * 1000 : 2000)));
        continue;
      }
      if ([401, 403].includes(response.status)) throw new TmdbError('TMDB 密钥或权限无效，请重新填写 API Read Access Token。', 'tmdb_auth', 401);
      if (response.status === 404) throw new TmdbError('TMDB 中已没有这条电影记录。', 'tmdb_not_found', 404);
      if (!response.ok) {
        if (response.status >= 500 && attempt < 2) { await wait(1000 * (attempt + 1)); continue; }
        throw new TmdbError('TMDB 暂时无法提供电影资料，请稍后重试。');
      }
      try { return await response.json(); } catch { throw new TmdbError('TMDB 返回了无法读取的资料，请稍后重试。', 'tmdb_format'); }
    }
  }
  return { get };
}

export function normalizeTmdbMovie(raw, { images, importedAt = new Date().toISOString(), curatedId } = {}) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || raw.adult || !(raw.title || raw.original_title)) throw new TmdbError('影片资料缺少有效标识，已跳过。', 'tmdb_invalid_record');
  const english = raw.translations?.translations?.find(item => item.iso_639_1 === 'en')?.data;
  const imageBase = images?.secure_base_url?.startsWith('https://image.tmdb.org/') ? images.secure_base_url : 'https://image.tmdb.org/t/p/';
  const imageSize = images?.poster_sizes?.includes('w342') ? 'w342' : 'w500';
  const posterPath = /^\/[\w.-]+\.(?:jpg|png|webp)$/.test(raw.poster_path || '') ? raw.poster_path : null;
  const countries = (raw.production_countries || []).map(item => { try { return regionNames.of(item.iso_3166_1); } catch { return item.name; } }).filter(Boolean);
  const languages = (raw.spoken_languages || []).map(item => { try { return languageNames.of(item.iso_639_1); } catch { return item.name || item.english_name; } }).filter(Boolean);
  const directors = [...new Set((raw.credits?.crew || []).filter(person => person.job === 'Director').map(person => person.name).filter(Boolean))];
  const voteCount = Number.isSafeInteger(raw.vote_count) && raw.vote_count > 0 ? raw.vote_count : 0;
  return {
    id: `tmdb-${raw.id}`, tmdbId: raw.id, imdbId: /^tt\d+$/.test(raw.imdb_id || '') ? raw.imdb_id : null,
    ...(curatedId ? { curatedId } : {}),
    title: raw.title || raw.original_title, originalTitle: raw.original_title || raw.title,
    aliases: [...new Set([english?.title, ...(raw.alternative_titles?.titles || []).filter(item => ['CN', 'HK', 'TW', 'US', 'GB'].includes(item.iso_3166_1)).map(item => item.title)].filter(Boolean))],
    year: /^\d{4}-\d{2}-\d{2}$/.test(raw.release_date || '') ? Number(raw.release_date.slice(0, 4)) : null,
    releaseDate: raw.release_date || null, minutes: Number.isInteger(raw.runtime) && raw.runtime > 0 ? raw.runtime : null,
    genre: [...new Set((raw.genres || []).map(item => genreNames[item.id] || item.name).filter(Boolean))],
    mood: [], theme: [], pace: [], structure: [], tagStatus: 'tmdb-unreviewed',
    text: raw.overview || english?.overview || '', director: directors.join(' / '), country: countries.join(' / '), language: languages.join(' / '),
    cast: (raw.credits?.cast || []).slice(0, 8).filter(person => person.name).map(person => ({ name: person.name, character: person.character || '' })),
    keywords: (raw.keywords?.keywords || []).map(item => item.name).filter(Boolean),
    poster: posterPath ? `${imageBase}${imageSize}${posterPath}` : null, posterWidth: 342, posterHeight: 513,
    tmdbRating: voteCount && Number.isFinite(raw.vote_average) ? { average: raw.vote_average, votes: voteCount, updatedAt: importedAt } : null,
    source: { provider: 'tmdb', page: `https://www.themoviedb.org/movie/${raw.id}`, poster: posterPath ? `${imageBase}original${posterPath}` : null, importedAt },
  };
}

export function matchCuratedResult(seed, results) {
  const names = new Set([seed.title, seed.originalTitle, ...(seed.aliases || [])].map(titleKey));
  return results.find(movie => !movie.adult && Number(movie.release_date?.slice(0, 4)) === seed.year && [movie.title, movie.original_title].some(name => name && names.has(titleKey(name))));
}

export async function syncTmdbCatalog({ client = createTmdbClient(), seeds, existing = [], limit = 120, skipExisting = false, onProgress = () => {}, onBatch = () => {} }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new TmdbError('单次同步数量应为 1 到 2000 部。', 'tmdb_invalid_limit', 400);
  const config = await client.get('/configuration');
  const candidates = new Map();
  const records = new Map(existing.map(movie => [movie.tmdbId, movie]));
  for (const seed of seeds) {
    if (candidates.size >= limit) break;
    onProgress({ stage: 'matching', current: candidates.size });
    const result = await client.get('/search/movie', { query: seed.originalTitle || seed.title, year: seed.year, language: 'zh-CN', include_adult: false });
    const match = matchCuratedResult(seed, result.results || []);
    if (match) candidates.set(match.id, seed.id);
  }
  for (let page = 1; candidates.size < limit && page <= 100; page++) {
    const lists = [
      ['/discover/movie', { with_origin_country: 'CN', sort_by: 'vote_count.desc', 'vote_count.gte': 100 }],
      ['/discover/movie', { with_origin_country: 'HK', sort_by: 'vote_count.desc', 'vote_count.gte': 100 }],
      ['/discover/movie', { with_origin_country: 'TW', sort_by: 'vote_count.desc', 'vote_count.gte': 100 }],
      ['/movie/top_rated', {}], ['/movie/popular', {}],
    ];
    let hasResults = false;
    for (const [path, params] of lists) {
      if (candidates.size >= limit) break;
      const result = await client.get(path, { ...params, page, language: 'zh-CN', include_adult: false });
      hasResults ||= Boolean(result.results?.length);
      for (const movie of result.results || []) {
        if (candidates.size >= limit) break;
        if (Number.isSafeInteger(movie.id) && !movie.adult && !candidates.has(movie.id)) candidates.set(movie.id, undefined);
      }
    }
    if (!hasResults) break;
  }
  let processed = 0, skipped = 0;
  const entries = [...candidates].filter(([id]) => !skipExisting || !records.has(id));
  // Keep upstream concurrency small, and only replace the on-disk snapshot after a successful run.
  for (let offset = 0; offset < entries.length; offset += 3) {
    const batch = await Promise.all(entries.slice(offset, offset + 3).map(async ([id, curatedId]) => {
      try {
        const raw = await client.get(`/movie/${id}`, { language: 'zh-CN', append_to_response: 'credits,keywords,translations,alternative_titles' });
        return normalizeTmdbMovie(raw, { images: config.images, curatedId: curatedId || records.get(id)?.curatedId });
      } catch (error) { if (['tmdb_not_found', 'tmdb_invalid_record'].includes(error.code)) return null; throw error; }
    }));
    for (const movie of batch) { if (movie) records.set(movie.tmdbId, { ...records.get(movie.tmdbId), ...movie }); else skipped++; processed++; }
    onProgress({ stage: 'importing', current: processed, total: entries.length });
    await onBatch([...records.values()]);
  }
  return { version: 1, updatedAt: new Date().toISOString(), movies: [...records.values()], processed, skipped };
}
