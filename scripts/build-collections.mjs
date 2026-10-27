import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createTmdbClient, normalizeTmdbMovie } from '../server/tmdb.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const read = (path, fallback = []) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const save = (path, value) => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.tmp', path); };
const key = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const today = new Date().toISOString().slice(0, 10);
const client = createTmdbClient();
const seeds = read('src/data/movies.json');
mkdirSync('.data', { recursive: true });

const rawTop = read('.data/douban-top250-source.json', null);
const savedTop = read('server/data/douban-top250.json', null);
const top = rawTop ? {
  updatedAt: rawTop.updatedAt,
  source: rawTop.source,
  items: rawTop.items.map(item => ({ doubanId: String(item.id), rank: Number(item.rank), title: item.title, year: Number(item.card_subtitle?.slice(0, 4)), subtitle: item.card_subtitle, tmdbId: savedTop?.items.find(previous => previous.doubanId === String(item.id))?.tmdbId, rating: { average: item.rating.value, votes: item.rating.count, updatedAt: rawTop.updatedAt } })),
} : savedTop;
if (!top || top.items.length !== 250 || new Set(top.items.map(item => item.doubanId)).size !== 250) throw new Error('需要真实、完整且无重复的豆瓣 Top250 榜单。');
save('server/data/douban-top250.json', top);

const previous = new Map([...read('.data/catalog-before-rating-policy.json'), ...read('server/data/initial-catalog.json'), ...read('.data/collection-checkpoint.json')].map(movie => [movie.tmdbId, movie]));
const records = new Map();
const definitions = [
  { id: 'marvel', title: '漫威电影宇宙', subtitle: 'MCU', description: '从钢铁侠出发，按上映时间走进漫威电影宇宙。收录已上映的剧情长片与特别篇。', keywords: [180547], featureOnly: true, theme: 'marvel' },
  { id: 'harry-potter', title: '哈利波特', subtitle: 'HARRY POTTER', description: '八部正传，从魔法石到最后的决战。', collectionIds: [1241], theme: 'magic' },
  { id: 'wizarding-world', title: '神奇动物', subtitle: 'FANTASTIC BEASTS', description: '纽特的魔法旅程，哈利波特故事之前的魔法世界。', collectionIds: [435259], theme: 'magic' },
  { id: 'middle-earth', title: '指环王与霍比特人', subtitle: 'MIDDLE-EARTH', description: '两组三部曲，按上映顺序重返中土。', collectionIds: [119, 121938], theme: 'earth' },
  { id: 'dc', title: 'DC 电影', subtitle: 'DC CINEMA', description: '收录 DCEU、DCU，以及蝙蝠侠、超人、小丑等主要真人电影系列。不同宇宙分别保留。', collectionIds: [263, 8537, 468552], keywords: [229266, 312528], movieIds: [268, 364, 414, 415, 414906, 475557, 889737, 1452, 44912, 314, 13183], featureOnly: true, theme: 'dc' },
  { id: 'fast-furious', title: '速度与激情', subtitle: 'FAST & FURIOUS', description: '从街头赛车到全球任务，含正传与特别行动。', collectionIds: [9485], theme: 'racing' },
  { id: 'star-wars', title: '星球大战', subtitle: 'STAR WARS', description: '天行者传奇九部曲，加入侠盗一号与游侠索罗。', collectionIds: [10], movieIds: [330459, 348350], theme: 'space' },
  { id: 'mission-impossible', title: '碟中谍', subtitle: 'MISSION: IMPOSSIBLE', description: '跟着伊森·亨特，按上映顺序完成每一次不可能的任务。', collectionIds: [87359], theme: 'racing' },
  { id: 'pirates', title: '加勒比海盗', subtitle: 'PIRATES OF THE CARIBBEAN', description: '杰克船长的五次冒险，从黑珍珠号开始。', collectionIds: [295], theme: 'earth' },
  { id: 'matrix', title: '黑客帝国', subtitle: 'THE MATRIX', description: '从红蓝药丸到矩阵重启，重访四部真人电影。', collectionIds: [2344], theme: 'dc' },
  { id: 'jurassic', title: '侏罗纪公园与世界', subtitle: 'JURASSIC', description: '公园、世界与重生，回到恐龙时代。', collectionIds: [328], theme: 'earth' },
];

async function details(id) {
  const known = previous.get(id);
  if (known?.minutes && known?.tmdbRating && known?.poster && known?.releaseDate && known?.cast?.length) return known;
  const raw = await client.get(`/movie/${id}`, { language: 'zh-CN', append_to_response: 'credits,keywords,translations,alternative_titles' });
  const movie = { ...known, ...normalizeTmdbMovie(raw, { curatedId: known?.curatedId }) };
  previous.set(id, movie);
  return movie;
}
async function batch(ids) {
  const result = [];
  for (let offset = 0; offset < ids.length; offset += 3) {
    const films = await Promise.all(ids.slice(offset, offset + 3).map(details));
    for (const movie of films) if (movie.poster && movie.releaseDate && movie.releaseDate <= today) { result.push(movie); records.set(movie.tmdbId, movie); }
    save('.data/collection-checkpoint.json', [...records.values()]);
  }
  return result;
}

