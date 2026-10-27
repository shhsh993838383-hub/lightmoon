import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, ArrowUpRight, CaretDown, Check, CheckCircle, ChatCircleDots, Compass, FilmSlate, Heart, Lightning, MagnifyingGlass, Moon, Shuffle, SlidersHorizontal, Smiley, Sparkle, Stack, Star, Sun, X } from '@phosphor-icons/react';
import seedMovies from './data/movies.json';
import DoubanRankings from './components/DoubanRankings.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import FilmRatings from './components/FilmRatings.jsx';
import SearchableFacet from './components/SearchableFacet.jsx';
import useCatalog from './lib/useCatalog.js';
import { apiUrl, assetUrl, hasApi } from './lib/urls.js';
import { collections, emptyFilters, facets, facetValues, matchesFilters, matchesQuery, sortMovies, toggleFilter } from './lib/catalog.js';

const AiMovieFinder = lazy(() => import('./components/AiMovieFinder.jsx'));

function readMovieList(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string' && /^[\w-]{1,120}$/.test(id)))] : [];
  } catch { return []; }
}

function readRatings() {
  try {
    const values = JSON.parse(localStorage.getItem('mujian-ratings') || '{}');
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return Object.fromEntries(Object.entries(values).filter(([id, value]) => /^[\w-]{1,120}$/.test(id) && Number.isInteger(value) && value >= 1 && value <= 10));
  } catch { return {}; }
}

