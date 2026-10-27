export const scoreFacets = [
  { id: 'tmdbScore', label: 'TMDB', maximum: 10, step: 0.1, unit: '分', path: ['tmdbRating', 'average'], presets: [6, 7, 8] },
  { id: 'doubanScore', label: '豆瓣', maximum: 10, step: 0.1, unit: '分', path: ['doubanRating', 'average'], presets: [6, 7, 8] },
  { id: 'rottenTomatoesScore', label: '烂番茄', maximum: 100, step: 1, unit: '%', path: ['rottenTomatoesRating', 'critics', 'score'], presets: [60, 80, 90] },
].map(facet => ({ ...facet, range: true, options: [] }));

export function parseScoreRange(facet, value) {
  if (!facet?.range || typeof value !== 'string' || !/^\d+(?:\.\d)?:\d+(?:\.\d)?$/.test(value)) return null;
  const [min, max] = value.split(':').map(Number);
  if (min < 0 || max > facet.maximum || min > max || (facet.maximum === 100 && (!Number.isInteger(min) || !Number.isInteger(max)))) return null;
  return { min, max };
}

export function scoreRangeLabel(facet, value) {
  const range = parseScoreRange(facet, value);
  return range ? `${facet.label} ${range.min}–${range.max}${facet.unit}` : '';
}

export const platformScore = (movie, facet) => facet.path.reduce((value, key) => value?.[key], movie);

export function matchesScoreRange(movie, facet, value) {
  const range = parseScoreRange(facet, value);
  const score = platformScore(movie, facet);
  return Boolean(range) && Number.isFinite(score) && score >= range.min && score <= range.max;
}
