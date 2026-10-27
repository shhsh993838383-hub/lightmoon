import { useCallback, useEffect, useRef, useState } from 'react';
import seedMovies from '../data/movies.json';
import { apiUrl, hasApi } from './urls.js';
import { facets, matchesFilters, matchesQuery, sortMovies, toggleFilter } from './catalog.js';
import { meetsRatingPolicy } from './rating-policy.js';
import { readStaticCatalog } from './static-catalog.js';

export default function useCatalog({ query, filters, mode, sort, saved, watched, view, collection, revision }) {
  const [movies, setMovies] = useState(() => seedMovies.filter(meetsRatingPolicy));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [usingSnapshot, setUsingSnapshot] = useState(!hasApi);
  const snapshotOnly = useRef(!hasApi);
  const request = useRef(null);
  const resultRef = useRef(null);
  const input = JSON.stringify({ query, filters, mode, sort, ids: view === 'saved' ? saved : view === 'watched' ? watched : view === 'collection' ? collection?.movies.map(movie => movie.id) : undefined });
  const remember = useCallback(incoming => setMovies(current => [...new Map([...current, ...incoming].map(movie => [movie.id, movie])).values()].filter(meetsRatingPolicy)), []);

  const load = useCallback(async (offset = 0) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(false);
    const selected = JSON.parse(input);
    let pageOffset = offset;
    let pageLimit = 40;
    const parameters = new URLSearchParams({ query: selected.query, filters: JSON.stringify(selected.filters), mode: selected.mode, sort: selected.sort, limit: '40', offset: String(offset), facets: offset ? '0' : '1' });
    if (selected.ids) parameters.set('ids', selected.ids.join(','));
    try {
      let catalog;
      if (!snapshotOnly.current) {
        try {
          const response = await fetch(apiUrl('/api/catalog?' + parameters), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) });
          if (!response.ok) throw new Error();
          catalog = await response.json();
          if (!Array.isArray(catalog.movies) || !Number.isInteger(catalog.total)) throw new Error();
        } catch (failure) {
          if (controller.signal.aborted) throw failure;
          // Keep browsing the complete snapshot until the visitor retries the API.
          catalog = null;
          // A snapshot may use a different order; rebuild earlier pages together.
          pageOffset = 0;
          pageLimit += offset;
          snapshotOnly.current = true;
          setUsingSnapshot(true);
        }
      }
      if (!catalog) {
        const snapshot = await readStaticCatalog();
        if (controller.signal.aborted) return;
        const library = snapshot.movies.filter(movie => (!selected.ids || selected.ids.includes(movie.id)) && matchesQuery(movie, selected.query));
        const order = new Map((selected.ids || []).map((id, index) => [id, index]));
        const eligible = library.filter(movie => matchesFilters(movie, selected.filters, selected.mode));
        const found = selected.sort === 'collection' ? eligible.sort((a, b) => order.get(a.id) - order.get(b.id)) : sortMovies(eligible, selected.sort);
        const facetCounts = Object.fromEntries(facets.map(facet => [facet.id, Object.fromEntries(facet.options.map(value => [value, library.filter(movie => matchesFilters(movie, toggleFilter(selected.filters, facet.id, value), selected.mode)).length]))]));
        catalog = { ...snapshot, movies: found.slice(pageOffset, pageOffset + pageLimit), total: found.length, facetCounts, offset: pageOffset, limit: pageLimit };
        remember(snapshot.movies);
      }
      if (!Array.isArray(catalog.movies) || !Number.isInteger(catalog.total)) throw new Error();
      if (controller.signal.aborted) return;
      const previous = resultRef.current;
      const next = { ...catalog, key: input, movies: pageOffset && previous?.key === input ? [...previous.movies, ...catalog.movies] : catalog.movies, facetCounts: catalog.facetCounts || previous?.facetCounts };
      resultRef.current = next; setResult(next); remember(catalog.movies);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (request.current === controller) setLoading(false); }
  }, [input, remember]);

  useEffect(() => {
    const timer = setTimeout(() => load(), query ? 250 : 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [load, query, revision]);

  return { movies, remember, result: result?.key === input ? result : null, loading, error, usingSnapshot, reload: () => { snapshotOnly.current = !hasApi; setUsingSnapshot(!hasApi); return load(); }, loadMore: () => { if (!loading && resultRef.current?.key === input) load(resultRef.current.movies.length); } };
}