function Poster({ movie, eager = false, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <span className={`poster ${loaded ? 'is-loaded' : ''} ${className}`}>
    {!loaded && !failed && movie.poster && <span className="poster-loading" aria-hidden="true" />}
    {failed || !movie.poster ? <span className="poster-failure"><FilmSlate size={30} /><span>{movie.poster ? '海报暂时无法显示' : '海报待补充'}</span></span> : <img src={assetUrl(movie.poster)} alt={`${movie.title}电影海报`} width={movie.posterWidth || 342} height={movie.posterHeight || 513} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager && movie.id === 'grand-budapest' ? 'high' : 'auto'} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
  </span>;
}

function FeaturedCollection({ movies, onOpen, onCollection }) {
  const [imageFailed, setImageFailed] = useState(false);
  const films = ['walter-mitty', 'truman', 'soul'].map(id => movies.find(movie => movie.id === id)).filter(Boolean);
  return <section className="featured-collection" aria-label="去远方，也找到自己主题片单">
    <div className="feature-stage">
      <div className="feature-copy">
        <span className="feature-category">给想出发的你</span>
        <h2>去远方，<br />也找到自己。</h2>
        <p>有些旅程，刚好从一部电影开始。</p>
        <button className="feature-link" onClick={onCollection}>打开这份片单<ArrowUpRight size={19} /></button>
      </div>
      <div className={`feature-artwork ${imageFailed ? 'has-fallback' : ''}`}>
        {imageFailed && films[0] ? <Poster movie={films[0]} eager /> : <picture><source type="image/avif" srcSet={`${assetUrl('/stills/walter-mitty-small.avif')} 780w, ${assetUrl('/stills/walter-mitty.avif')} 1280w`} sizes="(max-width: 767px) 100vw, (max-width: 1279px) 46vw, 620px" /><img src={assetUrl('/stills/walter-mitty.webp')} srcSet={`${assetUrl('/stills/walter-mitty-small.webp')} 780w, ${assetUrl('/stills/walter-mitty.webp')} 1280w`} sizes="(max-width: 767px) 100vw, (max-width: 1279px) 46vw, 620px" width="1280" height="720" alt="《白日梦想家》中，沃尔特坐在云雾环绕的群山之间" fetchPriority="high" decoding="async" onError={() => setImageFailed(true)} /></picture>}
      </div>
    </div>
    <div className="feature-films" aria-label="片单中的电影">
      {films.map(movie => <button key={movie.id} className="feature-film" onClick={() => onOpen(movie)} aria-label={`查看${movie.title} ${movie.year} / ${movie.genre[0]}`}>
        <Poster movie={movie} eager />
        <span className="feature-film-copy"><strong>{movie.title}</strong><span>{movie.year}<span className="feature-film-genre"> / {movie.genre[0]}</span></span></span>
        <ArrowUpRight size={15} />
      </button>)}
    </div>
  </section>;
}

function MovieCard({ movie, saved, watched, onSave, onWatched, onOpen, eager }) {
  return <article className="movie-card">
    <button className="poster-button" onClick={() => onOpen(movie)} aria-label={`查看${movie.title}`}><Poster movie={movie} eager={eager} /></button>
    <div className="movie-title-row"><button className="movie-title" onClick={() => onOpen(movie)}>{movie.title}</button><button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={() => onSave(movie.id)} aria-pressed={saved} aria-label={`${saved ? '从想看中移除' : '想看'}${movie.title}`}><Heart size={19} weight={saved ? 'fill' : 'regular'} /></button></div>
    <div className="movie-meta"><span>{movie.year || '年份待补充'}</span><span>{movie.genre.slice(0, 2).join(' / ')}</span></div>
    <div className="movie-caption"><span className="movie-moods">{movie.mood.length ? movie.mood.slice(0, 2).join(' / ') : movie.country}</span></div>
    <FilmRatings movie={movie} />
    <button className={`watched-toggle ${watched ? 'is-watched' : ''}`} aria-pressed={watched} aria-label={`${watched ? '已看过，取消标记' : '标记已看'} ${movie.title}`} onClick={() => onWatched(movie.id)}><CheckCircle size={15} weight={watched ? 'fill' : 'regular'} />{watched ? '已看过' : '标记已看'}</button>
  </article>;
}

function FilterGroup({ facet, filters, mode, catalog, onToggle, facetCounts }) {
  const [expanded, setExpanded] = useState(false);
  const options = facet.id === 'genre' && !expanded ? facet.options.filter((value, index) => index < 7 || filters.genre.includes(value)) : facet.options;
  const countAfter = value => facetCounts?.[facet.id]?.[value] ?? catalog.filter(movie => matchesFilters(movie, toggleFilter(filters, facet.id, value), mode)).length;
  return <section className="filter-group" aria-label={facet.label}>
    <h3>{facet.label}{facet.id === 'exclude' && <span className="filter-optional">排除</span>}</h3>
    <div className="filter-options">
      {options.map(value => {
        const selected = filters[facet.id].includes(value);
        const count = selected ? null : countAfter(value);
        return <button key={value} className={`filter-chip ${count === 0 ? 'is-unavailable' : ''}`} data-filter={facet.id} data-value={value} aria-pressed={selected} aria-label={selected ? `取消${facet.label}：${value}` : `${facet.label}：${value} ${count} 部电影，点选筛选`} onClick={() => onToggle(facet.id, value)}>{value}{selected ? <Check size={11} weight="bold" /> : <span className="filter-count" aria-hidden="true">{count}</span>}</button>;
      })}
    </div>
    {facet.id === 'genre' && <button className="more-genres" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起类型' : '更多类型'}<CaretDown size={11} /></button>}
  </section>;
}

function FilterPanel({ filters, mode, onMode, catalog, onToggle, onReset, onClose, total, facetCounts, scope }) {
  const activeCount = Object.values(filters).flat().length;
  return <div className="filter-panel">
    <div className="filter-panel-header"><span><SlidersHorizontal size={18} weight="bold" />筛选电影</span>{onClose ? <button className="icon-button" onClick={onClose} aria-label="关闭筛选"><X /></button> : <button className="reset-button" onClick={onReset} disabled={!activeCount}><ArrowCounterClockwise size={13} />重置</button>}</div>
    <div className="filter-rule"><label htmlFor={onClose ? 'match-mode-mobile' : 'match-mode'}>标签组合</label><span className="select-wrap"><select id={onClose ? 'match-mode-mobile' : 'match-mode'} value={mode} onChange={event => onMode(event.target.value)}><option value="any">同组任选</option><option value="all">同组全部</option></select><CaretDown size={12} /></span></div>
    <p className="filter-explanation">{mode === 'any' ? '同组满足任一项，跨组同时满足。' : '同时满足所有选中的标签。'}</p>
    <FilterGroup facet={facets[0]} {...{ filters, mode, catalog, onToggle, facetCounts }} />
    <details className="advanced-filters people-filters" open><summary>导演、演员与地区<CaretDown size={14} /></summary>{['director', 'cast', 'country'].map(id => facets.find(facet => facet.id === id)).map(facet => <SearchableFacet key={facet.id} {...{ facet, filters, mode, catalog, scope, onToggle }} />)}</details>
    {facets.filter(facet => ['mood', 'theme'].includes(facet.id)).map(facet => <FilterGroup key={facet.id} {...{ facet, filters, mode, catalog, onToggle, facetCounts }} />)}
    <details className="advanced-filters"><summary>年代、语言与更多筛选<CaretDown size={14} /></summary>{facets.filter(facet => !['genre', 'mood', 'theme', 'director', 'cast', 'country'].includes(facet.id)).map(facet => facet.searchable ? <SearchableFacet key={facet.id} {...{ facet, filters, mode, catalog, scope, onToggle }} /> : <FilterGroup key={facet.id} {...{ facet, filters, mode, catalog, onToggle, facetCounts }} />)}</details>
    <p className="filter-footnote">标签旁的数字表示点选后的电影数。<br />观感与主题仅匹配已完成标注的电影。</p>
    {onClose && <div className="filter-mobile-action"><button className="primary-button" onClick={onClose}>查看 {total} 部电影<ArrowRight size={17} /></button><button className="text-button" onClick={onReset} disabled={!activeCount}>清空条件</button></div>}
  </div>;
}

function Dialog({ open, onClose, className = '', label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prior; };
  }, [open]);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}

