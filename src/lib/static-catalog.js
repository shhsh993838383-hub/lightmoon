import { assetUrl } from './urls.js';
import { meetsRatingPolicy } from './rating-policy.js';

let staticCatalog;
export async function readStaticCatalog() {
  if (!staticCatalog) staticCatalog = fetch(assetUrl('/catalog.json'), { priority: 'low' }).then(async response => {
    if (!response.ok) throw new Error('catalog_unavailable');
    const data = await response.json();
    if (!Array.isArray(data.movies)) throw new Error('catalog_invalid');
    const movies = data.movies.filter(meetsRatingPolicy);
    return { ...data, movies, movieCount: movies.length, tmdbCount: movies.filter(movie => movie.tmdbId).length };
  }).catch(error => { staticCatalog = null; throw error; });
  return staticCatalog;
}
