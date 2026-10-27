import { useEffect, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { parseScoreRange } from '../lib/score-ranges.js';

// Extend Lightmoon's existing filter controls, type scale and colour tokens.
export default function ScoreRangeFilter({ facet, value, onChange }) {
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const range = parseScoreRange(facet, value);
    setMinimum(range ? String(range.min) : ''); setMaximum(range ? String(range.max) : ''); setError('');
  }, [value, facet]);
  function apply(event) {
    event.preventDefault();
    if (!minimum && !maximum) { onChange(facet.id, ''); return; }
    const next = `${minimum || 0}:${maximum || facet.maximum}`;
    if (!parseScoreRange(facet, next)) { setError(`请输入 0–${facet.maximum} 之间的区间，最低分不能高于最高分。`); return; }
    setError(''); onChange(facet.id, next);
  }
  return <section className="score-range-filter" aria-label={`${facet.label}评分区间`}>
    <div className="score-range-heading"><h3>{facet.label}<span>{facet.maximum === 100 ? '专业新鲜度' : '十分制'}</span></h3>{value && <button type="button" onClick={() => onChange(facet.id, '')} aria-label={`清除${facet.label}评分区间`}>清除</button>}</div>
    <form onSubmit={apply}>
      <div className="score-range-inputs"><label><span>最低</span><input type="number" inputMode="decimal" min="0" max={facet.maximum} step={facet.step} value={minimum} placeholder="0" aria-label={`${facet.label}最低评分`} onChange={event => { setMinimum(event.target.value); setError(''); }} /></label><span className="score-range-divider" aria-hidden="true">–</span><label><span>最高</span><input type="number" inputMode="decimal" min="0" max={facet.maximum} step={facet.step} value={maximum} placeholder={String(facet.maximum)} aria-label={`${facet.label}最高评分`} onChange={event => { setMaximum(event.target.value); setError(''); }} /></label><button type="submit" className="score-range-apply" aria-label={`应用${facet.label}评分区间`}><ArrowRight size={15} /></button></div>
      {error && <p className="score-range-error" role="alert">{error}</p>}
    </form>
    <div className="score-range-presets">{facet.presets.map(min => <button key={min} type="button" aria-pressed={value === `${min}:${facet.maximum}`} onClick={() => onChange(facet.id, value === `${min}:${facet.maximum}` ? '' : `${min}:${facet.maximum}`)} aria-label={`${facet.label}${min}${facet.unit}及以上`}>≥ {min}{facet.maximum === 100 ? '%' : '分'}</button>)}</div>
  </section>;
}