function FilmDetails({ movie, saved, watched, onSave, onWatched, onClose, onTag, rating, onRate, onDirector }) {
  return <Dialog open={Boolean(movie)} onClose={onClose} className="film-dialog" label={movie ? `${movie.title}电影详情` : '电影详情'}>
    {movie && <div className="film-detail-body">
      <button className="dialog-close icon-button" onClick={onClose} aria-label="关闭电影详情"><X size={22} /></button>
      <div className="detail-poster"><Poster key={movie.id} movie={movie} eager /></div>
      <div className="detail-information">
        <span className="detail-kicker">电影详情</span><h2>{movie.title}</h2><p className="original-title">{movie.originalTitle}</p>
        <div className="detail-basics"><span>{movie.year || '年份待补充'}</span><span>{movie.country || '地区待补充'}</span><span>{movie.minutes ? `${movie.minutes} 分钟` : '片长待补充'}</span></div>
        <div className="detail-director"><span>导演</span>{movie.director ? movie.director.split(' / ').map(name => <button key={name} onClick={() => onDirector(name)}>{name}<ArrowUpRight size={11} /></button>) : '待补充'}</div>
        {movie.cast?.length > 0 && <div className="detail-cast"><span>主演</span><div>{movie.cast.map(person => <button key={person.name} onClick={() => onTag('cast', person.name)}>{person.name}<ArrowUpRight size={11} /></button>)}</div></div>}
        <FilmRatings movie={movie} detailed />
        <p className="detail-description">{movie.text || '这部电影的中文简介暂未补充。'}</p>
        <div className="detail-list-actions"><button className={`primary-button ${saved ? 'is-added' : ''}`} onClick={() => onSave(movie.id)}><Heart weight={saved ? 'fill' : 'regular'} size={18} />{saved ? '已加入想看' : '加入想看'}</button><button className={`secondary-button ${watched ? 'is-watched' : ''}`} aria-pressed={watched} onClick={() => onWatched(movie.id)}><CheckCircle size={18} weight={watched ? 'fill' : 'regular'} />{watched ? '我已看过' : '标记已看'}</button></div>
        <div className="personal-rating"><label htmlFor="personal-movie-rating"><Star size={16} weight={rating ? 'fill' : 'regular'} />我的评分</label><span className="select-wrap"><select id="personal-movie-rating" value={rating || ''} onChange={event => onRate(movie.id, Number(event.target.value))}><option value="">尚未评分</option>{Array.from({ length: 10 }, (_, index) => 10 - index).map(value => <option value={value} key={value}>{value} 分</option>)}</select><CaretDown size={12} /></span><span>仅记录在此浏览器</span></div>
        <div className="detail-tag-groups">{facets.filter(facet => !['exclude', 'duration', 'director', 'cast'].includes(facet.id) && facetValues(movie, facet.id).length).map(facet => <div className="detail-tag-row" key={facet.id}><span>{facet.label}</span><div>{facetValues(movie, facet.id).map(value => <button className="detail-tag" key={value} onClick={() => onTag(facet.id, value)}>{value}<ArrowUpRight size={11} /></button>)}</div></div>)}</div>
        <p className="detail-note">{movie.tagStatus === 'tmdb-unreviewed' ? '这部电影的情绪、主题与节奏标签尚待标注。' : '点击标签，可以继续发现同类电影。观感标签供选片参考。'}</p>
      </div>
    </div>}
  </Dialog>;
}

