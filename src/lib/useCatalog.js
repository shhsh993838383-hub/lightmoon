import { useCallback, useEffect, useRef, useState } from 'react';
import seedMovies from '../data/movies.json';
import { apiUrl, assetUrl, hasApi } from './urls.js';
import { facets, matchesFilters, matchesQuery, sortMovies, toggleFilter } from './catalog.js';

let staticCatalog;
async function readStaticCatalog() {
  // Let the visible film artwork load ahead of the full offline catalog.
  if (!staticCatalog) staticCatalog = fetch(assetUrl('/catalog.json'), { priority: 'low' }).then(async response => {
    if (!response.ok) throw new Error('catalog_unavailable');
    const data = await response.json();
    if (!Array.isArray(data.movies)) throw new Error('catalog_invalid');
    return data;
  }).catch(error => { staticCatalog = null; throw error; });
  return staticCatalog;
}

export default function useCatalog({ query, filters, mode, sort, saved, watched, view, revision }) {
  const [movies, setMovies] = useState(seedMovies);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(null);
  const resultRef = useRef(null);
  const input = JSON.stringify({ query, filters, mode, sort, ids: view === 'saved' ? saved : view === 'watched' ? watched : undefined });
  const remember = useCallback(incoming => setMovies(current => [...new Map([...current, ...incoming].map(movie => [movie.id, movie])).values()]), []);

  const load = useCallback(async (offset = 0) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(false);
    const selected = JSON.parse(input);
    const parameters = new URLSearchParams({ query: selected.query, filters: JSON.stringify(selected.filters), mode: selected.mode, sort: selected.sort, limit: '40', offset: String(offset), facets: offset ? '0' : '1' });
    if (selected.ids) parameters.set('ids', selected.ids.join(','));
    try {
      let catalog;
      if (hasApi) {
        const response = await fetch(apiUrl('/api/catalog?' + parameters), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) });
        if (!response.ok) throw new Error();
        catalog = await response.json();
      } else {
        const snapshot = await readStaticCatalog();
        const library = snapshot.movies.filter(movie => (!selected.ids || selected.ids.includes(movie.id)) && matchesQuery(movie, selected.query));
        const found = sortMovies(library.filter(movie => matchesFilters(movie, selected.filters, selected.mode)), selected.sort);
        const facetCounts = Object.fromEntries(facets.map(facet => [facet.id, Object.fromEntries(facet.options.map(value => [value, library.filter(movie => matchesFilters(movie, toggleFilter(selected.filters, facet.id, value), selected.mode)).length]))]));
        catalog = { ...snapshot, movies: found.slice(offset, offset + 40), total: found.length, facetCounts, offset, limit: 40 };
        remember(snapshot.movies);
      }
      if (!Array.isArray(catalog.movies) || !Number.isInteger(catalog.total)) throw new Error();
      if (controller.signal.aborted) return;
      const previous = resultRef.current;
      const next = { ...catalog, key: input, movies: offset && previous?.key === input ? [...previous.movies, ...catalog.movies] : catalog.movies, facetCounts: catalog.facetCounts || previous?.facetCounts };
      resultRef.current = next; setResult(next); remember(catalog.movies);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (request.current === controller) setLoading(false); }
  }, [input, remember]);

  useEffect(() => {
    const timer = setTimeout(() => load(), query ? 250 : 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [load, query, revision]);

  return { movies, remember, result: result?.key === input ? result : null, loading, error, reload: () => load(), loadMore: () => { if (!loading && resultRef.current?.key === input) load(resultRef.current.movies.length); } };
}
