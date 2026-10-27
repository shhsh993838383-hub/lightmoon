import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react';
import series from '../data/series-collections.json' with { type: 'json' };
import { collections } from '../lib/catalog.js';

// Preserve Lightmoon's cool neutrals, vermilion, Manrope and poster-led magazine layout.
// DESIGN_VARIANCE 6 / MOTION_INTENSITY 4 / VISUAL_DENSITY 4. Native CSS; no new design system.
export default function CollectionBrowser({ movies, onOpen, Poster }) {
  const top = series.find(collection => collection.id === 'douban-top250');
  const lookup = new Map(movies.flatMap(movie => [[movie.id, movie], [movie.tmdbId, movie]]));
  const coverFilms = collection => collection.movies.slice(0, 3).map(movie => typeof movie === 'string' ? lookup.get(movie) : lookup.get(movie.tmdbId) || movie).filter(Boolean);
  const tile = (collection, special) => <button key={collection.id} className="collection-tile" onClick={() => onOpen(collection)}>
    <span className="collection-cover">{coverFilms(collection).map(movie => <Poster key={movie.id} movie={movie} />)}</span>
    <span className="collection-title">{collection.title}<ArrowUpRight size={20} /></span>
    <span className="collection-description">{collection.description}</span>
    <span className="collection-total">{special ? `${collection.movies.length} 部 · 按上映顺序` : '打开片单'}</span>
  </button>;
  return <div className="collection-browser">
    {top && <button className="top250-feature" onClick={() => onOpen(top)}>
      <span className="top250-copy"><span className="top250-count">250<span>部电影</span></span><strong>豆瓣 Top250</strong><span>那些被反复推荐的好故事，一次收齐。</span><span className="top250-link">按榜单名次浏览<ArrowRight size={17} /></span></span>
      <span className="top250-posters" aria-hidden="true">{coverFilms(top).map(movie => <Poster key={movie.id} movie={movie} />)}</span>
    </button>}
    <section aria-labelledby="series-heading"><div className="collection-section-heading"><h2 id="series-heading">一整个电影世界</h2><p>从第一部开始，跟完每一段故事。收录已上映影片，评分照实保留。</p></div><div className="collection-grid series-grid">{series.filter(collection => collection.id !== 'douban-top250').map(collection => tile(collection, true))}</div></section>
    <section aria-labelledby="mood-collections-heading"><div className="collection-section-heading"><h2 id="mood-collections-heading">跟着心情选一部</h2><p>把相似的感受，放在同一份片单里。</p></div><div className="collection-grid">{collections.map(collection => tile(collection, false))}</div></section>
  </div>;
}
