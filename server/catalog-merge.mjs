import { meetsRatingPolicy } from '../src/lib/rating-policy.js';

const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function mergeCatalog(seeds, imported) {
  const result = new Map(seeds.map(movie => [movie.id, movie]));
  for (const movie of imported) {
    if (!Number.isSafeInteger(movie.tmdbId) || movie.source?.provider !== 'tmdb') continue;
    const names = new Set([movie.title, movie.originalTitle, ...(movie.aliases || [])].map(key).filter(Boolean));
    const seed = seeds.find(item => movie.curatedId === item.id || item.tmdbId === movie.tmdbId || item.imdbId && item.imdbId === movie.imdbId || item.year === movie.year && [item.title, item.originalTitle].some(name => name && names.has(key(name))));
    if (seed) {
      result.set(seed.id, { ...seed, ...movie, id: seed.id, title: seed.title, originalTitle: seed.originalTitle || movie.originalTitle, aliases: [...new Set([movie.title, movie.originalTitle, ...(seed.aliases || []), ...(movie.aliases || [])].filter(Boolean))], year: movie.year ?? seed.year, minutes: movie.minutes ?? seed.minutes, director: seed.director || movie.director, text: movie.text || seed.text, poster: seed.poster || movie.poster, genre: [...new Set([...seed.genre, ...movie.genre])], mood: seed.mood, theme: seed.theme, pace: seed.pace, structure: seed.structure, tagStatus: seed.tagStatus, editorialSource: seed.source });
    } else result.set(movie.id, movie);
  }
  return [...result.values()].filter(meetsRatingPolicy);
}