function DataCredits({ open, onClose, total, tmdbCount, updatedAt }) {
  return <Dialog open={open} onClose={onClose} className="credits-dialog" label="关于光幕">
    <button className="dialog-close icon-button" onClick={onClose} aria-label="关闭关于光幕"><X size={22} /></button>
    <span className="detail-kicker">lightmoon</span><h2>关于光幕</h2>
    <p>光幕帮助你从类型、心情与故事出发，找到想看的电影。当前片库收录 {total} 部，其中 {tmdbCount || 0} 部已关联 TMDB 资料。</p>
    <a className="tmdb-credit-logo" href="https://www.themoviedb.org/" target="_blank" rel="noreferrer"><img src={assetUrl("/brand/tmdb.svg")} alt="The Movie Database (TMDB)" width="220" height="16" /></a>
    <p>影片资料、演职员、评分及部分海报来自 TMDB。资料用于帮助选片，影片信息可能随时间更新。</p>
    <p className="tmdb-attribution" lang="en">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    <p>平台评分分别来自 TMDB、豆瓣与 Rotten Tomatoes，使用 IMDb 标识及 Wikidata 的影片关联资料核对。烂番茄新鲜度为专业影评的好评比例，与十分制评分分开展示；无法核对的记录显示“暂无评分”。</p>
    <p>通常收录 TMDB ≥ 6 分、豆瓣 ≥ 6 分、烂番茄影评人新鲜度 ≥ 60% 的影片。若有评分低于门槛，但另一个平台高于 80%（TMDB 或豆瓣 &gt; 8 分、烂番茄 &gt; 80%），也会破格收录；等于 8 分或 80% 不触发破格。豆瓣 Top250 和系列片单保留完整收录例外。缺失评分显示“暂无评分”，烂番茄观众分不参与门槛。</p>
    <p>情绪、主题、节奏等观感标签为编辑标注，未完成标注的影片不参与相关条件筛选。“我的评分”仅保存在当前浏览器。</p>
    {updatedAt && <p className="credits-updated">最近同步：{new Date(updatedAt).toLocaleString('zh-CN')}</p>}
  </Dialog>;
}

const quickMoods = [
  { label: '轻松一下', value: '轻松有趣', Icon: Smiley },
  { label: '温暖治愈', value: '温暖', Icon: Sparkle },
  { label: '浪漫一点', value: '浪漫', Icon: Heart },
  { label: '来点紧张', value: '紧张', Icon: Lightning },
];

