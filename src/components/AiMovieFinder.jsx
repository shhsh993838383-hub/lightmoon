import FilmRatings from './FilmRatings.jsx';
import { apiUrl, assetUrl, hasApi } from '../lib/urls.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, ArrowUpRight, Check, ChatCircleDots, FilmSlate, Heart, PaperPlaneTilt, Plus, Sparkle, Stop } from '@phosphor-icons/react';

const startingPrompts = [
  '今天有点累，想看轻松治愈的电影',
  '想看爱情片，但不要太悲伤，两个小时以内',
  '推荐几部像《白日梦想家》一样的电影',
  '想看看王家卫导演的电影',
];

function conversationHistory(messages) {
  return messages.slice(-23).map(message => ({
    role: message.role,
    content: (message.content + (message.recommendations?.length ? '\n推荐影片：' + message.recommendations.map(movie => movie.title).join('、') : '')).slice(0, 1800),
  }));
}

function Recommendation({ movie, saved, onSave, onOpen }) {
  const [failed, setFailed] = useState(false);
  return <article className="ai-recommendation">
    <button className="ai-movie-poster" onClick={() => onOpen(movie)} aria-label={`查看${movie.title}`}>
      {failed || !movie.poster ? <span className="ai-poster-failure"><FilmSlate size={28} /></span> : <img src={assetUrl(movie.poster)} width={movie.posterWidth} height={movie.posterHeight} alt={`${movie.title}电影海报`} loading="lazy" onError={() => setFailed(true)} />}
    </button>
    <div className="ai-movie-copy"><div className="ai-movie-heading"><button onClick={() => onOpen(movie)}>{movie.title}<ArrowUpRight size={13} /></button><button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={() => onSave(movie.id)} aria-pressed={saved} aria-label={`${saved ? '从想看中移除' : '想看'}${movie.title}`}><Heart size={17} weight={saved ? 'fill' : 'regular'} /></button></div><div className="ai-movie-meta">{movie.year || '年份待补充'} · {movie.minutes ? `${movie.minutes} 分钟` : '片长待补充'}</div><FilmRatings movie={movie} /><p>{movie.reason}</p><button className="ai-detail-link" onClick={() => onOpen(movie)}>查看电影资料<ArrowRight size={12} /></button></div>
  </article>;
}

