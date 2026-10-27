// Opaque sessions work across the separate Pages and Workers origins. Only
// SHA-256 session digests are stored; password hashing uses Workers Web Crypto.
const iterations = 100000;
const sessionLifetime = 7 * 24 * 60 * 60;
const encode = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/.{2}/g), pair => parseInt(pair, 16));
const randomHex = size => hex(crypto.getRandomValues(new Uint8Array(size)));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', encode.encode(value)));

export class AccountError extends Error {
  constructor(message, code = 'invalid_request', status = 400) { super(message); this.code = code; this.status = status; }
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new AccountError('请填写有效的邮箱地址。');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || email.split('@')[0].length > 64 || email.startsWith('.') || email.includes('..') || email.includes('.@')) throw new AccountError('请填写有效的邮箱地址。');
  return email;
}
function validatePassword(value, registering = false) {
  if (typeof value !== 'string' || value.length > 128 || value.length < (registering ? 6 : 1)) throw new AccountError(registering ? '密码请设置为 6 至 128 个字符。' : '请填写邮箱和密码。');
}
async function passwordHash(password, salt, count = iterations) {
  const key = await crypto.subtle.importKey('raw', encode.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: count }, key, 256));
}
function equal(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
const publicUser = row => ({ id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at });
export const lightmoonRating = row => ({ average: row?.lightmoon_votes > 0 ? row.lightmoon_sum / row.lightmoon_votes : null, votes: row?.lightmoon_votes || 0 });
export const movieWithCommunity = row => row ? { ...JSON.parse(row.data), lightmoonRating: lightmoonRating(row) } : null;
export const communityMovieColumns = 'm.data, rt.score_sum AS lightmoon_sum, rt.votes AS lightmoon_votes';
export const communityMovieJoin = ' LEFT JOIN movie_rating_totals rt ON rt.movie_id=m.id';

export function createAccountStore(db, { now = () => Date.now() } = {}) {
  const prepare = (sql, params = []) => params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const first = (sql, params) => prepare(sql, params).first();
  const all = async (sql, params) => (await prepare(sql, params).all()).results;
  const run = (sql, params) => prepare(sql, params).run();
  const timestamp = () => new Date(now()).toISOString();
  const seconds = () => Math.floor(now() / 1000);
  async function sessionFor(user) {
    const token = randomHex(32);
    const expiresAt = seconds() + sessionLifetime;
    return { token, expiresAt, statement: prepare('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)', [await digest(token), user.id, expiresAt, timestamp()]) };
  }
  async function register(input) {
    const email = normalizeEmail(input?.email);
    validatePassword(input?.password, true);
    const name = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (name && (name.length > 24 || /[\p{C}<>]/u.test(name))) throw new AccountError('昵称请使用 1 至 24 个可见字符。');
    const salt = randomHex(16), hash = await passwordHash(input.password, salt);
    const user = { id: crypto.randomUUID(), email, display_name: name || '光幕影迷' + randomHex(3), created_at: timestamp() };
    const session = await sessionFor(user);
    try {
      await db.batch([
        prepare('INSERT INTO users(id,email,display_name,password_hash,password_salt,password_iterations,created_at) VALUES (?,?,?,?,?,?,?)', [user.id, email, user.display_name, hash, salt, iterations, user.created_at]),
        session.statement,
      ]);
    } catch (error) {
      if (String(error.message).includes('users.email') || await first('SELECT id FROM users WHERE email=?', [email])) throw new AccountError('这个邮箱已注册，请直接登录。', 'email_registered', 409);
      throw error;
    }
    return { user: publicUser(user), token: session.token, expiresAt: session.expiresAt };
  }
  async function login(input) {
    const email = normalizeEmail(input?.email);
    validatePassword(input?.password);
    const user = await first('SELECT * FROM users WHERE email=?', [email]);
    const actual = await passwordHash(input.password, user?.password_salt || '0'.repeat(32), user?.password_iterations || iterations);
    if (!user || !equal(actual, user.password_hash)) throw new AccountError('邮箱或密码不正确，请重新输入。', 'invalid_credentials', 401);
    const session = await sessionFor(user);
    await db.batch([prepare('DELETE FROM user_sessions WHERE expires_at<=?', [seconds()]), session.statement]);
    return { user: publicUser(user), token: session.token, expiresAt: session.expiresAt };
  }
  async function authenticate(authorization) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization || '')?.[1];
    if (!token) return null;
    const user = await first('SELECT u.* FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?', [await digest(token), seconds()]);
    return user ? publicUser(user) : null;
  }
  async function requireUser(authorization) {
    const user = await authenticate(authorization);
    if (!user) throw new AccountError('请先注册或登录，再使用这个功能。', 'login_required', 401);
    return user;
  }
  async function logout(authorization) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization || '')?.[1];
    if (token) await run('DELETE FROM user_sessions WHERE token_hash=?', [await digest(token)]);
  }
  async function consumeLimit(key, limit, windowSeconds) {
    const time = seconds();
    const row = await first(`INSERT INTO request_limits(key,requests,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET requests=CASE WHEN request_limits.expires_at<=? THEN 1 ELSE request_limits.requests+1 END,expires_at=CASE WHEN request_limits.expires_at<=? THEN excluded.expires_at ELSE request_limits.expires_at END RETURNING requests`, [key, time + windowSeconds, time, time]);
    if (row.requests > limit) throw new AccountError('操作比较频繁，请稍后再试。', 'rate_limit', 429);
  }
  async function rating(movieId) {
    return lightmoonRating(await first('SELECT score_sum AS lightmoon_sum,votes AS lightmoon_votes FROM movie_rating_totals WHERE movie_id=?', [movieId]));
  }
  async function rate(movieId, userId, score) {
    if (score !== null && (!Number.isInteger(score) || score < 1 || score > 10)) throw new AccountError('请选择 1 至 10 分之间的整数。', 'invalid_score');
    if (score === null) await run('DELETE FROM movie_ratings WHERE movie_id=? AND user_id=?', [movieId, userId]);
    else await run('INSERT INTO movie_ratings(movie_id,user_id,score,updated_at) VALUES (?,?,?,?) ON CONFLICT(movie_id,user_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at', [movieId, userId, score, timestamp()]);
    return { rating: await rating(movieId), myRating: score };
  }
  async function community(movieId, userId, offset = 0) {
    const start = Math.max(0, Math.min(100000, Math.floor(Number(offset) || 0)));
    const rows = await all('SELECT c.id,c.user_id,c.content,c.created_at,u.display_name FROM movie_comments c JOIN users u ON u.id=c.user_id WHERE c.movie_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ?', [movieId, start]);
    return { rating: await rating(movieId), myRating: userId ? (await first('SELECT score FROM movie_ratings WHERE movie_id=? AND user_id=?', [movieId, userId]))?.score ?? null : null,
      comments: rows.map(row => ({ id: row.id, content: row.content, createdAt: row.created_at, author: row.display_name, mine: row.user_id === userId })), total: (await first('SELECT COUNT(*) AS total FROM movie_comments WHERE movie_id=?', [movieId])).total, offset: start, limit: 20 };
  }
  async function comment(movieId, userId, content) {
    if (typeof content !== 'string' || !content.trim() || content.trim().length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) throw new AccountError('评论请填写 1 至 1000 个字符。', 'invalid_comment');
    const id = crypto.randomUUID();
    await run('INSERT INTO movie_comments(id,movie_id,user_id,content,created_at) VALUES (?,?,?,?,?)', [id, movieId, userId, content.trim(), timestamp()]);
    return { id };
  }
  async function deleteComment(id, userId) {
    const row = await first('SELECT user_id FROM movie_comments WHERE id=?', [id]);
    if (!row) throw new AccountError('这条评论已不存在。', 'comment_not_found', 404);
    if (row.user_id !== userId) throw new AccountError('只能删除自己的评论。', 'forbidden', 403);
    await run('DELETE FROM movie_comments WHERE id=? AND user_id=?', [id, userId]);
  }
  async function library(userId) {
    const rows = await all('SELECT movie_id,saved,watched FROM user_library WHERE user_id=? ORDER BY updated_at DESC', [userId]);
    return { saved: rows.filter(row => row.saved).map(row => row.movie_id), watched: rows.filter(row => row.watched).map(row => row.movie_id) };
  }
  async function updateLibrary(userId, movieId, input) {
    if (!input || !['saved', 'watched'].some(key => typeof input[key] === 'boolean') || ['saved', 'watched'].some(key => key in input && typeof input[key] !== 'boolean')) throw new AccountError('片单状态不正确。');
    await db.batch([
      prepare('INSERT INTO user_library(user_id,movie_id,saved,watched,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,movie_id) DO UPDATE SET saved=CASE WHEN ? THEN excluded.saved ELSE user_library.saved END,watched=CASE WHEN ? THEN excluded.watched ELSE user_library.watched END,updated_at=excluded.updated_at', [userId, movieId, Number(input.saved || false), Number(input.watched || false), timestamp(), Number(typeof input.saved === 'boolean'), Number(typeof input.watched === 'boolean')]),
      prepare('DELETE FROM user_library WHERE user_id=? AND movie_id=? AND saved=0 AND watched=0', [userId, movieId]),
    ]);
    return library(userId);
  }
  return { register, login, authenticate, requireUser, logout, consumeLimit, rating, rate, community, comment, deleteComment, library, updateLibrary };
}