const collections = [];
const unresolved = [];
const topMovies = [];
for (const item of top.items.sort((a, b) => a.rank - b.rank)) {
  let match = [...previous.values()].find(movie => String(movie.doubanId) === item.doubanId);
  if (!match && item.tmdbId) match = await details(item.tmdbId);
  if (!match) match = [...previous.values()].find(movie => movie.year === item.year && [movie.title, movie.originalTitle, ...(movie.aliases || [])].some(name => key(name) === key(item.title)));
  if (!match) {
    const results = await client.get('/search/movie', { query: item.title, language: 'zh-CN', include_adult: false, year: item.year });
    const candidates = (results.results || []).filter(movie => !movie.adult && Number(movie.release_date?.slice(0, 4)) === item.year);
    const exact = candidates.filter(movie => [movie.title, movie.original_title].some(name => key(name) === key(item.title)));
    if (exact.length === 1) match = await details(exact[0].id);
    if (!match) for (const candidate of candidates.slice(0, 4)) {
      const movie = await details(candidate.id);
      if ([movie.title, movie.originalTitle, ...(movie.aliases || [])].some(name => key(name) === key(item.title))) { match = movie; break; }
    }
    if (!match) {
      const broader = await client.get('/search/movie', { query: item.title, language: 'zh-CN', include_adult: false });
      const adjacent = (broader.results || []).filter(movie => !movie.adult && Math.abs(Number(movie.release_date?.slice(0, 4)) - item.year) <= 1 && [movie.title, movie.original_title].some(name => key(name) === key(item.title)));
      if (adjacent.length === 1) match = await details(adjacent[0].id);
      else unresolved.push({ ...item, candidates: [...candidates, ...(broader.results || [])].map(movie => ({ tmdbId: movie.id, title: movie.title, originalTitle: movie.original_title, date: movie.release_date })) });
    }
  }
  if (match) {
    match = await details(match.tmdbId);
    const movie = { ...match, title: item.title, aliases: [...new Set([match.title, ...(match.aliases || [])])], doubanId: item.doubanId, doubanRating: item.rating, doubanTop250Rank: item.rank, ratingLinks: { ...match.ratingLinks, doubanId: item.doubanId, linkMethod: movieYearMethod(match, item), linkedAt: top.updatedAt } };
    item.tmdbId = movie.tmdbId;
    records.set(movie.tmdbId, movie); previous.set(movie.tmdbId, movie); topMovies.push(movie);
  }
  if (item.rank % 25 === 0) { console.log(JSON.stringify({ stage: 'top250', processed: item.rank, matched: topMovies.length })); save('.data/collection-checkpoint.json', [...records.values()]); }
}
save('server/data/douban-top250.json', top);
save('.data/collection-unresolved.json', unresolved);
collections.push({ id: 'douban-top250', title: '豆瓣 Top250', subtitle: '250 FILMS', description: '豆瓣电影 Top250 完整榜单，按榜单名次浏览。', theme: 'top250', order: 'rank', updatedAt: top.updatedAt, source: 'https://movie.douban.com/top250', movies: topMovies });

for (const definition of definitions) {
  const ids = new Set(definition.movieIds || []);
  for (const id of definition.collectionIds || []) {
    const response = await client.get(`/collection/${id}`, { language: 'zh-CN' });
    for (const part of response.parts || []) if (!part.adult && part.release_date && part.release_date <= today) ids.add(part.id);
  }
  for (const keyword of definition.keywords || []) for (let page = 1; page <= 20; page++) {
    const found = await client.get('/discover/movie', { with_keywords: keyword, page, language: 'zh-CN', include_adult: false, include_video: false, 'primary_release_date.lte': today, sort_by: 'primary_release_date.asc' });
    for (const movie of found.results || []) ids.add(movie.id);
    if (page >= found.total_pages || !found.results?.length) break;
  }
  for (const id of definition.excludeIds || []) ids.delete(id);
  let movies = await batch([...ids]);
  if (definition.featureOnly) movies = movies.filter(movie => movie.minutes >= 40 && !movie.genre.includes('纪录片'));
  movies.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.tmdbId - b.tmdbId);
  const { collectionIds, keywords, movieIds, excludeIds, featureOnly, ...display } = definition;
  collections.push({ ...display, order: 'release', updatedAt: new Date().toISOString(), source: { provider: 'tmdb', collectionIds, keywords, movieIds }, movies });
  console.log(JSON.stringify({ stage: 'series', title: definition.title, movies: movies.length }));
}

const stableId = movie => seeds.find(seed => seed.tmdbId === movie.tmdbId || movie.curatedId === seed.id || seed.year === movie.year && [movie.title, movie.originalTitle, ...(movie.aliases || [])].map(key).includes(key(seed.title)))?.id || movie.id;
const compact = collections.map(collection => ({ ...collection, movies: collection.movies.map(movie => ({ id: stableId(movie), tmdbId: movie.tmdbId, title: movie.title, year: movie.year, releaseDate: movie.releaseDate, poster: movie.poster, ...(collection.order === 'rank' ? { rank: movie.doubanTop250Rank, doubanId: movie.doubanId } : {}) })) }));
save('src/data/series-collections.json', compact);
save('server/data/collection-movies.json', [...records.values()]);
console.log(JSON.stringify({ collections: compact.length, movies: records.size, top250: topMovies.length, unresolved: unresolved.map(item => ({ title: item.title, year: item.year })) }));
if (unresolved.length || topMovies.length !== 250 || new Set(topMovies.map(movie => movie.tmdbId)).size !== 250) process.exitCode = 1;

function movieYearMethod(movie, item) { return movie.year === item.year ? 'douban-top250-title-year' : 'douban-top250-title-adjacent-release-year'; }
