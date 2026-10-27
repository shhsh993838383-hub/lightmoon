import { createTmdbClient, normalizeTmdbMovie, TmdbError } from './tmdb.mjs';
import { meetsRatingPolicy, ratingPolicy } from '../src/lib/rating-policy.js';

export async function expandTmdbCatalog({ client = createTmdbClient(), existing = [], target = 5000, concurrency = 4, onProgress = () => {}, onBatch = () => {} } = {}) {
  if (!Number.isInteger(target) || target < 1 || target > 10000) throw new TmdbError('目标片库数量应为 1 到 10000 部。', 'tmdb_invalid_limit', 400);
  const width = Math.max(1, Math.min(4, Math.floor(concurrency) || 4));
  const previous = new Map(existing.filter(movie => Number.isSafeInteger(movie.tmdbId)).map(movie => [movie.tmdbId, movie]));
  const records = new Map([...previous].filter(([, movie]) => movie.poster && meetsRatingPolicy(movie)));
  const seen = new Set([...previous].filter(([, movie]) => !meetsRatingPolicy(movie) || records.has(movie.tmdbId)).map(([id]) => id));
  const configuration = await client.get('/configuration');
  let processed = 0, skipped = 0, persisted = records.size;
  const checkpoint = async force => {
    if (force || records.size - persisted >= 50) { await onBatch([...records.values()]); persisted = records.size; }
  };
  try {
    for (let page = 1; page <= 500 && records.size < target; page++) {
      let hasResults = false;
      for (const country of ['CN', 'HK', 'TW', undefined]) {
        if (records.size >= target) break;
        const found = await client.get('/discover/movie', {
          page, language: 'zh-CN', include_adult: false, include_video: false,
          sort_by: 'vote_count.desc', 'vote_count.gte': 30, 'vote_average.gte': ratingPolicy.tmdb,
          'primary_release_date.lte': new Date().toISOString().slice(0, 10), with_origin_country: country,
        });
        hasResults ||= Boolean(found.results?.length);
        const ids = [];
        for (const movie of found.results || []) {
          if (!Number.isSafeInteger(movie.id) || movie.id <= 0 || seen.has(movie.id) || movie.adult || !movie.poster_path || !Number.isFinite(movie.vote_average) || movie.vote_average < ratingPolicy.tmdb || !(movie.vote_count > 0)) continue;
          seen.add(movie.id); ids.push(movie.id);
        }
        for (let offset = 0; offset < ids.length && records.size < target;) {
          const selected = ids.slice(offset, offset + Math.min(width, target - records.size));
          offset += selected.length;
          const batch = await Promise.all(selected.map(async id => {
            try {
              const raw = await client.get(`/movie/${id}`, { language: 'zh-CN', append_to_response: 'credits,keywords,translations,alternative_titles' });
              const movie = { ...previous.get(id), ...normalizeTmdbMovie(raw, { images: configuration.images, curatedId: previous.get(id)?.curatedId }) };
              return movie.poster && meetsRatingPolicy(movie) ? movie : null;
            } catch (error) {
              if (['tmdb_not_found', 'tmdb_invalid_record'].includes(error.code)) return null;
              throw error;
            }
          }));
          for (const movie of batch) { processed++; if (movie) records.set(movie.tmdbId, movie); else skipped++; }
          onProgress({ stage: 'importing', movieCount: records.size, target, processed, skipped, page });
          await checkpoint(false);
        }
      }
      if (!hasResults) break;
    }
  } finally { await checkpoint(true); }
  if (records.size < target) throw new TmdbError(`本轮只有 ${records.size} 部符合标准的电影，已保存进度，可继续导入。`, 'tmdb_target_incomplete');
  return { version: 1, updatedAt: new Date().toISOString(), movies: [...records.values()], processed, skipped, ratingPolicy };
}
