import { apiUrl } from '../lib/urls.js';
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowUpRight, FilmSlate } from '@phosphor-icons/react';

const categories = { hot: '热门电影', latest: '最新电影', top: '豆瓣高分', underrated: '冷门佳片' };
export default function DoubanRankings() {
  const [category, setCategory] = useState('hot');
  const [region, setRegion] = useState('全部');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [start, setStart] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(apiUrl(`/api/douban/movie/${category}/${encodeURIComponent(region)}?limit=20&start=${start}`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) setResult(data); })
      .catch(issue => { if (!controller.signal.aborted) setError(issue.message || '暂时无法读取榜单。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [category, region, revision, start]);
  return <section className="douban-rankings" aria-label="豆瓣电影榜单">
    <div className="ranking-heading"><div><h2>大家最近在看</h2><p>从热门新片，到值得重看的好故事。</p></div><span className="ranking-label">豆瓣榜单</span></div>
    <div className="ranking-tabs" aria-label="榜单类型">{Object.entries(categories).map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setStart(0); }}>{label}</button>)}</div>
    <div className="ranking-regions" aria-label="榜单地区">{['全部', '华语', '欧美', '韩国', '日本'].map(value => <button key={value} aria-pressed={region === value} onClick={() => { setRegion(value); setStart(0); }}>{value}</button>)}</div>
    {loading ? <p className="ranking-status" role="status">正在寻找好电影…</p> : error ? <div className="catalog-notice" role="alert"><span>{error}</span><button onClick={() => setRevision(value => value + 1)}>重试<ArrowClockwise size={13} /></button></div> : <>
      {result?.stale && <p className="ranking-status">当前显示上次保存的榜单，正在等待接口恢复。</p>}
      <div className="ranking-grid">{result?.items.map((movie, index) => <a className="ranking-movie" key={movie.id} href={movie.page} target="_blank" rel="noreferrer"><span className="ranking-poster">{movie.poster ? <img src={movie.poster} alt={`${movie.title}电影海报`} width="150" height="225" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /> : <FilmSlate size={24} />}</span><span className="ranking-copy"><span className="ranking-number">{start + index + 1}</span><strong>{movie.title}<ArrowUpRight size={12} /></strong><span className="ranking-subtitle">{movie.year || '年份待补充'}{movie.rating ? ` / 豆瓣 ${movie.rating.average.toFixed(1)}` : ''}</span><span className="ranking-description">{movie.subtitle}</span></span></a>)}</div>
      {!result?.items.length && <p className="ranking-status">这份榜单暂时没有更多电影。</p>}
      <div className="ranking-pagination"><button className="secondary-button" disabled={!start} onClick={() => setStart(value => Math.max(0, value - 20))}>上一页</button><button className="secondary-button" disabled={(result?.items.length || 0) < 20} onClick={() => setStart(value => value + 20)}>下一页</button></div>
    </>}
  </section>;
}
