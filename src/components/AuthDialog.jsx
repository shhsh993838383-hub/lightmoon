import { useEffect, useState } from 'react';
import { ArrowRight, FilmSlate, SignOut, UserCircle, X } from '@phosphor-icons/react';
import Dialog from './Dialog.jsx';

export default function AuthDialog({ auth, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!auth.open) setError(''); }, [auth.open]);
  const registering = auth.mode === 'register';
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (registering && values.get('password') !== values.get('confirm')) { setError('两次输入的密码不一致。'); return; }
    setBusy(true); setError('');
    try {
      await auth.submit(registering ? 'register' : 'login', { email: values.get('email'), password: values.get('password'), ...(registering ? { displayName: values.get('displayName') } : {}) });
      form.reset(); onNotice(registering ? '欢迎加入光幕，账号已创建' : '已登录光幕');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await auth.logout(); onNotice('已退出登录，当前为游客浏览'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Dialog open={auth.open} onClose={() => { if (!busy) auth.guest(); }} className="auth-dialog" label={auth.user ? '我的光幕账号' : '登录或注册光幕'}>
    <button className="dialog-close icon-button" onClick={auth.guest} disabled={busy} aria-label={auth.user ? '关闭账号窗口' : '以游客身份浏览'}><X size={21} /></button>
    <div className="auth-brand"><FilmSlate size={25} weight="fill" /><span>光幕 <small>lightmoon</small></span></div>
    {auth.user ? <div className="account-panel">
      <UserCircle size={46} weight="light" /><h2>{auth.user.displayName}</h2><p>{auth.user.email}</p>
      <p className="account-note">你的评分、评论、想看和已看记录，已与账号关联。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="secondary-button" onClick={logout} disabled={busy}><SignOut size={18} />{busy ? '正在退出…' : '退出登录'}</button>
    </div> : <>
      <span className="auth-eyebrow">把电影，变成自己的记忆。</span>
      <h2>{registering ? '从这一部，开始记录。' : '欢迎来到光幕。'}</h2>
      <p className="auth-description">登录后，为电影打分，留下观影感受，收藏下一部想看。</p>
      {auth.reason && <p className="auth-reason">{auth.reason}{auth.reason.includes('恢复') && <button disabled={auth.checking || busy} onClick={auth.retry}>{auth.checking ? '正在重试…' : '重试连接'}</button>}</p>}
      <div className="auth-tabs" role="group" aria-label="选择登录或注册">{[['login', '登录'], ['register', '注册账号']].map(([value, label]) => <button key={value} aria-pressed={auth.mode === value} disabled={busy} onClick={() => { auth.setMode(value); setError(''); }}>{label}</button>)}</div>
      <form key={auth.mode} className="auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">邮箱<input id="auth-email" name="email" type="email" autoComplete="email" placeholder="你的邮箱地址" maxLength={254} required disabled={busy} /></label>
        {registering && <label htmlFor="auth-name">昵称 <span>选填，评论中公开显示</span><input id="auth-name" name="displayName" autoComplete="nickname" placeholder="怎么称呼你" maxLength={24} disabled={busy} /></label>}
        <label htmlFor="auth-password">{registering ? '设置密码' : '密码'}<input id="auth-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? '10–128 个字符' : '输入你的密码'} minLength={registering ? 10 : 1} maxLength={128} required disabled={busy} /></label>
        {registering && <label htmlFor="auth-confirm">确认密码<input id="auth-confirm" name="confirm" type="password" autoComplete="new-password" placeholder="再次输入密码" minLength={10} maxLength={128} required disabled={busy} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {registering && <p className="auth-smallprint">请使用自己的邮箱。当前无需邮件验证，暂不支持找回密码，请妥善保存密码。</p>}
        <button className="primary-button auth-submit" disabled={busy || auth.checking}>{busy ? '正在处理…' : registering ? '注册并登录' : '登录光幕'}<ArrowRight size={17} /></button>
      </form>
      <div className="auth-guest"><button disabled={busy} onClick={auth.guest}>先以游客身份浏览<ArrowRight size={15} /></button><span>可浏览电影、评分和评论</span></div>
    </>}
  </Dialog>;
}
