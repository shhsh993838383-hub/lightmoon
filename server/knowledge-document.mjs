export function tokenize(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  const words = normalized.match(/[a-z0-9]+/g) || [];
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) words.push(run);
    for (let index = 0; index < run.length - 1; index++) words.push(run.slice(index, index + 2));
  }
  return words;
}

export const movieDocument = movie => [movie.title, movie.originalTitle, ...(movie.aliases || []), movie.director, ...(movie.cast || []).map(person => person.name), ...(movie.keywords || []), movie.year || '', movie.minutes ? `${movie.minutes} 分钟` : '', movie.country, movie.language, ...movie.genre, ...movie.mood, ...movie.theme, ...movie.pace, ...movie.structure, movie.text].join('。');
