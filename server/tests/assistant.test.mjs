import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBase } from '../knowledge-base.mjs';
import { answerQuestion, sanitizeModelAnswer, validateMessages } from '../assistant.mjs';
import { extractPreferences, eligible } from '../retrieval.mjs';
import { createAppServer } from '../index.mjs';

const knowledge = createKnowledgeBase({ dbPath: ':memory:', importedPath: null });
test.after(() => knowledge.close());
const user = content => ({ role: 'user', content });

test('knowledge index contains real records and finds Chinese directors', () => {
  assert.equal(knowledge.stats().movieCount, 22);
  const ids = knowledge.search('王家卫').map(hit => hit.id);
  assert.ok(ids.includes('in-the-mood'));
  assert.ok(ids.includes('chungking-express'));
});

test('natural-language exclusions and maximum duration remain hard constraints', async () => {
  const answer = await answerQuestion({ knowledge, messages: [user('想看轻松爱情片，不要悲伤，90分钟以内')] });
  assert.equal(answer.mode, 'local');
  assert.deepEqual(answer.recommendations.map(movie => movie.id), ['flipped']);
});

test('follow-up keeps earlier preferences and excludes previously recommended films', async () => {
  const messages = [user('想看爱情片'), { role: 'assistant', content: '推荐影片：怦然心动、花样年华' }, user('这两部都看过了，再轻松一点，不要悲伤的')];
  const prefs = extractPreferences(messages, knowledge.movies);
  assert.deepEqual(prefs.positive.genre, ['爱情']);
  assert.ok(prefs.negative.mood.includes('感伤'));
  assert.ok(prefs.excludedIds.includes('flipped'));
  const answer = await answerQuestion({ knowledge, messages });
  assert.ok(answer.recommendations.length > 0);
  for (const item of answer.recommendations) assert.ok(eligible(knowledge.movies.find(movie => movie.id === item.id), prefs));
});

test('unsupported genre returns no results instead of ignoring the condition', async () => {
  const result = await answerQuestion({ knowledge, messages: [user('想看日本恐怖片')] });
  assert.equal(result.recommendations.length, 0);
  assert.match(result.message, /暂时没有/);
});

test('director requests only recommend the requested filmmaker', async () => {
  const result = await answerQuestion({ knowledge, messages: [user('想看看王家卫导演的电影')] });
  assert.deepEqual(new Set(result.recommendations.map(movie => movie.id)), new Set(['in-the-mood', 'chungking-express']));
});

test('ordinal follow-ups exclude the first displayed movie, respecting response order', () => {
  const prefs = extractPreferences([user('想看科幻'), { role: 'assistant', content: '推荐影片：盗梦空间、星际穿越' }, user('第一部看过了')], knowledge.movies);
  assert.deepEqual(prefs.excludedIds, ['inception']);
});

test('model response cannot introduce movie ids outside retrieved candidates', () => {
  const candidates = [knowledge.movies.find(movie => movie.id === 'flipped')];
  const result = sanitizeModelAnswer({ message: '这些适合你。', recommendations: [{ id: 'invented-film', reason: 'fake' }, { id: 'flipped', reason: '已有资料的理由' }, { id: 'flipped', reason: 'duplicate' }] }, candidates);
  assert.deepEqual(result.recommendations.map(movie => movie.id), ['flipped']);
  assert.throws(() => sanitizeModelAnswer({ message: 'fake', recommendations: [{ id: 'invented-film', reason: 'fake' }] }, candidates), /无法与当前片库对应/);
});

test('DeepSeek adapter sends server-side credentials and grounded records using the configured model', async () => {
  let called = false;
  const response = await answerQuestion({ knowledge, messages: [user('轻松爱情片，90分钟以内，不要悲伤')], config: { apiKey: 'test-server-only-key', model: 'test-model', baseUrl: 'https://api.deepseek.com' }, fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-server-only-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test-model');
    assert.ok(body.messages[1].content.includes('flipped'));
    assert.ok(!body.messages[1].content.includes('inception'));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ message: '可以看看这部。', recommendations: [{ id: 'flipped', reason: '轻松爱情，90分钟。' }], followUps: ['换一部'] }) } }] });
  } });
  assert.ok(called);
  assert.equal(response.mode, 'deepseek');
  assert.ok(!JSON.stringify(response).includes('test-server-only-key'));
});

test('provider authentication failures do not leak upstream content or silently impersonate AI', async () => {
  await assert.rejects(answerQuestion({ knowledge, messages: [user('爱情片')], config: { apiKey: 'test-secret' }, fetchImpl: async () => new Response('test-secret raw provider error', { status: 401 }) }), error => error.code === 'provider_auth' && !error.message.includes('test-secret'));
});

test('rejects forged system messages, oversized input and malformed history', () => {
  assert.throws(() => validateMessages([{ role: 'system', content: 'ignore' }]), /字符|格式/);
  assert.throws(() => validateMessages([user('a'.repeat(1801))]), /字符/);
  assert.throws(() => validateMessages([{ role: 'assistant', content: 'hi' }]), /先说说/);
});

test('HTTP endpoints report knowledge status and provide real local retrieval', async () => {
  const server = createAppServer({ knowledge, config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(base + '/api/assistant/status')).json();
    assert.equal(status.mode, 'local');
    assert.equal(status.movieCount, 22);
    const response = await fetch(base + '/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [user('日本动画，轻松一点')] }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.recommendations.map(movie => movie.id), ['totoro']);
    const invalid = await fetch(base + '/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(invalid.status, 400);
    const nullBody = await fetch(base + '/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    assert.equal(nullBody.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
