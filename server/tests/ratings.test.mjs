import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoubanRating, parseRottenTomatoes, lookupRatingLinks, fetchDoubanRating, fetchRottenTomatoesRating } from '../movie-ratings.mjs';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { normalizeTmdbMovie } from '../tmdb.mjs';

const movie = { title: '测试电影', originalTitle: 'A Movie', aliases: ['电影别名'], year: 2020, doubanId: '12345' };
const douban = { id: '12345', title: '电影别名', year: '2020', is_tv: false, rating: { value: 8.4, count: 1234, max: 10 } };
test('Douban ratings require the right id, title and year, and retain real vote counts', () => {
  assert.deepEqual(normalizeDoubanRating(douban, movie, { updatedAt: '2026-10-27' }), { average: 8.4, votes: 1234, updatedAt: '2026-10-27' });
  for (const replacement of [{ id: '999' }, { year: '1999' }, { title: '另一个故事' }, { is_tv: true }, { isMockData: true }]) assert.throws(() => normalizeDoubanRating({ ...douban, ...replacement }, movie), error => error.code === 'rating_identity');
  for (const value of [null, '', 0, -1, 11, false, 'unavailable']) assert.equal(normalizeDoubanRating({ ...douban, rating: { value } }, movie), null);
});

const rt = (critics = '92', audience = '87') => '<link rel="canonical" href="https://www.rottentomatoes.com/m/a_movie"><script type="application/json" id="media-scorecard-json">' + JSON.stringify({ criticsScore: { score: critics, reviewCount: 314, certified: true }, audienceScore: { score: audience, scoreType: 'VERIFIED', bandedRatingCount: '1,000+' } }) + '</script>';
test('Rotten Tomatoes keeps freshness and audience percentages separate, including a real zero', () => {
  const rating = parseRottenTomatoes(rt(), 'm/a_movie');
  assert.equal(rating.critics.score, 92); assert.equal(rating.critics.reviews, 314);
  assert.equal(rating.audience.score, 87); assert.equal(rating.audience.verified, true);
  assert.equal(parseRottenTomatoes(rt('0', '0'), 'm/a_movie').critics.score, 0);
  assert.equal(parseRottenTomatoes(rt('', null), 'm/a_movie'), null);
  assert.equal(parseRottenTomatoes(rt('105', 'unknown'), 'm/a_movie'), null);
  assert.throws(() => parseRottenTomatoes(rt(), 'm/remake'), error => error.code === 'rating_identity');
  assert.equal(parseRottenTomatoes('<html>no score published</html>', 'm/a_movie'), null);
});

test('rating links use exact IMDb identifiers and reject ambiguous provider mappings', async () => {
  const binding = (imdb, doubanId, path) => ({ imdb: { value: imdb }, douban: { value: doubanId }, rt: { value: path } });
  const links = await lookupRatingLinks(['tt12345', 'tt67890'], { fetchImpl: async url => {
    assert.equal(new URL(url).hostname, 'query.wikidata.org');
    return Response.json({ results: { bindings: [binding('tt12345', '12345', 'm/a_movie'), binding('tt67890', '1', 'm/first'), binding('tt67890', '2', 'm/second'), binding('tt99999', '8', 'm/unrequested')] } });
  } });
  assert.equal(links.get('tt12345').doubanId, '12345');
  assert.equal(links.get('tt67890').doubanId, null);
  assert.equal(links.get('tt67890').rottenTomatoesPath, null);
  assert.equal(links.has('tt99999'), false);
  await assert.rejects(fetchDoubanRating(movie, { fetchImpl: async () => new Response('secret upstream body', { status: 403 }) }), error => error.code === 'rating_http_403' && !error.message.includes('secret'));
  await assert.rejects(fetchDoubanRating(movie, { fetchImpl: async () => Response.json({ code: 1309, msg: 'subject_ip_rate_limit' }, { status: 400 }) }), error => error.code === 'rating_rate_limit');
});

test('Rotten Tomatoes canonical redirects require matching title and release year', async () => {
  const html = rt().replace('</script>', '</script><script type="application/ld+json">{"@type":"Movie","name":"A Movie"}</script><script type="application/json">{"releaseYear":"2020"}</script>');
  const fetchImpl = async () => {
    const response = new Response(html);
    Object.defineProperty(response, 'url', { value: 'https://www.rottentomatoes.com/m/a_movie' });
    return response;
  };
  const rating = await fetchRottenTomatoesRating({ ...movie, rottenTomatoesPath: 'm/older_slug' }, { fetchImpl });
  assert.equal(rating.critics.score, 92);
  await assert.rejects(fetchRottenTomatoesRating({ ...movie, year: 1999, rottenTomatoesPath: 'm/older_slug' }, { fetchImpl }), error => error.code === 'rating_identity');
});

test('refreshing TMDB metadata retains linked Douban and Rotten Tomatoes ratings', () => {
  const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
  try {
    const imported = normalizeTmdbMovie({ id: 990099, title: '测试电影', original_title: 'A Movie', release_date: '2020-01-01', adult: false, runtime: 90 });
    knowledge.upsertImported([{ ...imported, doubanId: '12345', doubanRating: { average: 8.4, votes: 1234 }, rottenTomatoesRating: { critics: { score: 92 } } }]);
    knowledge.upsertImported([imported]);
    const refreshed = knowledge.getByTmdb(990099);
    assert.equal(refreshed.doubanRating.average, 8.4);
    assert.equal(refreshed.rottenTomatoesRating.critics.score, 92);
  } finally { knowledge.close(); }
});
