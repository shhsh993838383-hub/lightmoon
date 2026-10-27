import { useEffect, useState } from 'react';
import { Check, MagnifyingGlass, X } from '@phosphor-icons/react';
import { apiUrl, hasApi } from '../lib/urls.js';
import { facetSuggestions } from '../lib/catalog.js';

export default function SearchableFacet({ facet, filters, mode, catalog, scope, onToggle }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const selected = filters[facet.id] || [];
  const visibleOptions = options.filter(option => !selected.includes(option.value) && option.value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const parameters = JSON.stringify({ group: facet.id, filters, mode, query, ...scope });
  useEffect(() => {
    const request = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true); setFailed(false);
      try {
        if (!hasApi) setOptions(facetSuggestions(catalog, { group: facet.id, filters, mode, query, limit: query ? 12 : 5 }));
        else {
          const input = JSON.parse(parameters);
          const params = new URLSearchParams({ group: input.group, query: input.query, filters: JSON.stringify(input.filters), mode: input.mode, search: input.search || '' });
          if (input.ids) params.set('ids', input.ids.join(','));
          const response = await fetch(apiUrl('/api/catalog/facets?' + params), { signal: AbortSignal.any([request.signal, AbortSignal.timeout(18000)]) });
          if (!response.ok) throw new Error();
          const result = await response.json();
          if (!Array.isArray(result.options)) throw new Error();
          if (!request.signal.aborted) setOptions(result.options.slice(0, query ? 12 : 5));
        }
      } catch { if (!request.signal.aborted) { setOptions([]); setFailed(true); } }
      finally { if (!request.signal.aborted) setPending(false); }
    }, query ? 240 : 0);
    return () => { clearTimeout(timer); request.abort(); };
  }, [parameters, catalog]);
  return <section className="filter-group searchable-facet" aria-label={facet.label}>
    <h3>{facet.label}</h3>
    {selected.length > 0 && <div className="filter-options selected-facet-options">{selected.map(value => <button className="filter-chip" aria-pressed="true" aria-label={`取消${facet.label}：${value}`} onClick={() => onToggle(facet.id, value)} key={value}>{value}<X size={11} /></button>)}</div>}
    <label className="facet-search"><MagnifyingGlass size={14} /><input type="search" aria-label={facet.placeholder} placeholder={facet.placeholder} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="facet-suggestions" aria-busy={pending}>{visibleOptions.map(option => <button key={option.value} aria-label={`${facet.label}：${option.value} ${option.count} 部电影，点选筛选`} aria-pressed={false} onClick={() => { onToggle(facet.id, option.value); setQuery(''); }} disabled={selected.length >= 8}><span>{option.value}</span><span className="filter-count" aria-hidden="true">{option.count}</span><Check size={11} /></button>)}</div>
    {!visibleOptions.length && <p className="facet-search-status" role="status">{pending ? '正在查找…' : failed ? '暂时无法读取筛选项' : query ? '当前条件下没有匹配项' : selected.length ? '可继续输入名称查找' : '当前条件下暂无可选项'}</p>}
  </section>;
}