export default function AiMovieFinder({ movies, saved, onSave, onOpen, active }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  const statusController = useRef(null);
  const bottom = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(messages);
  const pendingRef = useRef(false);
  const map = new Map(movies.map(movie => [movie.id, movie]));
  messagesRef.current = messages;

  async function loadStatus() {
    statusController.current?.abort();
    const request = new AbortController();
    statusController.current = request;
    setStatusFailed(false);
    try {
      const response = await fetch(apiUrl('/api/assistant/status'), { signal: request.signal });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.ready || !Number.isInteger(result.movieCount)) throw new Error();
      setStatus(result);
    } catch (issue) { if (issue.name !== 'AbortError') setStatusFailed(true); }
  }

  useEffect(() => {
    if (hasApi && active && !status && !statusFailed) loadStatus();
  }, [active, status, statusFailed]);

  useEffect(() => () => { controller.current?.abort(); statusController.current?.abort(); }, []);
  useEffect(() => {
    if (active && messages.length) bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, [messages.length, pending, active]);

  async function ask(text, mode = 'auto', retry = false) {
    const question = text.trim();
    if (pendingRef.current || (!question && !retry)) return;
    const prior = messagesRef.current;
    const next = retry ? prior : [...prior, { role: 'user', content: question }];
    if (!next.length || next.at(-1).role !== 'user') return;
    const request = new AbortController();
    controller.current = request;
    pendingRef.current = true;
    setMessages(next);
    setInput(''); setError(''); setPending(true);
    try {
      const response = await fetch(apiUrl('/api/assistant/chat'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationHistory(next), mode }), signal: request.signal,
      });
      const answer = await response.json();
      if (request.signal.aborted || controller.current !== request) return;
      if (!response.ok) throw new Error(answer.error || '暂时无法完成找片，请稍后再试。');
      if (typeof answer.message !== 'string' || !Array.isArray(answer.recommendations)) throw new Error('回复不完整，请重试。');
      const responseMovies = new Map([...movies, ...(answer.movies || [])].map(movie => [movie.id, movie]));
      const recommendations = answer.recommendations.filter(item => responseMovies.has(item.id)).map(item => ({ ...responseMovies.get(item.id), reason: item.reason }));
      setMessages([...next, { role: 'assistant', content: answer.message, recommendations, followUps: answer.followUps || [], mode: answer.mode }]);
    } catch (issue) {
      if (issue.name === 'AbortError') setError('本次找片已停止。你可以重试，或继续补充条件。');
      else setError(issue.message === 'Failed to fetch' || issue instanceof TypeError ? '暂时连不上电影知识库，请确认服务已启动后重试。' : issue.message);
    } finally {
      if (controller.current === request) { controller.current = null; pendingRef.current = false; setPending(false); }
    }
  }

  function newConversation() {
    controller.current?.abort(); controller.current = null; pendingRef.current = false;
    setMessages([]); setInput(''); setError(''); setPending(false);
    inputRef.current?.focus();
  }

  const last = messages.at(-1);
  const modeLabel = status?.mode === 'deepseek' ? 'DeepSeek 对话' : status ? '片库检索' : statusFailed ? '知识库暂不可用' : '正在连接知识库';

  if (!hasApi) return <section className="ai-finder" aria-label="AI 对话找电影"><div className="ai-page-heading"><div><div className="ai-page-title"><span className="ai-page-icon"><ChatCircleDots size={23} weight="fill" /></span><h1>把想看的感觉，说给我听。</h1></div><p>AI 对话即将开放。先从类型、心情和主题出发，发现下一部电影。</p></div></div><div className="ai-welcome"><div className="ai-welcome-copy"><Sparkle size={24} className="ai-welcome-spark" /><h2>好故事，<br />可以慢慢找。</h2><p>现在可以使用标签组合、电影搜索和主题片单。AI 对话开放后，你可以直接说出想看的感觉。</p></div><div className="ai-welcome-posters" aria-hidden="true">{['in-the-mood', 'walter-mitty', 'totoro'].map(id => { const movie = map.get(id); return movie && <img key={id} src={assetUrl(movie.poster)} alt="" width={movie.posterWidth} height={movie.posterHeight} />; })}</div></div></section>;

  return <section className="ai-finder" aria-label="AI 对话找电影">
    <div className="ai-page-heading"><div><div className="ai-page-title"><span className="ai-page-icon"><ChatCircleDots size={23} weight="fill" /></span><h1>把想看的感觉，说给我听。</h1></div><p>聊聊心情、喜欢的故事，或一部你念念不忘的电影。</p></div><button className="new-conversation" onClick={newConversation} disabled={pending || !messages.length}><Plus size={16} />新对话</button></div>
    <div className="ai-source-status"><span><span className="knowledge-icon"><FilmSlate size={15} /></span>{status ? `已收录 ${status.movieCount} 部电影 · ${modeLabel}` : modeLabel}</span>{statusFailed && <button onClick={loadStatus}><ArrowClockwise size={13} />重新连接</button>}</div>

    {!messages.length ? <div className="ai-welcome"><div className="ai-welcome-copy"><Sparkle size={24} className="ai-welcome-spark" /><h2>下一部好电影，<br />从一句话开始。</h2><p>不必知道片名，先说说你想看什么。</p><div className="ai-starting-prompts">{startingPrompts.map(prompt => <button key={prompt} onClick={() => ask(prompt)} disabled={pending}><span>{prompt}</span><ArrowUpRight size={15} /></button>)}</div></div><div className="ai-welcome-posters" aria-hidden="true">{['in-the-mood', 'walter-mitty', 'totoro'].map(id => { const movie = map.get(id); return movie && <img key={id} src={assetUrl(movie.poster)} alt="" width={movie.posterWidth} height={movie.posterHeight} />; })}</div></div> : <div className="ai-conversation" role="log" aria-label="找电影对话" aria-live="polite" aria-relevant="additions">
      {messages.map((message, index) => <div className={`ai-message ai-message-${message.role}`} key={index}>{message.role === 'assistant' && <span className="ai-avatar" aria-hidden="true"><Sparkle size={19} weight="fill" /></span>}<div className="ai-message-content">{message.role === 'assistant' && <span className="ai-message-author">光幕{message.mode === 'local' ? '片库检索' : '选片助手'}</span>}<p className="ai-message-text">{message.content}</p>{message.recommendations?.length > 0 && <div className="ai-recommendations">{message.recommendations.map(movie => <Recommendation key={movie.id} movie={movie} saved={saved.includes(movie.id)} onSave={onSave} onOpen={onOpen} />)}</div>}</div></div>)}
      {pending && <div className="ai-message ai-message-assistant"><span className="ai-avatar"><Sparkle size={19} /></span><div className="ai-loading" role="status"><span>正在从电影资料中寻找合适的故事</span><div className="ai-loading-lines" aria-hidden="true"><span /><span /></div></div></div>}
    </div>}

    {error && <div className="ai-error" role="alert"><p>{error}</p><div><button onClick={() => ask('', 'auto', true)}><ArrowClockwise size={13} />重试</button><button onClick={() => ask('', 'local', true)}>使用片库检索<ArrowRight size={13} /></button></div></div>}
    {!pending && !error && last?.role === 'assistant' && last.followUps?.length > 0 && <div className="ai-followups" aria-label="继续找片">{last.followUps.map(question => <button key={question} onClick={() => ask(question)}>{question}<ArrowUpRight size={12} /></button>)}</div>}

    <div className="ai-composer-wrap"><form className="ai-composer" onSubmit={event => { event.preventDefault(); ask(input); }}><label className="sr-only" htmlFor="ai-movie-question">告诉我你想看什么电影</label><textarea id="ai-movie-question" ref={inputRef} value={input} maxLength={1800} rows={2} placeholder="比如：想看轻松的爱情片，不要太悲伤，两个小时以内……" onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(input); } }} /><div className="ai-composer-bottom"><span><ChatCircleDots size={14} />{messages.length ? '可以继续补充或修改条件' : '从现有电影知识库出发，为你找片'}</span>{pending ? <button type="button" className="ai-send-button" onClick={() => controller.current?.abort()}><Stop size={14} weight="fill" />停止</button> : <button type="submit" className="ai-send-button" disabled={!input.trim()}><PaperPlaneTilt size={15} weight="fill" />发送</button>}</div></form><p className="ai-mode-note">{status?.mode === 'deepseek' ? '本次对话与匹配的影片资料会发送至 DeepSeek。电影推荐仅供参考。' : '当前使用现有片库检索。接入 DeepSeek 后，可进行更灵活的 AI 对话。'}</p></div>
    <div ref={bottom} className="ai-conversation-end" />
  </section>;
}
