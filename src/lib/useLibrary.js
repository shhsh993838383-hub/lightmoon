import { useEffect, useRef, useState } from 'react';

export default function useLibrary(auth, onNotice) {
  const [library, setLibrary] = useState({ userId: null, saved: [], watched: [] });
  const identity = useRef(auth.user?.id);
  identity.current = auth.user?.id;
  const current = useRef(library);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const controller = new AbortController();
    const userId = auth.user?.id;
    const empty = { userId: null, saved: [], watched: [] };
    current.current = empty; setLibrary(empty); setError('');
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    auth.request('/api/account/library', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted || identity.current !== userId) return;
      current.current = { ...data, userId }; setLibrary(current.current);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [auth.user?.id, auth.request, attempt]);

  function toggle(id, field) {
    if (!auth.requireLogin()) return;
    if (loading || current.current.userId !== auth.user.id) { onNotice('片单尚未读取完成，请稍后重试。'); return; }
    const userId = auth.user.id;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (identity.current !== userId) return;
      const included = current.current[field].includes(id);
      const result = await auth.request('/api/account/library/' + id, { method: 'PUT', body: JSON.stringify({ [field]: !included }) });
      if (identity.current !== userId) return;
      current.current = { ...result, userId }; setLibrary(current.current);
      onNotice(field === 'saved' ? included ? '已从想看中移除' : '已加入我的想看' : included ? '已取消看过标记' : '已加入我已看过');
    }).catch(failure => { if (identity.current === userId) onNotice(failure.message); });
  }
  return { saved: library.userId === auth.user?.id ? library.saved : [], watched: library.userId === auth.user?.id ? library.watched : [], loading, error, retry: () => setAttempt(value => value + 1), save: id => toggle(id, 'saved'), watch: id => toggle(id, 'watched') };
}
