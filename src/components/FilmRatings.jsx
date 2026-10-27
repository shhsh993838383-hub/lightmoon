export default function FilmRatings({ movie, detailed = false }) {
  const ratings = [
    { id: 'lightmoon', label: '光幕', value: movie.lightmoonRating?.average, suffix: '', scale: 10, count: movie.lightmoonRating?.votes },
    { id: 'tmdb', label: 'TMDB', value: movie.tmdbRating?.average, suffix: '', scale: 10, count: movie.tmdbRating?.votes },
    { id: 'douban', label: '豆瓣', value: movie.doubanRating?.average, suffix: '', scale: 10, count: movie.doubanRating?.votes },
    { id: 'rotten', label: '烂番茄', value: movie.rottenTomatoesRating?.critics?.score, suffix: '%', scale: 100, count: movie.rottenTomatoesRating?.critics?.reviews },
  ];
  const audience = movie.rottenTomatoesRating?.audience;
  return <div className={detailed ? 'film-ratings-detail' : 'film-ratings-compact'}>
    <dl className="film-ratings" aria-label="电影平台评分">{ratings.map(item => {
      const known = Number.isFinite(item.value) && item.value >= 0 && item.value <= item.scale;
      const display = known ? item.scale === 100 ? `${Math.round(item.value)}%` : item.value.toFixed(1) : '暂无评分';
      return <div className={`film-rating ${known ? '' : 'is-unrated'}`} key={item.id}>
        <dt>{item.label}{detailed && (item.id === 'rotten' ? '新鲜度' : '评分')}</dt>
        <dd aria-label={`${item.label}${known ? ` ${display}${item.scale === 10 ? ' / 10 分' : ' 新鲜度'}` : '暂无评分'}`}><strong>{display}</strong>{known && detailed && item.scale === 10 && <span className="rating-scale"> / 10</span>}</dd>
        {detailed && <span className="rating-count">{known ? item.count ? `${item.count.toLocaleString('zh-CN')} ${item.id === 'rotten' ? '篇影评' : '人评分'}` : '评分人数未提供' : item.id === 'lightmoon' ? '等你来打第一分' : '暂未取得可核对的评分'}</span>}
      </div>;
    })}</dl>
    {detailed && Number.isFinite(audience?.score) && <p className="rating-audience">烂番茄观众好评率 <strong>{Math.round(audience.score)}%</strong>{audience.verified ? ' · 认证观众' : ''}</p>}
    {detailed && <p className="rating-explanation">光幕为本站用户的十分制评分均值。TMDB、豆瓣为十分制；烂番茄为专业影评好评比例，外部评分随资料同步更新。</p>}
  </div>;
}
