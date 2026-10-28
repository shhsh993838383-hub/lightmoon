export const sessionKey = 'lightmoon-session';

// Keep only the opaque credential and server expiry, never a password or profile.
export function createSessionStorage({ persistent = () => localStorage, transient = () => sessionStorage, now = () => Date.now() } = {}) {
  const get = storage => { try { return storage().getItem(sessionKey); } catch { return null; } };
  const remove = storage => { try { storage().removeItem(sessionKey); } catch { /* Storage may be disabled. */ } };
  const put = (storage, value) => { try { storage().setItem(sessionKey, value); return true; } catch { return false; } };
  function decode(value) {
    if (!value) return null;
    let record;
    try { record = /^[a-f0-9]{64}$/.test(value) ? { token: value, expiresAt: null } : JSON.parse(value); }
    catch { return null; }
    if (!record || typeof record.token !== 'string' || !/^[a-f0-9]{64}$/.test(record.token) || (record.expiresAt !== null && (!Number.isInteger(record.expiresAt) || record.expiresAt * 1000 <= now()))) return null;
    return { token: record.token, expiresAt: record.expiresAt };
  }
  function save(input) {
    const record = decode(JSON.stringify({ token: input.token, expiresAt: input.expiresAt ?? null }));
    if (!record) throw new Error('登录凭证格式不正确，请重试。');
    const value = JSON.stringify(record);
    if (put(persistent, value)) remove(transient);
    else { remove(persistent); put(transient, value); }
    return record;
  }
  function load({ migrateLegacy = true } = {}) {
    const saved = get(persistent);
    const record = decode(saved);
    if (record) return record;
    if (saved) { remove(persistent); remove(transient); return null; }
    if (!migrateLegacy) return null;
    const legacy = get(transient);
    const previous = decode(legacy);
    if (previous) return save(previous);
    if (legacy) remove(transient);
    return null;
  }
  return { load, save, clear() { remove(persistent); remove(transient); } };
}
