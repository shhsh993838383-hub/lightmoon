import { retrieve, movieReason } from '../../server/retrieval.mjs';
import { movieDocument, tokenize } from '../../server/knowledge-document.mjs';

const documents = new WeakMap();

// The same inclusion/exclusion and conversation rules as the online retriever.
// This path runs entirely in the browser and never calls a language model.
export async function findInCatalog(messages, movies) {
  if (!documents.has(movies)) documents.set(movies, movies.map(movie => ({ id: movie.id, text: movieDocument(movie).toLocaleLowerCase() })));
  const knowledge = {
    movies,
    search(query) {
      const tokens = [...new Set(tokenize(query))].slice(0, 40);
      return documents.get(movies).map(({ id, text }) => ({ id, score: tokens.filter(token => text.includes(token)).length })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);
    },
  };
  const { candidates, preferences } = await retrieve(knowledge, messages);
  return {
    mode: 'local',
    message: candidates.length ? '以下结果来自已同步片库的本地检索。可以继续补充类型、导演、片长或想避开的感觉。' : `已同步的 ${movies.length} 部电影中，暂时没有同时满足这些条件的影片，可以放宽一项再试。`,
    recommendations: candidates.slice(0, 3).map(movie => {
      const reason = movieReason(movie, preferences);
      return { id: movie.id, reason: reason.length > 180 ? reason.slice(0, 180) + '…' : reason };
    }),
    movies: candidates,
    followUps: candidates.length ? ['一个半小时以内', '这几部都看过了，换几部'] : ['时长不限，其他条件保留', '重新开始，推荐喜剧'],
  };
}
