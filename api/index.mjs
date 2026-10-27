import { createCloudKnowledgeBase } from '../server/cloud-knowledge.mjs';
import { createAppHandler } from '../server/index.mjs';
import { createDoubanClient } from '../server/douban.mjs';

let handler;
export default async function api(request, response) {
  try {
    if (!process.env.DATABASE_URL) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ error: '云端电影资料库尚未配置。', code: 'storage_not_configured' }));
    }
    const url = new URL(request.url, 'https://localhost');
    const route = url.searchParams.get('_route');
    if (route !== null) { url.pathname = '/api/' + route; url.searchParams.delete('_route'); request.url = url.pathname + url.search; }
    handler ||= createAppHandler({ knowledge: createCloudKnowledgeBase(), douban: createDoubanClient({ cachePath: null }) });
    await handler(request, response);
  } catch {
    if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    if (!response.writableEnded) response.end(JSON.stringify({ error: '电影服务暂时不可用，请稍后重试。' }));
  }
}
