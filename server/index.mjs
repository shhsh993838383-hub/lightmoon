import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createKnowledgeBase, projectRoot } from './knowledge-base.mjs';
import { answerQuestion, AssistantError } from './assistant.mjs';
import { createDoubanClient, DoubanError, doubanCategories, doubanRegions } from './douban.mjs';
import { createMovieDiscovery } from './movie-discovery.mjs';
import { TmdbError } from './tmdb.mjs';

const envPath = resolve(projectRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new AssistantError('请使用 JSON 格式发送消息。', 'invalid_request', 415);
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    if (JSON.stringify(request.body).length > 48000) throw new AssistantError('对话太长了，请重新开始。', 'request_too_large', 413);
    return request.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 48000) throw new AssistantError('对话太长了，请重新开始。', 'request_too_large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AssistantError('消息格式不正确。', 'invalid_request', 400); }
}

export function createAppHandler({ knowledge = createKnowledgeBase(), config = { apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL, model: process.env.DEEPSEEK_MODEL }, fetchImpl, douban = createDoubanClient(), discovery = createMovieDiscovery({ knowledge }) } = {}) {
  const requests = new Map();
  return async (request, response) => {
    const origin = request.headers.origin;
    const allowed = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://127.0.0.1:8787').split(',').map(value => value.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json(response, 403, { error: '此网站尚未获准使用接口。' });
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const requestUrl = new URL(request.url, 'http://localhost');
    const path = requestUrl.pathname;
    if (request.method === 'GET' && path === '/api/import/status') {
      const file = resolve(projectRoot, '.data/tmdb-import-state.json');
      try {
        const state = knowledge.getMetadata ? JSON.parse(await knowledge.getMetadata('tmdbImportState') || '{"status":"not_started"}') : existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { status: 'not_started' };
        return json(response, 200, { status: state.status, total: state.total, checked: state.checked, imported: state.imported, updatedAt: state.updatedAt, error: state.error, ...await knowledge.stats() });
      } catch { return json(response, 503, { error: '暂时无法读取导入进度。' }); }
    }
    if (request.method === 'GET' && path === '/api/catalog/facets') {
      try {
        const filters = JSON.parse(requestUrl.searchParams.get('filters') || '{}');
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('invalid_filters');
        const ids = requestUrl.searchParams.has('ids') ? requestUrl.searchParams.get('ids').split(',').filter(Boolean).slice(0, 2000) : undefined;
        return json(response, 200, { options: await knowledge.suggestFacet({ group: requestUrl.searchParams.get('group'), query: requestUrl.searchParams.get('query') || '', search: requestUrl.searchParams.get('search')?.slice(0, 160), mode: requestUrl.searchParams.get('mode'), filters, ids }) });
      } catch { return json(response, 400, { error: '暂时无法读取这些筛选项。' }); }
    }
    if (request.method === 'GET' && path === '/api/catalog/global') {
      try { return json(response, 200, await discovery.search(requestUrl.searchParams.get('query'), Number(requestUrl.searchParams.get('page') || 1))); }
      catch (error) { return json(response, error instanceof TmdbError ? error.status : 400, { error: error instanceof TmdbError ? error.message : '搜索条件不正确。' }); }
    }
    if (request.method === 'GET' && /^\/api\/catalog\/movie\/[\w-]+$/.test(path)) {
      const id = path.split('/').at(-1);
      try {
        let movie = await knowledge.getMovie(id);
        if (id.startsWith('tmdb-') && (!movie || !movie.minutes)) [movie] = await discovery.importIds([Number(id.slice(5))]);
        return json(response, movie ? 200 : 404, movie ? { movie } : { error: '暂时找不到这部电影。' });
      } catch (error) { return json(response, error instanceof TmdbError ? error.status : 502, { error: error instanceof TmdbError ? error.message : '电影资料暂时无法读取。' }); }
    }
    if (request.method === 'GET' && path === '/api/douban/categories') return json(response, 200, { categories: doubanCategories, regions: doubanRegions });
    if (request.method === 'GET' && path.startsWith('/api/douban/movie/')) {
      try {
        const segments = path.slice('/api/douban/movie/'.length).split('/');
        const ranking = await douban.getRanking({ category: segments[0], region: segments[1] ? decodeURIComponent(segments[1]) : '全部', start: Number(requestUrl.searchParams.get('start') || 0), limit: Number(requestUrl.searchParams.get('limit') || 20) });
        return json(response, 200, ranking);
      } catch (error) { return json(response, error instanceof DoubanError ? error.status : 502, { error: error instanceof DoubanError ? error.message : '豆瓣榜单暂时无法读取。', code: error.code || 'douban_unavailable' }); }
    }
    if (request.method === 'GET' && ['/api/catalog', '/api/assistant/status'].includes(path)) {
      try {
        const stats = await knowledge.stats();
        if (path === '/api/assistant/status') return json(response, 200, { ready: true, mode: config.apiKey ? 'deepseek' : 'local', ...stats });
        let filters = {}, ids;
        try { filters = JSON.parse(requestUrl.searchParams.get('filters') || '{}'); ids = requestUrl.searchParams.has('ids') ? requestUrl.searchParams.get('ids').split(',').filter(Boolean).slice(0, 2000) : undefined; }
        catch { return json(response, 400, { error: '筛选条件格式不正确。' }); }
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return json(response, 400, { error: '筛选条件格式不正确。' });
        return json(response, 200, { ...await knowledge.queryCatalog({ filters, ids, query: requestUrl.searchParams.get('query'), mode: requestUrl.searchParams.get('mode'), sort: requestUrl.searchParams.get('sort'), limit: requestUrl.searchParams.get('limit'), offset: requestUrl.searchParams.get('offset'), facets: requestUrl.searchParams.get('facets') === '1' }), ...stats });
      } catch { return json(response, 503, { error: '电影资料暂时无法读取，请稍后重试。', code: 'catalog_unavailable' }); }
    }
    if (request.method === 'POST' && path === '/api/assistant/chat') {
      const client = process.env.VERCEL ? String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim() : request.socket?.remoteAddress || 'local';
      const now = Date.now();
      const recent = (requests.get(client) || []).filter(time => now - time < 60000);
      if (recent.length >= 24) return json(response, 429, { error: '请求比较频繁，请稍等片刻。', code: 'rate_limit' });
      if (knowledge.consumeRateLimit && !await knowledge.consumeRateLimit('ai:' + client)) return json(response, 429, { error: '请求比较频繁，请稍等片刻。', code: 'rate_limit' });
      if (requests.size > 5000) requests.clear();
      requests.set(client, [...recent, now]);
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.on('close', cancel);
      try {
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AssistantError('对话格式不正确。', 'invalid_request', 400);
        const result = await answerQuestion({ knowledge, config, messages: body.messages, mode: body.mode || 'auto', signal: controller.signal, fetchImpl });
        if (!result.movies) result.movies = (await Promise.all(result.recommendations.map(item => knowledge.getMovie(item.id)))).filter(Boolean);
        if (!controller.signal.aborted) json(response, 200, result);
      } catch (error) {
        if (!controller.signal.aborted && !response.writableEnded) json(response, error instanceof AssistantError ? error.status : 500, { error: error instanceof AssistantError ? error.message : '暂时无法完成检索，请重试。', code: error instanceof AssistantError ? error.code : 'internal_error' });
      } finally { response.removeListener('close', cancel); }
      return;
    }
    if (path.startsWith('/api/')) return json(response, 404, { error: '接口不存在。' });
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: '不支持此请求。' });
    const dist = resolve(projectRoot, 'dist');
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return json(response, 400, { error: '网址格式不正确。' }); }
    let file = resolve(dist, '.' + decoded);
    if (!file.startsWith(dist + sep) && file !== dist) return json(response, 404, { error: '页面不存在。' });
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(path)) return json(response, 404, { error: '文件不存在。' });
      file = resolve(dist, 'index.html');
    }
    if (!existsSync(file)) return json(response, 404, { error: '请先构建前端，或使用开发服务。' });
    const extension = extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
    const acceptsGzip = (request.headers['accept-encoding'] || '').split(',').some(part => {
      const [encoding, ...parameters] = part.trim().split(';');
      const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    const compressed = acceptsGzip && ['.html', '.css', '.js', '.svg', '.json'].includes(extension);
    const original = readFileSync(file);
    const content = compressed ? gzipSync(original) : original;
    const cache = /[\\/]assets[\\/].+-[\w-]+\.(js|css)$/.test(file) ? 'public, max-age=31536000, immutable' : ['.webp', '.svg'].includes(extension) ? 'public, max-age=86400' : 'no-cache';
    response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache, Vary: 'Accept-Encoding', 'Content-Length': content.length, ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(request.method === 'HEAD' ? undefined : content);
  };
}

export function createAppServer(options) {
  return createServer(createAppHandler(options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createAppServer();
  server.listen(Number(process.env.API_PORT || 8787), process.env.API_HOST || '127.0.0.1', () => console.log(`Movie knowledge API: http://${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || 8787} (${process.env.DEEPSEEK_API_KEY ? 'DeepSeek configured' : 'local catalog search'})`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'API port is already in use.' : 'Could not start the API server.'); process.exitCode = 1; });
}
