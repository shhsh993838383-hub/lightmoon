import knownLowRatings from '../data/rating-exclusions.json' with { type: 'json' };
import specialCollections from '../data/series-collections.json' with { type: 'json' };

export const ratingPolicy = Object.freeze({ tmdb: 6, douban: 6, rottenTomatoes: 60, highScoreAbove: 80, collectionExceptions: true, version: 2 });
const known = new Map(knownLowRatings.flatMap(movie => [[movie.id, movie], [movie.tmdbId, movie]]));
const memberships = new Map();
for (const collection of specialCollections) for (const movie of collection.movies) for (const key of [movie.id, movie.tmdbId].filter(value => value !== undefined && value !== null)) {
  const values = memberships.get(key) || [];
  if (!values.includes(collection.title)) values.push(collection.title);
  memberships.set(key, values);
}

export function withKnownRatings(movie) {
  const previous = known.get(movie?.tmdbId) || known.get(movie?.id);
  if (!previous) return movie;
  return { ...previous, ...movie, tmdbRating: movie.tmdbRating ?? previous.tmdbRating, doubanRating: movie.doubanRating ?? previous.doubanRating, rottenTomatoesRating: movie.rottenTomatoesRating ?? previous.rottenTomatoesRating };
}

export const movieCollectionNames = movie => memberships.get(movie?.tmdbId) || memberships.get(movie?.id) || [];

export function admissionReason(input) {
  if (!input || typeof input !== 'object') return 'rejected';
  const movie = withKnownRatings(input);
  const violations = ratingPolicyViolations(movie);
  if (!violations.length) return 'standard';
  if (highScorePlatforms(movie).length) return 'high-score';
  if (movieCollectionNames(movie).length) return 'collection';
  return 'rejected';
}

export function highScorePlatforms(input) {
  const movie = withKnownRatings(input);
  return [['TMDB', movie?.tmdbRating?.average, 10], ['豆瓣', movie?.doubanRating?.average, 10], ['烂番茄', movie?.rottenTomatoesRating?.critics?.score, 100]]
    .filter(([, score, maximum]) => Number.isFinite(score) && score <= maximum && score / maximum * 100 > ratingPolicy.highScoreAbove)
    .map(([provider]) => provider);
}

export function ratingPolicyViolations(input) {
  const movie = withKnownRatings(input);
  const scores = [
    ['tmdb', movie?.tmdbRating?.average],
    ['douban', movie?.doubanRating?.average],
    ['rottenTomatoes', movie?.rottenTomatoesRating?.critics?.score],
  ];
  return scores.filter(([provider, score]) => Number.isFinite(score) && score < ratingPolicy[provider]).map(([provider]) => provider);
}

export const meetsRatingPolicy = movie => admissionReason(movie) !== 'rejected';
