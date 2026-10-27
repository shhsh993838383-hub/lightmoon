export const facets = [
  { id: 'genre', label: '电影类型', options: ['剧情', '喜剧', '爱情', '科幻', '悬疑', '动画', '奇幻', '动作', '冒险', '犯罪', '纪录片', '家庭', '历史', '恐怖', '音乐', '惊悚', '战争', '西部', '电视电影'] },
  { id: 'mood', label: '想要的感觉', options: ['轻松有趣', '温暖', '浪漫', '感伤', '紧张', '荒诞'] },
  { id: 'theme', label: '故事主题', options: ['自我探索', '亲密关系', '成长', '友情', '家庭', '社会观察'] },
  { id: 'country', label: '国家 / 地区', options: [], searchable: true, placeholder: '查找出品国家或地区' },
  { id: 'director', label: '导演', options: [], searchable: true, placeholder: '查找导演' },
  { id: 'cast', label: '演员', options: [], searchable: true, placeholder: '查找演员' },
  { id: 'decade', label: '上映年代', options: ['2020 年代', '2010 年代', '2000 年代', '1990 年代', '1980 年代', '1970 年代', '1960 年代', '1950 年代', '1940 年代', '1940 年前'] },
  { id: 'language', label: '语言', options: [], searchable: true, placeholder: '查找电影语言' },
  { id: 'pace', label: '故事节奏', options: ['舒缓', '层层推进', '快速'] },
  { id: 'structure', label: '叙事方式', options: ['顺叙为主', '多线叙事', '时间循环', '框架叙事', '多层梦境'] },
  { id: 'duration', label: '有多少时间', options: ['100 分钟以内', '101-120 分钟', '120 分钟以上'] },
  { id: 'exclude', label: '暂时不想看', options: ['感伤', '紧张', '荒诞'] },
];

export const emptyFilters = () => Object.fromEntries(facets.map(facet => [facet.id, []]));

export function toggleFilter(filters, group, value) {
  const selected = filters[group] || [];
  const next = { ...filters, [group]: selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value] };
  if (next[group].includes(value)) {
    if (group === 'mood') next.exclude = filters.exclude.filter(item => item !== value);
    if (group === 'exclude') next.mood = filters.mood.filter(item => item !== value);
  }
  return next;
}

export function durationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes <= 100 ? '100 分钟以内' : minutes <= 120 ? '101-120 分钟' : '120 分钟以上';
}

export function facetValues(movie, group) {
  if (group === 'duration') return [durationLabel(movie.minutes)].filter(Boolean);
  if (group === 'decade') return Number.isInteger(movie.year) && movie.year > 0 ? [movie.year < 1940 ? '1940 年前' : `${Math.floor(movie.year / 10) * 10} 年代`] : [];
  if (['country', 'language', 'director'].includes(group)) return [...new Set(String(movie[group] || '').split(' / ').map(value => value.trim()).filter(Boolean))];
  if (group === 'cast') return [...new Set((movie.cast || []).map(person => person.name).filter(Boolean))];
  return Array.isArray(movie[group]) ? movie[group] : [];
}

export function facetSuggestions(movies, { group, query = '', filters = emptyFilters(), mode = 'any', limit = 12 } = {}) {
  if (!facets.some(facet => facet.id === group && facet.searchable)) return [];
  const selected = filters[group] || [];
  const combine = selected.length > 0 && mode !== 'all';
  const base = movies.filter(movie => matchesFilters(movie, combine ? { ...filters, [group]: [] } : filters, mode));
  const currentTotal = combine ? movies.filter(movie => matchesFilters(movie, filters, mode)).length : 0;
  const needle = query.trim().toLocaleLowerCase();
  const counts = new Map();
  for (const movie of base) for (const value of facetValues(movie, group)) {
    if (selected.includes(value) || !value.toLocaleLowerCase().includes(needle)) continue;
    if (!counts.has(value)) counts.set(value, currentTotal);
    if (!combine || !facetValues(movie, group).some(tag => selected.includes(tag))) counts.set(value, counts.get(value) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN')).slice(0, limit);
}

export function matchesFilters(movie, filters, mode = 'any') {
  return facets.every(facet => {
    const selected = filters[facet.id] || [];
    if (!selected.length) return true;
    if (facet.id === 'exclude') return movie.mood.length > 0 && !selected.some(value => movie.mood.includes(value));
    const values = facetValues(movie, facet.id);
    return mode === 'all' ? selected.every(value => values.includes(value)) : selected.some(value => values.includes(value));
  });
}

export function matchesQuery(movie, query) {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return true;
  return [movie.title, movie.originalTitle, ...(movie.aliases || []), movie.director, ...(movie.cast || []).map(person => person.name), ...(movie.keywords || []), movie.country, movie.language, movie.year, ...movie.genre, ...movie.theme, ...movie.mood].join(' ').toLocaleLowerCase().includes(search);
}

export function sortMovies(movies, sort) {
  const result = [...movies];
  const knownFirst = (a, b, field, direction = 1) => {
    if (!Number.isFinite(a[field])) return Number.isFinite(b[field]) ? 1 : 0;
    if (!Number.isFinite(b[field])) return -1;
    return direction * (a[field] - b[field]);
  };
  if (sort === 'newest') result.sort((a, b) => knownFirst(a, b, 'year', -1));
  if (sort === 'oldest') result.sort((a, b) => knownFirst(a, b, 'year'));
  if (sort === 'shortest') result.sort((a, b) => knownFirst(a, b, 'minutes'));
  if (sort === 'rating') result.sort((a, b) => (b.tmdbRating?.average ?? -1) - (a.tmdbRating?.average ?? -1) || (b.tmdbRating?.votes ?? 0) - (a.tmdbRating?.votes ?? 0));
  return result;
}

export const collections = [
  { id: 'departure', title: '去远方，也找到自己', description: '让生活的半径，再大一点。', movies: ['walter-mitty', 'soul', 'truman'], filters: { theme: ['自我探索'] }, theme: 'departure' },
  { id: 'romance', title: '关于爱，关于相遇', description: '那些值得反复回味的心动。', movies: ['flipped', 'roman-holiday', 'amelie'], filters: { genre: ['爱情'], mood: ['浪漫'] }, theme: 'romance' },
  { id: 'imagination', title: '想象力没有边界', description: '暂时离开熟悉的世界。', movies: ['interstellar', 'inception', 'coco'], filters: { genre: ['科幻', '奇幻'] }, theme: 'imagination' },
  { id: 'everyday', title: '在平常日子里停一停', description: '慢一点，也有很多好故事。', movies: ['our-little-sister', 'totoro', 'flipped'], filters: { pace: ['舒缓'], mood: ['温暖'] }, theme: 'everyday' },
];