export function createAccountHandler({ store, knowledge }) {
  return async ({ method, url, authorization, client = 'unknown', readBody }) => {
    const path = url.pathname;
    if (!path.startsWith('/api/auth/') && !path.startsWith('/api/account/') && !path.startsWith('/api/movies/') && !path.startsWith('/api/comments/')) return null;
    if (!store) throw new AccountError('账号服务暂时不可用，请稍后重试。', 'accounts_unavailable', 503);
    const body = async () => { const value = await readBody(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError('提交的信息格式不正确。'); return value; };
    const response = (data, status = 200) => ({ status, data });
    if (method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
      const registering = path.endsWith('/register');
      await store.consumeLimit(`account:${registering ? 'register' : 'login'}:${await digest(client)}`, registering ? 5 : 20, registering ? 3600 : 900);
      return response(await store[registering ? 'register' : 'login'](await body()), registering ? 201 : 200);
    }
    if (method === 'GET' && path === '/api/auth/me') return response({ user: await store.requireUser(authorization) });
    if (method === 'POST' && path === '/api/auth/logout') { await store.logout(authorization); return response({ ok: true }); }
    const communityMatch = /^\/api\/movies\/([\w-]{1,120})\/(community|rating|comments)$/.exec(path);
    if (method === 'GET' && communityMatch?.[2] === 'community') {
      if (!await knowledge.getMovie(communityMatch[1])) throw new AccountError('暂时找不到这部电影。', 'movie_not_found', 404);
      const user = await store.authenticate(authorization);
      return response(await store.community(communityMatch[1], user?.id, url.searchParams.get('offset')));
    }
    const user = await store.requireUser(authorization);
    if (method === 'GET' && path === '/api/account/library') return response(await store.library(user.id));
    await store.consumeLimit(`account:write:${user.id}`, 60, 60);
    const libraryMatch = /^\/api\/account\/library\/([\w-]{1,120})$/.exec(path);
    const movieId = libraryMatch?.[1] || communityMatch?.[1];
    if (movieId && !await knowledge.getMovie(movieId)) throw new AccountError('暂时找不到这部电影。', 'movie_not_found', 404);
    if (method === 'PUT' && libraryMatch) return response(await store.updateLibrary(user.id, movieId, await body()));
    if (communityMatch?.[2] === 'rating' && ['PUT', 'DELETE'].includes(method)) {
      if (method === 'DELETE') return response(await store.rate(movieId, user.id, null));
      const score = (await body()).score;
      if (!Number.isInteger(score) || score < 1 || score > 10) throw new AccountError('请选择 1 至 10 分之间的整数。', 'invalid_score');
      return response(await store.rate(movieId, user.id, score));
    }
    if (method === 'POST' && communityMatch?.[2] === 'comments') {
      await store.consumeLimit(`account:comments:${user.id}`, 10, 60);
      return response(await store.comment(movieId, user.id, (await body()).content), 201);
    }
    const commentMatch = /^\/api\/comments\/([a-f0-9-]{36})$/.exec(path);
    if (method === 'DELETE' && commentMatch) { await store.deleteComment(commentMatch[1], user.id); return response({ ok: true }); }
    throw new AccountError('接口不存在或请求方式不正确。', 'not_found', 404);
  };
}
