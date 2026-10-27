export const ratingPolicy = Object.freeze({ tmdb: 6, douban: 6, rottenTomatoes: 60, version: 1 });

export function ratingPolicyViolations(movie) {
  const scores = [
    ['tmdb', movie?.tmdbRating?.average],
    ['douban', movie?.doubanRating?.average],
    ['rottenTomatoes', movie?.rottenTomatoesRating?.critics?.score],
  ];
  return scores.filter(([provider, score]) => Number.isFinite(score) && score < ratingPolicy[provider]).map(([provider]) => provider);
}

export const meetsRatingPolicy = movie => ratingPolicyViolations(movie).length === 0;
