const aliases = {
  genre: { 爱情: ['爱情', '恋爱', '言情'], 喜剧: ['喜剧', '搞笑', '好笑'], 科幻: ['科幻', '外星', '太空'], 悬疑: ['悬疑', '推理', '烧脑'], 动画: ['动画', '动漫'], 奇幻: ['奇幻', '魔法'], 剧情: ['剧情'], 恐怖: ['恐怖', '鬼片'], 纪录片: ['纪录片'], 动作: ['动作片'] },
  mood: { 轻松有趣: ['轻松', '放松', '解压', '开心', '笑一笑'], 温暖: ['温暖', '治愈', '温馨'], 浪漫: ['浪漫', '心动'], 感伤: ['感伤', '悲伤', '难过', '虐心', '苦情', '催泪'], 紧张: ['紧张', '刺激'], 荒诞: ['荒诞', '黑色幽默'] },
  theme: { 自我探索: ['自我探索', '寻找自己', '找到自己', '人生意义', '出发', '旅行'], 亲密关系: ['亲密关系', '婚姻', '成年人关系'], 成长: ['成长', '青春'], 友情: ['友情', '朋友之间'], 家庭: ['家庭', '亲子', '家人'], 社会观察: ['社会', '现实题材', '现实主义'] },
  pace: { 舒缓: ['舒缓', '慢节奏', '慢一点', '慢慢看'], 快速: ['快节奏', '节奏快'] },
  structure: { 时间循环: ['时间循环', '重复一天'], 多线叙事: ['多线叙事'], 框架叙事: ['框架叙事'], 多层梦境: ['梦境', '梦中梦'] },
  country: { 日本: ['日本', '日语'], 法国: ['法国', '法语'], 美国: ['美国', '好莱坞'], 英国: ['英国'], 中国: ['中国', '华语', '国产', '中文'], 香港: ['香港', '港片'], 台湾: ['台湾'] },
};
const negativePattern = /(?:不想|不要|不看|不喜欢|排除|避开|别|不能|不太|不)[^，,。；;！!？?但不过]{0,5}$/;

export function extractPreferences(messages, movies) {
  const positive = Object.fromEntries(Object.keys(aliases).map(key => [key, []]));
  const negative = Object.fromEntries(Object.keys(aliases).map(key => [key, []]));
  positive.director = []; negative.director = [];
  const result = { positive, negative, maxMinutes: null, minMinutes: null, yearMin: null, yearMax: null, excludedIds: [], referenceId: null };
  let previousRecommendations = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      previousRecommendations = movies.filter(movie => message.content.includes(movie.title)).sort((a, b) => message.content.indexOf(a.title) - message.content.indexOf(b.title)).map(movie => movie.id);
      continue;
    }
    const text = message.content;
    if (/重新开始|清空条件|重新找|重来/.test(text)) {
      Object.keys(positive).forEach(key => { positive[key] = []; negative[key] = []; });
      result.maxMinutes = result.minMinutes = result.yearMin = result.yearMax = null;
      result.excludedIds = []; result.referenceId = null;
    }
    for (const [group, mapping] of Object.entries(aliases)) {
      const included = [], excluded = [];
      for (const [canonical, variants] of Object.entries(mapping)) {
        for (const variant of variants) {
          const occurrences = [...text.matchAll(new RegExp(variant, 'g'))];
          for (const match of occurrences) {
            const prefix = text.slice(Math.max(0, match.index - 12), match.index);
            (negativePattern.test(prefix) ? excluded : included).push(canonical);
          }
        }
      }
      if (included.length) {
        positive[group] = [...new Set(/也可以|或者|也行|都行/.test(text) ? [...positive[group], ...included] : included)];
        negative[group] = negative[group].filter(value => !included.includes(value));
      }
      if (excluded.length) {
        negative[group] = [...new Set([...negative[group], ...excluded])];
        positive[group] = positive[group].filter(value => !excluded.includes(value));
      }
    }
    const namedDirectors = [...new Set(movies.flatMap(movie => movie.director.split(' / ')))].filter(name => name && (text.includes(name) || name === '克里斯托弗·诺兰' && /诺兰|Christopher Nolan/i.test(text)));
    if (namedDirectors.length) {
      const included = namedDirectors.filter(name => !negativePattern.test(text.slice(Math.max(0, text.indexOf(name) - 12), text.indexOf(name))));
      if (included.length) positive.director = included;
      negative.director = [...new Set([...negative.director, ...namedDirectors.filter(name => !included.includes(name))])];
      negative.director = negative.director.filter(name => !included.includes(name));
    }
    const duration = text.match(/(\d{2,3})\s*分钟\s*(以内|以下|左右|以上)?/);
    if (duration) {
      const value = Number(duration[1]);
      if (duration[2] === '以上') { result.minMinutes = value; result.maxMinutes = null; }
      else if (duration[2] === '左右') { result.minMinutes = Math.max(0, value - 15); result.maxMinutes = value + 15; }
      else { result.maxMinutes = value; result.minMinutes = null; }
    }
    if (/两小时|两个小时|2\s*小时/.test(text)) result.maxMinutes = 120;
    if (/一个半小时|一小时半|1\.5\s*小时/.test(text)) result.maxMinutes = 90;
    if (/一小时以内|一个小时以内/.test(text)) result.maxMinutes = 60;
    if (/不限时长|片长不限|时长不限/.test(text)) result.minMinutes = result.maxMinutes = null;
    const year = text.match(/((?:19|20)\d{2})\s*年?\s*(以后|之后|以来|以前|之前)/);
    if (year) {
      if (/以后|之后|以来/.test(year[2])) result.yearMin = Number(year[1]);
      else result.yearMax = Number(year[1]);
    }
    if (/看过|不要这部|换一部|换几部|换一些|别推荐/.test(text)) {
      const named = movies.filter(movie => text.includes(movie.title)).map(movie => movie.id);
      const ordinal = text.match(/第([一二三四五1-5])部/);
      const ordinalIndex = ordinal ? '一二三四五'.includes(ordinal[1]) ? '一二三四五'.indexOf(ordinal[1]) : Number(ordinal[1]) - 1 : -1;
      const excluded = named.length ? named : ordinalIndex >= 0 ? [previousRecommendations[ordinalIndex]].filter(Boolean) : previousRecommendations;
      result.excludedIds = [...new Set([...result.excludedIds, ...excluded])];
    }
    if (/类似|像|相似/.test(text)) {
      const reference = movies.find(movie => text.includes(movie.title));
      if (reference) { result.referenceId = reference.id; result.excludedIds = [...new Set([...result.excludedIds, reference.id])]; }
    }
  }
  return result;
}

