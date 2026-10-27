import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findInCatalog } from '../../src/lib/local-finder.js';

const movies = JSON.parse(readFileSync('src/data/movies.json', 'utf8'));
const user = content => ({ role: 'user', content });

test('browser retrieval works without an API and enforces exclusions, directors and duration', async () => {
  const result = await findInCatalog([user('想看轻松动画片，不要悲伤，90分钟以内')], movies);
  assert.equal(result.mode, 'local');
  assert.match(result.message, /本地检索/);
  assert.deepEqual(result.recommendations.map(movie => movie.id), ['totoro']);
  const director = await findInCatalog([user('想看看王家卫导演的电影')], movies);
  assert.deepEqual(new Set(director.recommendations.map(movie => movie.id)), new Set(['in-the-mood', 'chungking-express']));
  const none = await findInCatalog([user('想看日本恐怖片')], movies);
  assert.deepEqual(none.recommendations, []);
  assert.match(none.message, /暂时没有/);
});

test('browser retrieval preserves conversation conditions and replaces films already seen', async () => {
  const messages = [user('想看爱情片')];
  const first = await findInCatalog(messages, movies);
  const titles = first.recommendations.map(item => movies.find(movie => movie.id === item.id).title);
  const second = await findInCatalog([...messages, { role: 'assistant', content: '推荐影片：' + titles.join('、') }, user('这几部都看过了，换几部，两个小时以内')], movies);
  assert.ok(second.recommendations.length > 0);
  for (const item of second.recommendations) {
    assert.ok(!first.recommendations.some(previous => previous.id === item.id));
    const movie = movies.find(movie => movie.id === item.id);
    assert.ok(movie.genre.includes('爱情'));
    assert.ok(movie.minutes <= 120);
  }
});
