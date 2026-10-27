import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ChatCircle, Star, Trash } from '@phosphor-icons/react';

export default function FilmCommunity({ movie, auth, onRating }) {
  const [data, setData] = useState(null);
  const [score, setScore] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const load = useCallback(async (offset = 0, signal) => {
    const requestId = generation.current;
    const result = await auth.request(`/api/movies/${movie.id}/community?offset=${offset}`, { signal });
    if (signal?.aborted || generation.current !== requestId) return;
    setData(previous => ({ ...result, comments: offset && previous ? [...previous.comments, ...result.comments.filter(comment => !previous.comments.some(item => item.id === comment.id))] : result.comments }));
    if (!offset) setScore(result.myRating);
    onRating(movie.id, result.rating, false);
  }, [movie.id, auth.user?.id, auth.request, onRating]);

  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setLoading(true); setData(null); setScore(null); setContent(''); setError(''); setNotice('');
    load(0, controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [load]);

  async function act(name, operation) {
    if (!auth.requireLogin()) return;
    setBusy(name); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function rate(value) {
    await act('rating', async () => {
      const result = await auth.request(`/api/movies/${movie.id}/rating`, value === null ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ score: value }) });
      setData(current => ({ ...current, rating: result.rating, myRating: result.myRating })); setScore(result.myRating);
      onRating(movie.id, result.rating, true); setNotice(value === null ? '已撤回评分。' : '评分已保存，感谢你的分享。');
    });
  }
  async function publish(event) {
    event.preventDefault();
    await act('comment', async () => {
      await auth.request(`/api/movies/${movie.id}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
      setContent(''); await load(); setNotice('评论已发布。');
    });
  }
  async function remove(id) {
    await act(id, async () => { await auth.request('/api/comments/' + id, { method: 'DELETE' }); await load(); setNotice('已删除你的评论。'); });
  }
  async function more() {
    setBusy('more'); setError('');
    try { await load(data.comments.length); } catch (failure) { setError(failure.message); } finally { setBusy(''); }
  }
  async function retry() {
    setLoading(true); setError('');
    try { await load(); } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }
  return <section className="film-community" aria-label="光幕评分与评论">
    <div className="community-heading"><h3><ChatCircle size={19} />光幕影评</h3><span>{data ? `${data.rating.votes} 人评分 · ${data.total} 条评论` : '每一次观影，都有回声'}</span></div>
    {loading ? <p className="community-loading" role="status">正在读取评分和评论…</p> : !data ? <div className="community-unavailable"><p className="form-error" role="alert">{error || '暂时无法读取影评。'}</p><button className="text-button" onClick={retry}><ArrowClockwise size={14} />重试</button></div> : <>
      <div className="community-rate"><div className="community-rate-title"><label>为这部电影打分</label><span>{auth.user && data.myRating ? `你已打 ${data.myRating} 分` : '1–10 分'}</span></div>
        <div className="score-options" role="group" aria-label="选择光幕评分">{Array.from({ length: 10 }, (_, index) => index + 1).map(value => <button key={value} aria-label={`为${movie.title}打${value}分`} aria-pressed={score === value} disabled={Boolean(busy)} onClick={() => { if (auth.requireLogin()) { setScore(value); setNotice(''); } }}>{value}</button>)}</div>
        {auth.user ? <div className="rating-actions"><button className="primary-button" disabled={Boolean(busy) || score === null || score === data.myRating} onClick={() => rate(score)}><Star size={16} />{busy === 'rating' ? '正在保存…' : data.myRating ? '更新评分' : '提交评分'}</button>{data.myRating && <button className="text-button" disabled={Boolean(busy)} onClick={() => rate(null)}>撤回评分</button>}</div> : <p className="community-signin"><button onClick={() => auth.promptLogin('登录后，给这部电影留下你的评分。')}>登录后评分</button><span>每个账号一票，可以随时修改。</span></p>}
      </div>
      <form className="comment-form" onSubmit={publish}>
        <label htmlFor={`comment-${movie.id}`}>写下你的观影感受</label>
        {auth.user ? <><textarea id={`comment-${movie.id}`} value={content} onChange={event => setContent(event.target.value)} maxLength={1000} rows={3} placeholder="哪一个片刻，让你记住了这部电影？" required disabled={Boolean(busy)} /><div className="comment-form-actions"><span>{content.length} / 1000</span><button className="primary-button" disabled={Boolean(busy) || !content.trim()}>{busy === 'comment' ? '正在发布…' : '发布评论'}</button></div></> : <div className="guest-comment"><p>登录后，与同样喜欢电影的人聊聊。</p><button type="button" className="secondary-button" onClick={() => auth.promptLogin('登录后，就能发表你的观影感受。')}>登录 / 注册</button></div>}
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="community-notice" role="status">{notice}</p>}
      <div className="comment-list" aria-label="电影评论"><h4>全部评论 <span>{data.total}</span></h4>{data.comments.length ? data.comments.map(comment => <article className="film-comment" key={comment.id}><div className="comment-meta"><span className="comment-avatar" aria-hidden="true">{Array.from(comment.author)[0]}</span><strong>{comment.author}</strong>{comment.mine && <span className="comment-mine">我</span>}<time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time>{comment.mine && <button className="icon-button" onClick={() => remove(comment.id)} disabled={Boolean(busy)} aria-label="删除我的评论"><Trash size={15} /></button>}</div><p>{comment.content}</p></article>) : <p className="comments-empty">还没有评论，留下一段属于你的观影记忆。</p>}
        {data.total > data.comments.length && <button className="secondary-button comments-more" disabled={Boolean(busy)} onClick={more}>{busy === 'more' ? '正在加载…' : '更多评论'}</button>}
      </div>
    </>}
  </section>;
}