export function eligible(movie, preferences) {
  if (preferences.excludedIds.includes(movie.id)) return false;
  if ((preferences.maxMinutes !== null || preferences.minMinutes !== null) && !Number.isFinite(movie.minutes)) return false;
  if ((preferences.yearMin !== null || preferences.yearMax !== null) && !Number.isFinite(movie.year)) return false;
  if (preferences.maxMinutes !== null && movie.minutes > preferences.maxMinutes) return false;
  if (preferences.minMinutes !== null && movie.minutes < preferences.minMinutes) return false;
  if (preferences.yearMin !== null && movie.year < preferences.yearMin) return false;
  if (preferences.yearMax !== null && movie.year > preferences.yearMax) return false;
  if (preferences.positive.director.length && !preferences.positive.director.some(name => movie.director.includes(name))) return false;
  if (preferences.negative.director.some(name => movie.director.includes(name))) return false;
  return Object.keys(aliases).every(group => {
    const values = group === 'country' ? [movie.country] : movie[group];
    // An unannotated field cannot prove that an unwanted feeling is absent.
    if (preferences.negative[group].length && (!values.length || values.every(value => !value))) return false;
    const has = value => values.some(tag => group === 'country' ? tag.includes(value) : tag === value);
    return (!preferences.positive[group].length || preferences.positive[group].some(has)) && !preferences.negative[group].some(has);
  });
}

export async function retrieve(knowledge, messages) {
  const preferenceMovies = knowledge.preferenceMovies ? await knowledge.preferenceMovies(messages) : knowledge.movies;
  const preferences = extractPreferences(messages, preferenceMovies);
  const latest = messages.filter(message => message.role === 'user').at(-1).content;
  const query = [latest, ...Object.values(preferences.positive).flat()].join(' ');
  const hits = await knowledge.search(query);
  const order = new Map(hits.map((hit, index) => [hit.id, hits.length - index]));
  const reference = preferenceMovies.find(movie => movie.id === preferences.referenceId);
  const available = knowledge.selectForPreferences ? [...new Map([...(await knowledge.selectForPreferences(preferences)), ...(await Promise.all(hits.map(hit => knowledge.getMovie(hit.id)))).filter(Boolean)].map(movie => [movie.id, movie])).values()] : knowledge.movies;
  const candidates = available.filter(movie => eligible(movie, preferences)).map(movie => {
    const similarity = reference ? ['genre', 'mood', 'theme'].reduce((total, group) => total + movie[group].filter(tag => reference[group].includes(tag)).length * 3, 0) : 0;
    return { movie, rank: (order.get(movie.id) || 0) + similarity + (latest.includes(movie.title) ? 100 : 0) };
  }).sort((a, b) => b.rank - a.rank).slice(0, 12).map(item => item.movie);
  return { preferences, candidates };
}