export default function App() {
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [view, setView] = useState('all');
  const [aiVisited, setAiVisited] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [mode, setMode] = useState('any');
  const [sort, setSort] = useState('curated');
  const [saved, setSaved] = useState(() => readMovieList('mujian-watchlist'));
  const [watched, setWatched] = useState(() => readMovieList('mujian-watched'));
  const [ratings, setRatings] = useState(readRatings);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [toast, setToast] = useState('');
  const resultsRef = useRef(null);
  const catalog = useCatalog({ query, filters, mode, sort, saved, watched, view, revision: catalogVersion });
  const { movies } = catalog;
  const catalogState = { loading: catalog.loading, error: catalog.error, updatedAt: catalog.result?.catalogUpdatedAt, tmdbCount: catalog.result?.tmdbCount };
  const library = useMemo(() => movies.filter(movie => (view !== 'saved' || saved.includes(movie.id)) && (view !== 'watched' || watched.includes(movie.id)) && matchesQuery(movie, query)), [movies, view, saved, watched, query]);
  const fallback = useMemo(() => sortMovies(library.filter(movie => matchesFilters(movie, filters, mode)), sort), [library, filters, mode, sort]);
  const found = catalog.result?.movies || fallback;
  const resultCount = catalog.result?.total ?? found.length;
  const movieCount = catalog.result?.movieCount ?? movies.length;
  const active = facets.flatMap(facet => filters[facet.id].map(value => ({ group: facet.id, groupLabel: facet.label, value })));
  const isFiltered = active.length > 0 || query.trim().length > 0;
  const showFeature = view === 'all' && !isFiltered;
  const navigate = next => { if (next === 'ai') setAiVisited(true); setView(next); setQuery(''); setFilters(emptyFilters()); setMobileFilters(false); };
  const toggle = (group, value) => setFilters(current => toggleFilter(current, group, value));
  const reset = () => { setFilters(emptyFilters()); setQuery(''); };

  useEffect(() => {
    if (!hasApi || !selectedMovie?.id.startsWith('tmdb-') || selectedMovie.minutes) return;
    const controller = new AbortController();
    fetch(apiUrl('/api/catalog/movie/' + selectedMovie.id), { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (!controller.signal.aborted && result.movie) { catalog.remember([result.movie]); setSelectedMovie(current => current?.id === selectedMovie.id ? result.movie : current); }
    }).catch(() => {});
    return () => controller.abort();
  }, [selectedMovie?.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2300);
    return () => clearTimeout(timer);
  }, [toast]);

  function changeTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem('mujian-theme', next); } catch { /* The active theme still works for this session. */ }
  }

  function saveMovie(id) {
    const included = saved.includes(id);
    const next = included ? saved.filter(item => item !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem('mujian-watchlist', JSON.stringify(next)); setToast(included ? '已从想看中移除' : '已加入我的想看'); }
    catch { setToast('已更新本次片单，浏览器暂时无法保存'); }
  }

  function rateMovie(id, value) {
    const next = { ...ratings };
    if (value >= 1 && value <= 10) next[id] = value; else delete next[id];
    setRatings(next);
    try { localStorage.setItem('mujian-ratings', JSON.stringify(next)); setToast(value ? '已记录我的评分' : '已移除我的评分'); } catch { setToast('已更新本次评分，浏览器暂时无法保存'); }
  }

  function markWatched(id) {
    const included = watched.includes(id);
    const next = included ? watched.filter(item => item !== id) : [...watched, id];
    setWatched(next);
    try { localStorage.setItem('mujian-watched', JSON.stringify(next)); setToast(included ? '已取消看过标记' : '已加入我已看过'); }
    catch { setToast('已更新本次记录，浏览器暂时无法保存'); }
  }

  function exploreDirector(name) {
    exploreTag('director', name);
  }

  function openCollection(collection) {
    setView('all'); setQuery(''); setMode('any');
    setFilters({ ...emptyFilters(), ...collection.filters });
    setTimeout(() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }), 0);
  }

  function exploreTag(group, value) {
    setView('all'); setQuery(''); setFilters({ ...emptyFilters(), [group]: [value] });
    setSelectedMovie(null);
  }

  const relaxations = facets.filter(facet => filters[facet.id].length).map(facet => ({ ...facet, count: library.filter(movie => matchesFilters(movie, { ...filters, [facet.id]: [] }, mode)).length })).filter(facet => facet.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  const filterProps = { filters, mode, onMode: setMode, catalog: library, onToggle: toggle, onReset: reset, total: resultCount, facetCounts: catalog.result?.facetCounts, scope: { search: query, ids: view === 'saved' ? saved : view === 'watched' ? watched : undefined } };
  const navItems = [{ id: 'all', label: '发现电影', Icon: Compass }, { id: 'collections', label: '主题片单', Icon: Stack }, { id: 'ai', label: 'AI 找电影', Icon: ChatCircleDots }, { id: 'saved', label: '我的想看', Icon: Heart }, { id: 'watched', label: '我已看过', Icon: CheckCircle }];

  return <>
    <a className="skip-link" href="#movie-library">跳到电影列表</a>
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => navigate('all')} aria-label="光幕 lightmoon 首页"><span className="brand-symbol"><FilmSlate size={26} weight="fill" /></span><span>光幕<span className="brand-latin">lightmoon</span></span></button><nav className="desktop-nav" aria-label="主导航">{navItems.map(item => <button className={view === item.id ? 'is-active' : ''} onClick={() => navigate(item.id)} key={item.id} aria-current={view === item.id ? 'page' : undefined}>{item.label}{(item.id === 'saved' ? saved.length : item.id === 'watched' ? watched.length : 0) > 0 && <span className="nav-count">{item.id === 'saved' ? saved.length : watched.length}</span>}</button>)}</nav><div className="header-tools"><div className="search-box"><MagnifyingGlass size={18} /><label className="sr-only" htmlFor="movie-search">搜索片名、导演、演员或标签</label><input id="movie-search" type="search" value={query} placeholder="搜索片名、导演、演员" onChange={event => { setQuery(event.target.value); if (['collections', 'ai'].includes(view)) setView('all'); }} />{query ? <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button> : <kbd aria-hidden="true">⌕</kbd>}</div><button className="icon-button theme-button" onClick={changeTheme} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>{theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}</button></div></div></header>

    <div className={`workspace ${['collections', 'ai'].includes(view) ? 'is-collections' : ''}`}>
      {!['collections', 'ai'].includes(view) && <aside className="desktop-filters"><FilterPanel {...filterProps} /></aside>}
      <main className="main-content" id="movie-library">
        {catalogState.error && <div className="catalog-notice" role="status"><span>暂时无法读取最新片库，先浏览已加载的电影。</span><button onClick={() => setCatalogVersion(value => value + 1)}>重新加载<ArrowCounterClockwise size={13} /></button></div>}
        {aiVisited && <div hidden={view !== 'ai'}><Suspense fallback={<p className="ai-loading" role="status">正在打开 AI 找电影…</p>}><AiMovieFinder movies={movies} saved={saved} onSave={saveMovie} onOpen={setSelectedMovie} active={view === 'ai'} /></Suspense></div>}
        {view !== 'ai' && <>
        <div className="page-intro"><div><h1>{view === 'watched' ? '看过的故事，都留在这里。' : view === 'saved' ? '好电影，留着慢慢看。' : view === 'collections' ? '跟着一个主题，走进电影。' : '找到此刻想看的电影。'}</h1><p>{view === 'watched' ? '记录那些陪你度过时光的电影，也可以随时重温。' : view === 'saved' ? '把心动的故事，留给下一个有空的晚上。' : view === 'collections' ? '把相似的感受，放在同一份片单里。' : '从类型、心情和故事出发，慢慢发现你的下一部。'}</p></div>{view !== 'collections' && <button className="random-button" aria-label="随机一部" onClick={() => { if (found.length) setSelectedMovie(found[Math.floor(Math.random() * found.length)]); }} disabled={!found.length}><Shuffle size={17} /><span>随机一部</span></button>}</div>

        {showFeature && <FeaturedCollection movies={movies} onOpen={setSelectedMovie} onCollection={() => openCollection(collections[0])} />}

        {view === 'collections' ? <><section className="collection-grid" aria-label="主题片单">{collections.map(collection => <button key={collection.id} className={`collection-tile collection-${collection.theme}`} onClick={() => openCollection(collection)}><span className="collection-cover">{collection.movies.map(id => { const movie = movies.find(item => item.id === id); return <Poster key={id} movie={movie} />; })}</span><span className="collection-title">{collection.title}<ArrowUpRight size={20} /></span><span className="collection-description">{collection.description}</span><span className="collection-total">打开片单</span></button>)}</section>{hasApi && <DoubanRankings />}</> : <>
          {view === 'all' && <section className="quick-moods" aria-label="按心情快速选择"><span className="quick-label">今天想要</span><div>{quickMoods.map(({ label, value, Icon }) => <button key={value} className="mood-button" aria-pressed={filters.mood.includes(value)} onClick={() => toggle('mood', value)}><Icon size={16} />{label}</button>)}</div></section>}
          <section className="library-results" ref={resultsRef} aria-label="筛选结果">
            <div className="library-toolbar"><div className="library-title"><h2>{view === 'watched' ? '我已看过' : view === 'saved' ? '我的想看' : isFiltered ? '为你找到' : '探索电影'}</h2><span className="result-count" aria-live="polite">{resultCount}<span> 部</span></span></div><div className="library-actions"><button className="mobile-filter-button" onClick={() => setMobileFilters(true)}><SlidersHorizontal size={17} />筛选{active.length > 0 && <span>{active.length}</span>}</button><span className="sort-select select-wrap"><label className="sr-only" htmlFor="movie-sort">电影排序</label><select id="movie-sort" value={sort} onChange={event => setSort(event.target.value)}><option value="curated">精选顺序</option><option value="newest">上映由新到旧</option><option value="oldest">上映由旧到新</option><option value="shortest">片长由短到长</option><option value="rating">TMDB 评分由高到低</option></select><CaretDown size={13} /></span></div></div>
            {view === 'all' && <p className="catalog-standard">通常门槛 <span>TMDB 6+ · 豆瓣 6+ · 烂番茄 60%+</span><br />另一平台高于 80% 可破格；Top250 与系列片单完整收录。</p>}
            {active.length > 0 && <div className="active-filters" aria-label="当前筛选条件">{active.map(item => <button key={`${item.group}-${item.value}`} onClick={() => toggle(item.group, item.value)} aria-label={`移除${item.groupLabel}：${item.value}`}>{item.group === 'exclude' ? '排除 ' : ''}{item.value}<X size={12} /></button>)}<button className="clear-all" onClick={reset}>清空</button></div>}
            {found.length ? <div className="movie-grid">{found.map((movie, index) => <MovieCard key={movie.id} movie={movie} saved={saved.includes(movie.id)} watched={watched.includes(movie.id)} onSave={saveMovie} onWatched={markWatched} onOpen={setSelectedMovie} eager={index < 5} />)}</div> : <div className="empty-state"><span className="empty-icon">{view === 'watched' && !watched.length ? <CheckCircle size={34} /> : view === 'saved' && !saved.length ? <Heart size={34} /> : <MagnifyingGlass size={34} />}</span><h3>{view === 'watched' && !watched.length ? '看过的电影，值得留个位置。' : view === 'saved' && !saved.length ? '下一部想看的，先放在这里。' : '暂时没有符合条件的电影'}</h3><p>{view === 'watched' && !watched.length ? '点击电影卡片或详情中的“标记已看”，把回忆收进这份片单。' : view === 'saved' && !saved.length ? '点一下电影旁的爱心，就能收藏到这份片单。' : query ? '换一个关键词，或放宽一些标签再试试。' : '试着少选一个条件，让故事有更多可能。'}</p><div className="empty-actions">{(view === 'saved' && !saved.length || view === 'watched' && !watched.length) ? <button className="primary-button" onClick={() => navigate('all')}>去发现电影<ArrowRight size={17} /></button> : <>{relaxations.map(facet => <button key={facet.id} className="secondary-button" onClick={() => setFilters(current => ({ ...current, [facet.id]: [] }))}>移除{facet.label}<span>{facet.count} 部</span></button>)}<button className="text-button" onClick={reset}>清空筛选与搜索</button></>}</div></div>}
            {resultCount > found.length && <div className="load-more"><button className="secondary-button" disabled={catalog.loading} onClick={catalog.loadMore}>{catalog.loading ? '正在加载…' : '再看更多电影'}<CaretDown size={14} /></button><span>已展示 {found.length} / {resultCount} 部</span></div>}
            <footer className="library-footer"><FilmSlate size={16} /><span>{catalogState.loading ? '正在读取片库…' : '片库已收录 ' + movieCount.toLocaleString('zh-CN') + ' 部电影。'}</span></footer>
            {hasApi && query.trim() && view === 'all' && <GlobalSearch key={query.trim()} query={query.trim()} onOpen={setSelectedMovie} onRemember={catalog.remember} />}
          </section>
        </>}
        <div className="site-credits"><span>光幕 lightmoon</span><button onClick={() => setCreditsOpen(true)}>关于光幕<ArrowUpRight size={12} /></button></div>
        </>}
      </main>
    </div>

    <nav className="mobile-nav" aria-label="手机主导航">{navItems.map(({ id, label, Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined}><Icon size={23} weight={view === id ? 'fill' : 'regular'} /><span>{label}</span></button>)}</nav>
    <Dialog open={mobileFilters} onClose={() => setMobileFilters(false)} className="filter-dialog" label="筛选电影">{mobileFilters && <FilterPanel {...filterProps} onClose={() => setMobileFilters(false)} />}</Dialog>
    <DataCredits open={creditsOpen} onClose={() => setCreditsOpen(false)} total={movieCount} tmdbCount={catalogState.tmdbCount} updatedAt={catalogState.updatedAt} />
    <FilmDetails movie={selectedMovie} watched={selectedMovie ? watched.includes(selectedMovie.id) : false} onWatched={markWatched} saved={selectedMovie ? saved.includes(selectedMovie.id) : false} onSave={saveMovie} onClose={() => setSelectedMovie(null)} onTag={exploreTag} rating={selectedMovie ? ratings[selectedMovie.id] : undefined} onRate={rateMovie} onDirector={exploreDirector} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </>;
}
