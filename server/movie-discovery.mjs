import { createTmdbClient, matchCuratedResult, normalizeTmdbMovie } from './tmdb.mjs';
import { meetsRatingPolicy } from '../src/lib/rating-policy.js';

export function createMovieDiscovery({ client = createTmdbClient(), knowledge } = {}) {
  let imageConfig;
  const cache = new Map();
  const configuration = async () => imageConfig ||= (await client.get('/configuration')).images;
  async function importIds(ids) {
    const unique = [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 20);
    const movies = [];
    for (let index = 0; index < unique.length; index += 4) {
      const batch = await Promise.all(unique.slice(index, index + 4).map(async id => {
        const raw = await client.get(`/movie/${id}`, { language: 'zh-CN', append_to_response: 'credits,keywords,translations,alternative_titles' });
        return normalizeTmdbMovie(raw, { images: await configuration() });
      }));
      movies.push(...batch);
    }
    if (movies.length) await knowledge.upsertImported(movies);
    return (await Promise.all(movies.filter(meetsRatingPolicy).map(movie => knowledge.getByTmdb(movie.tmdbId)))).filter(movie => movie && meetsRatingPolicy(movie));
  }
  async function search(query, page = 1) {
    if (typeof query !== 'string' || !query.trim() || query.length > 160 || !Number.isInteger(page) || page < 1 || page > 500) throw new Error('invalid_query');
    const key = `${query}:${page}`;
    const previous = cache.get(key);
    if (previous && Date.now() - previous.at < 600000) return previous.result;
    const found = await client.get('/search/movie', { query, page, language: 'zh-CN', include_adult: false });
    const previews = (found.results || []).filter(movie => !movie.adult).map(raw => normalizeTmdbMovie({ ...raw, genres: (raw.genre_ids || []).map(id => ({ id })) }, { images: imageConfig })).filter(meetsRatingPolicy);
    const details = await importIds(previews.slice(0, 6).map(movie => movie.tmdbId));
    const byId = new Map(details.map(movie => [movie.tmdbId, movie]));
    const movies = (await Promise.all(previews.map(async movie => byId.get(movie.tmdbId) || await knowledge.getByTmdb(movie.tmdbId) || movie))).filter(meetsRatingPolicy);
    const result = { movies, page, totalPages: Math.min(500, found.total_pages || 0), total: found.total_results || movies.length };
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), result });
    return result;
  }
  async function matchDouban(item) {
    if (!meetsRatingPolicy({ doubanRating: item.rating })) return null;
    const result = await client.get('/search/movie', { query: item.title, year: item.year || undefined, language: 'zh-CN', include_adult: false });
    const match = matchCuratedResult({ title: item.title, year: item.year }, result.results || []);
    if (!match) return null;
    const [movie] = await importIds([match.id]);
    if (!movie) return null;
    const matched = { ...movie, doubanId: item.doubanId, doubanRating: item.rating, doubanPage: item.page };
    await knowledge.upsertImported([matched]);
    return matched;
  }
  return { search, importIds, matchDouban };
}
