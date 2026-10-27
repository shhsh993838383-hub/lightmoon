import { apiUrl, assetUrl } from '../lib/urls.js';
import { useState } from 'react';
import { ArrowRight, FilmSlate } from '@phosphor-icons/react';

export default function GlobalSearch({ query, onOpen, onRemember }) {
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function search(page = 1) {
    if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch(apiUrl(`/api/catalog/global?query=${encodeURIComponent(query)}&page=${page}`), { signal: AbortSignal.timeout(45000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data); onRemember(data.movies);
    } catch (issue) { setError(issue.message || '搜索暂时没有完成，请重试。'); }
    finally { setPending(false); }
  }
  return <section className="global-search" aria-label="搜索完整电影资料库"><div className="global-search-heading"><div><h3>继续寻找「{query}」</h3><p>搜索更多电影；上方标签用于已收录片库。</p></div><button className="secondary-button" disabled={pending} onClick={() => search()}>{pending ? '正在搜索…' : '搜索完整片库'}<ArrowRight size={14} /></button></div>
    {error && <p className="ranking-status" role="alert">{error}</p>}
    {result && <><p className="global-search-count">找到 {result.total} 个相关结果</p><div className="global-search-grid">{result.movies.map(movie => <button className="global-movie" key={movie.id} onClick={() => onOpen(movie)}><span className="global-movie-poster">{movie.poster ? <img src={assetUrl(movie.poster)} alt={`${movie.title}电影海报`} width="100" height="150" loading="lazy" /> : <FilmSlate size={24} />}</span><strong>{movie.title}</strong><span>{movie.year || '年份待补充'}</span></button>)}</div>{result.totalPages > 1 && <div className="ranking-pagination"><button className="secondary-button" disabled={pending || result.page <= 1} onClick={() => search(result.page - 1)}>上一页</button><span>{result.page} / {result.totalPages}</span><button className="secondary-button" disabled={pending || result.page >= result.totalPages} onClick={() => search(result.page + 1)}>下一页</button></div>}</>}
  </section>;
}
