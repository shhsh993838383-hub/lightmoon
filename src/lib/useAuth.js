import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, hasApi } from './urls.js';

const sessionKey = 'lightmoon-session';
const guestKey = 'lightmoon-guest';
function read(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function save(key, value) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* In-memory sessions still work. */ } }

export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}
async function send(path, options = {}, token) {
  if (!hasApi) throw new ApiError('账号服务暂时不可用，请稍后再试。', 'unavailable', 503);
  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers } });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError('连接暂时中断，请检查网络后重试。', 'network_error', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || '暂时无法完成操作，请稍后重试。', data.code, response.status);
  return data;
}

export default function useAuth() {
  const session = useRef(read(sessionKey));
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(session.current));
  const [open, setOpen] = useState(!session.current && !read(guestKey));
  const [mode, setMode] = useState('login');
  const [reason, setReason] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const currentUser = useRef(null);

  const forget = useCallback(() => {
    session.current = null; currentUser.current = null; save(sessionKey, null); setUser(null);
  }, []);
  useEffect(() => {
    if (!session.current) { setChecking(false); return; }
    const controller = new AbortController();
    const restoring = session.current;
    setChecking(true);
    send('/api/auth/me', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }, session.current).then(data => {
      if (!controller.signal.aborted && session.current === restoring) { currentUser.current = data.user; setUser(data.user); setOpen(false); }
    }).catch(error => {
      if (controller.signal.aborted || session.current !== restoring) return;
      if (error.status === 401) forget();
      setReason(error.status === 401 ? '登录已过期，请重新登录。' : '暂时无法恢复登录。你可以重试，或先以游客身份浏览。');
      setOpen(true);
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [restoreAttempt, forget]);

  const promptLogin = useCallback((message = '登录后，就能评分、评论和保存你的片单。') => { setReason(message); setMode('login'); setOpen(true); }, []);
  const request = useCallback(async (path, options = {}) => {
    const requestToken = session.current;
    try { return await send(path, options, requestToken); }
    catch (error) {
      if (error.status === 401 && session.current === requestToken) { forget(); promptLogin('登录已过期，请重新登录后继续。'); }
      throw error;
    }
  }, [forget, promptLogin]);
  const submit = useCallback(async (kind, input) => {
    const data = await send('/api/auth/' + kind, { method: 'POST', body: JSON.stringify(input) });
    session.current = data.token; currentUser.current = data.user; save(sessionKey, data.token); save(guestKey, null);
    setUser(data.user); setReason(''); setOpen(false);
  }, []);
  const guest = useCallback(() => { if (!currentUser.current) { forget(); save(guestKey, '1'); } setOpen(false); setReason(''); }, [forget]);
  const logout = useCallback(async () => {
    await request('/api/auth/logout', { method: 'POST' });
    forget(); save(guestKey, '1'); setOpen(false); setReason('');
  }, [request, forget]);
  const requireLogin = useCallback(() => { if (currentUser.current) return true; promptLogin(); return false; }, [promptLogin]);
  return { user, checking, open, mode, reason, setMode, submit, request, guest, logout, requireLogin, promptLogin, showAccount: () => { setReason(''); setOpen(true); }, retry: () => setRestoreAttempt(value => value + 1) };
}
