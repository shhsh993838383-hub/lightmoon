import { emptyFilters, facets } from '../src/lib/catalog.js';

const tagClause = (group, values, all, params, dialect) => {
  if (dialect === 'postgres') {
    if (all) { params.push(JSON.stringify({ [group]: values })); return 'm.data @> ?::jsonb'; }
    params.push(...values.map(value => JSON.stringify({ [group]: [value] })));
    return '(' + values.map(() => 'm.data @> ?::jsonb').join(' OR ') + ')';
  }
  params.push(group, ...values);
  let sql = `m.id IN (SELECT movie_id FROM movie_tags WHERE facet = ? AND tag IN (${values.map(() => '?').join(',')})`;
  if (all) { sql += ' GROUP BY movie_id HAVING COUNT(DISTINCT tag) = ?'; params.push(values.length); }
  return sql + ')';
};

export function normalizeFilters(input = {}) {
  const result = emptyFilters();
  for (const facet of facets) result[facet.id] = Array.isArray(input[facet.id]) ? [...new Set(input[facet.id].filter(value => facet.options.includes(value)))] : [];
  return result;
}

export function catalogWhere({ filters = {}, mode = 'any', ids, preferences, searchIds, dialect = 'sqlite' } = {}) {
  const clauses = [], params = [];
  const tags = (group, values, all = false) => tagClause(group, values, all, params, dialect);
  const knownTags = group => {
    params.push(group);
    return dialect === 'postgres' ? "jsonb_array_length(COALESCE(m.data -> ?::text, '[]'::jsonb)) > 0" : 'm.id IN (SELECT movie_id FROM movie_tags WHERE facet = ?)';
  };
  for (const [group, values] of Object.entries(normalizeFilters(filters))) {
    if (!values.length) continue;
    if (group === 'exclude') {
      clauses.push(knownTags('mood'));
      clauses.push('NOT ' + tags('mood', values));
    } else if (group === 'duration') {
      clauses.push('m.minutes IS NOT NULL');
      const ranges = values.map(value => value === '100 分钟以内' ? 'm.minutes <= 100' : value === '101-120 分钟' ? '(m.minutes > 100 AND m.minutes <= 120)' : 'm.minutes > 120');
      clauses.push('(' + ranges.join(mode === 'all' ? ' AND ' : ' OR ') + ')');
    } else clauses.push(tags(group, values, mode === 'all'));
  }
  for (const values of [ids, searchIds]) if (Array.isArray(values)) {
    if (!values.length) clauses.push(dialect === 'postgres' ? 'FALSE' : '0');
    else { clauses.push(`m.id IN (${values.map(() => '?').join(',')})`); params.push(...values); }
  }
  if (preferences) {
    for (const [name, operator, field] of [['maxMinutes', '<=', 'minutes'], ['minMinutes', '>=', 'minutes'], ['yearMin', '>=', 'year'], ['yearMax', '<=', 'year']]) {
      if (preferences[name] !== null) { clauses.push(`m.${field} IS NOT NULL AND m.${field} ${operator} ?`); params.push(preferences[name]); }
    }
    if (preferences.excludedIds.length) { clauses.push(`m.id NOT IN (${preferences.excludedIds.map(() => '?').join(',')})`); params.push(...preferences.excludedIds); }
    for (const sign of ['positive', 'negative']) for (const [group, values] of Object.entries(preferences[sign])) {
      if (!values.length) continue;
      const negative = sign === 'negative';
      if (group === 'country' || group === 'director') {
        const field = dialect === 'postgres' ? `m.data->>'${group}'` : `json_extract(m.data, '$.${group}')`;
        const expression = values.map(() => dialect === 'postgres' ? `strpos(COALESCE(${field}, ''), ?) > 0` : `instr(${field}, ?) > 0`).join(' OR ');
        clauses.push(`${negative ? 'NOT ' : ''}(${expression})`); params.push(...values);
        if (negative) clauses.push(`COALESCE(${field}, '') <> ''`);
      } else {
        if (negative) clauses.push(knownTags(group));
        clauses.push((negative ? 'NOT ' : '') + tags(group, values));
      }
    }
  }
  return { sql: clauses.length ? ' WHERE ' + clauses.map(clause => '(' + clause + ')').join(' AND ') : '', params };
}

export const catalogSort = (sort, dialect = 'sqlite') => ({ newest: 'm.year IS NULL, m.year DESC, m.rowid', oldest: 'm.year IS NULL, m.year, m.rowid', shortest: 'm.minutes IS NULL, m.minutes, m.rowid', rating: 'm.rating IS NULL, m.rating DESC, m.votes DESC, m.rowid' }[sort] || 'm.curated DESC, m.rowid').replaceAll('m.rowid', dialect === 'postgres' ? 'm.sequence' : 'm.rowid');
