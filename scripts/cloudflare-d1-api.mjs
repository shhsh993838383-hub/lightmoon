import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function createD1Api() {
  const token = process.env.CLOUDFLARE_API_TOKEN || readFileSync(join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('请先使用官方 Wrangler 登录 Cloudflare。');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '4f20eb906bd31be599051a5f5c1af987';
  const database = process.env.CLOUDFLARE_D1_DATABASE_ID || '2c1d1a8b-2cf4-484a-a7ff-a65a1ea1d7b6';
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  return async (sql, params = []) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response, result;
      try {
        response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(60000) });
        result = await response.json();
      } catch {
        if (attempt < 3) { await delay(1000 * (attempt + 1)); continue; }
        throw new Error('Cloudflare D1 请求未能确认完成；请保留进度后重试。');
      }
      if (response.ok && result.success && result.result?.every(item => item.success !== false)) return result.result;
      const codes = result.errors?.map(item => item.code) || [];
      if ((response.status === 429 || response.status >= 500 || codes.some(code => [7009, 7500].includes(code))) && attempt < 3) { await delay(2000 * (attempt + 1)); continue; }
      throw new Error(`Cloudflare D1 请求失败（HTTP ${response.status}，错误代码 ${codes.join(',') || 'unknown'}）。`);
    }
  };
}
