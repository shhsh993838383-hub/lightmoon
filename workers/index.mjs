import { createD1KnowledgeBase } from './knowledge.mjs';
import { answerQuestion, AssistantError, validateMessages } from '../server/assistant.mjs';
import { createTmdbClient, TmdbError } from '../server/tmdb.mjs';
import { createMovieDiscovery } from '../server/movie-discovery.mjs';
import { createDoubanClient, DoubanError, doubanCategories, doubanRegions } from '../server/douban-api.mjs';
import { AccountError, createAccountHandler, createAccountStore } from '../server/accounts.mjs';

async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new AssistantError('请使用 JSON 格式发送消息。', 'invalid_request', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantError('消息格式不正确。', 'invalid_request', 400);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 48000) { await reader.cancel(); throw new AssistantError('对话太长了，请重新开始。', 'request_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AssistantError('消息格式不正确。', 'invalid_request', 400); }
}

export function createWorkerHandler({ knowledge, accounts = knowledge?.accounts, config = {}, discovery, douban, allowedOrigins = [], dailyLimit = 100, fetchImpl = fetch }) {
  const accountHandler = createAccountHandler({ store: accounts, knowledge });
  return async request => {
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    const json = (status, value) => Response.json(value, { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return json(403, { error: '此网站尚未获准使用接口。', code: 'origin_denied' });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url), path = url.pathname;
    const filters = () => {
      let input;
      try { input = JSON.parse(url.searchParams.get('filters') || '{}'); } catch { throw new AssistantError('筛选条件格式不正确。', 'invalid_request', 400); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AssistantError('筛选条件格式不正确。', 'invalid_request', 400);
      return input;
    };
    const ids = () => url.searchParams.has('ids') ? url.searchParams.get('ids').split(',').filter(value => /^[\w-]{1,120}$/.test(value)).slice(0, 2000) : undefined;
    try {
      if (!knowledge) return json(503, { error: '云端电影资料库尚未配置。', code: 'storage_not_configured' });
      const accountResponse = await accountHandler({ method: request.method, url, authorization: request.headers.get('Authorization'), client: request.headers.get('CF-Connecting-IP') || 'unknown', readBody: () => readBody(request) });
      if (accountResponse) return json(accountResponse.status, accountResponse.data);
      if (request.method === 'GET' && path === '/api/assistant/status') {
        const stats = await knowledge.stats();
        return json(stats.movieCount ? 200 : 503, { ready: stats.movieCount > 0, mode: config.apiKey ? 'deepseek' : 'local', ...stats });
      }
      if (request.method === 'GET' && path === '/api/import/status') {
        return json(200, { status: 'snapshot', ...await knowledge.stats() });
      }
      if (request.method === 'GET' && path === '/api/catalog/facets') {
        return json(200, { options: await knowledge.suggestFacet({ group: url.searchParams.get('group'), query: url.searchParams.get('query') || '', search: url.searchParams.get('search')?.slice(0, 160), filters: filters(), mode: url.searchParams.get('mode'), ids: ids() }) });
      }
      if (request.method === 'GET' && path === '/api/catalog/global') {
        return json(200, await discovery.search(url.searchParams.get('query'), Number(url.searchParams.get('page') || 1)));
      }
      if (request.method === 'GET' && /^\/api\/catalog\/movie\/[\w-]+$/.test(path)) {
        const id = path.split('/').at(-1);
        let movie = await knowledge.getMovie(id);
        if (id.startsWith('tmdb-') && (!movie || !movie.minutes)) [movie] = await discovery.importIds([Number(id.slice(5))]);
        return json(movie ? 200 : 404, movie ? { movie } : { error: '暂时找不到这部电影。' });
      }
      if (request.method === 'GET' && path === '/api/catalog') {
        return json(200, { ...await knowledge.queryCatalog({ filters: filters(), ids: ids(), query: url.searchParams.get('query'), mode: url.searchParams.get('mode'), sort: url.searchParams.get('sort'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset'), facets: url.searchParams.get('facets') === '1' }), ...await knowledge.stats() });
      }
      if (request.method === 'GET' && path === '/api/douban/categories') return json(200, { categories: doubanCategories, regions: doubanRegions });
      if (request.method === 'GET' && path.startsWith('/api/douban/movie/')) {
        const [category, region] = path.slice('/api/douban/movie/'.length).split('/');
        return json(200, await douban.getRanking({ category, region: region ? decodeURIComponent(region) : '全部', start: Number(url.searchParams.get('start') || 0), limit: Number(url.searchParams.get('limit') || 20) }));
      }
      if (request.method === 'POST' && path === '/api/assistant/chat') {
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AssistantError('对话格式不正确。', 'invalid_request', 400);
        validateMessages(body.messages);
        if (body.mode && !['auto', 'local'].includes(body.mode)) throw new AssistantError('不支持的对话模式。', 'invalid_request', 400);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('CF-Connecting-IP') || 'unknown'));
        const client = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        if (!await knowledge.consumeRateLimit('ai:' + client, 12)) return json(429, { error: '请求比较频繁，请稍等片刻。', code: 'rate_limit' });
        if (config.apiKey && body.mode !== 'local' && !await knowledge.consumeRateLimit('deepseek:' + new Date().toISOString().slice(0, 10), dailyLimit, 86400)) return json(429, { error: '今天的 AI 对话额度已用完，可以先使用片库检索。', code: 'daily_limit' });
        const result = await answerQuestion({ knowledge, config, messages: body.messages, mode: body.mode || 'auto', signal: request.signal, fetchImpl });
        if (!result.movies) result.movies = (await Promise.all(result.recommendations.map(item => knowledge.getMovie(item.id)))).filter(Boolean);
        return json(200, result);
      }
      return json(404, { error: '接口不存在。' });
    } catch (error) {
      if (error instanceof AssistantError || error instanceof TmdbError || error instanceof DoubanError || error instanceof AccountError) return json(error.status, { error: error.message, code: error.code });
      if (error.message === 'invalid_facet' || error.message === 'invalid_query') return json(400, { error: '筛选或搜索条件不正确。', code: 'invalid_request' });
      // Log only known error categories, never request bodies, tokens or raw SQL.
      const categories = String(error.message || '').match(/D1_[A-Z_]+|SQLITE_[A-Z_]+|different request|I\/O|no such table|no such column|exceed|network|timeout|reset|abort|binding|internal error|rows read|rows written|per day|per query|daily|queries|duration|size|length|bound parameters|subrequest|free tier/gi) || [];
      console.error(JSON.stringify({ event: 'lightmoon_service_failure', categories }));
      return json(503, { error: '电影服务暂时不可用，请稍后重试。', code: 'service_unavailable' });
    }
  };
}

const handlers = new WeakMap();
export default {
  async fetch(request, env) {
    if (!env.DB) return Response.json({ error: '云端电影资料库尚未配置。', code: 'storage_not_configured' }, { status: 503 });
    let handler = handlers.get(env.DB);
    if (!handler) {
      const knowledge = createD1KnowledgeBase(env.DB);
      handler = createWorkerHandler({
        knowledge,
        accounts: createAccountStore(env.DB),
        config: { apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL },
        discovery: createMovieDiscovery({ knowledge, client: createTmdbClient({ accessToken: env.TMDB_ACCESS_TOKEN || '', apiKey: env.TMDB_API_KEY || '' }) }),
        douban: createDoubanClient(),
        allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
        dailyLimit: Math.max(1, Math.min(10000, Number(env.AI_DAILY_LIMIT) || 100)),
      });
      handlers.set(env.DB, handler);
    }
    return handler(request);
  },
};
