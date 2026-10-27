import { emptyFilters, facets } from '../src/lib/catalog.js';

export const postgresFacet = group => {
  if (['country', 'language', 'director'].includes(group)) return `COALESCE(to_jsonb(string_to_array(NULLIF(m.data->>'${group}', ''), ' / ')), '[]'::jsonb)`;
  if (group === 'cast') return `COALESCE(jsonb_path_query_array(m.data, '$.cast[*].name'), '[]'::jsonb)`;
  if (group === 'decade') return "CASE WHEN m.year IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(CASE WHEN m.year < 1940 THEN '1940 年前' ELSE ((m.year / 10) * 10)::text || ' 年代' END) END";
  return `COALESCE(m.data->'${group}', '[]'::jsonb)`;
};

export const d1Facet = group => {
  if (!facets.some(facet => facet.id === group)) throw new Error('invalid_facet');
  const field = `json_extract(m.data, '$.${group}')`;
  if (['country', 'language', 'director'].includes(group)) return `CASE WHEN COALESCE(${field}, '') = '' THEN '[]' ELSE '[' || replace(json_quote(${field}), ' / ', '\",\"') || ']' END`;
  if (group === 'cast') return "(SELECT json_group_array(DISTINCT json_extract(person.value, '$.name')) FROM json_each(m.data, '$.cast') person WHERE json_extract(person.value, '$.name') IS NOT NULL)";
  if (group === 'decade') return "CASE WHEN m.year IS NULL THEN '[]' ELSE json_array(CASE WHEN m.year < 1940 THEN '1940 年前' ELSE CAST((m.year / 10) * 10 AS TEXT) || ' 年代' END) END";
  return `COALESCE(${field}, '[]')`;
};

const tagClause = (group, values, all, params, dialect) => {
  if (dialect === 'd1') {
    params.push(JSON.stringify(values));
    const selected = `SELECT COUNT(DISTINCT tag.value) FROM json_each(${d1Facet(group)}) tag WHERE tag.value IN (SELECT value FROM json_each(?))`;
    if (all) { params.push(values.length); return `(${selected}) = ?`; }
    return `(${selected}) > 0`;
  }
  if (dialect === 'postgres') {
    if (facets.some(facet => facet.id === group && (facet.searchable || group === 'decade'))) {
      if (all) { params.push(JSON.stringify(values)); return postgresFacet(group) + ' @> ?::jsonb'; }
      params.push(...values.map(value => JSON.stringify([value])));
      return '(' + values.map(() => postgresFacet(group) + ' @> ?::jsonb').join(' OR ') + ')';
    }
    if (all) { params.push(JSON.stringify({ [group]: values })); return 'm.data @> ?::jsonb'; }
    params.push(...values.map(value => JSON.stringify({ [group]: [value] })));
    return '(' + values.map(() => 'm.data @> ?::jsonb').join(' OR ') + ')';
  }
  params.push(group, ...(dialect === 'd1' ? [JSON.stringify(values)] : values));
  let sql = `m.id IN (SELECT movie_id FROM movie_tags WHERE facet = ? AND tag IN (${dialect === 'd1' ? 'SELECT value FROM json_each(?)' : values.map(() => '?').join(',')})`;
  if (all) { sql += ' GROUP BY movie_id HAVING COUNT(DISTINCT tag) = ?'; params.push(values.length); }
  return sql + ')';
};

export function normalizeFilters(input = {}) {
  const result = emptyFilters();
  for (const facet of facets) result[facet.id] = Array.isArray(input[facet.id]) ? [...new Set(input[facet.id].filter(value => typeof value === 'string' && (facet.searchable ? value.trim() === value && value.length > 0 && value.length <= 100 : facet.options.includes(value))))].slice(0, facet.searchable ? 8 : facet.options.length) : [];
  return result;
}

export function catalogWhere({ filters = {}, mode = 'any', ids, preferences, searchIds, dialect = 'sqlite' } = {}) {
  const clauses = [], params = [];
  const tags = (group, values, all = false) => tagClause(group, values, all, params, dialect);
  const knownTags = group => {
    if (dialect === 'd1') return `json_array_length(${d1Facet(group)}) > 0`;
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
    else if (dialect === 'd1') { clauses.push('m.id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(values)); }
    else { clauses.push(`m.id IN (${values.map(() => '?').join(',')})`); params.push(...values); }
  }
  if (preferences) {
    for (const [name, operator, field] of [['maxMinutes', '<=', 'minutes'], ['minMinutes', '>=', 'minutes'], ['yearMin', '>=', 'year'], ['yearMax', '<=', 'year']]) {
      if (preferences[name] !== null) { clauses.push(`m.${field} IS NOT NULL AND m.${field} ${operator} ?`); params.push(preferences[name]); }
    }
    if (preferences.excludedIds.length) { clauses.push(`m.id NOT IN (${dialect === 'd1' ? 'SELECT value FROM json_each(?)' : preferences.excludedIds.map(() => '?').join(',')})`); params.push(...(dialect === 'd1' ? [JSON.stringify(preferences.excludedIds)] : preferences.excludedIds)); }
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

export function facetSuggestionQuery({ group, query = '', filters = {}, mode = 'any', ...options }, dialect = 'sqlite') {
  if (!facets.some(facet => facet.id === group && facet.searchable)) throw new Error('invalid_facet');
  const normalized = normalizeFilters(filters);
  const selected = normalized[group];
  const combine = selected.length > 0 && mode !== 'all';
  const params = [];
  const selectedMatch = combine ? tagClause(group, selected, false, params, dialect) : null;
  const increment = combine ? `SUM(CASE WHEN ${selectedMatch} THEN 0 ELSE 1 END)` : 'COUNT(*)';
  const candidateWhere = catalogWhere({ ...options, filters: combine ? { ...normalized, [group]: [] } : normalized, mode, dialect });
  params.push(...candidateWhere.params);
  const name = dialect === 'sqlite' ? 't.tag' : 't.value';
  const source = dialect === 'postgres' ? `movies m CROSS JOIN LATERAL jsonb_array_elements_text(${postgresFacet(group)}) AS t(value)` : dialect === 'd1' ? `movies m JOIN json_each(${d1Facet(group)}) t` : 'movies m JOIN movie_tags t ON t.movie_id = m.id';
  const extra = [];
  if (dialect === 'sqlite') { extra.push('t.facet = ?'); params.push(group); }
  extra.push(`instr(lower(${name}), lower(?)) > 0`); params.push(query.trim().slice(0, 100));
  if (selected.length) { extra.push(`${name} NOT IN (${selected.map(() => '?').join(',')})`); params.push(...selected); }
  const sql = `SELECT ${name} AS value, ${increment} AS count FROM ${source}${candidateWhere.sql || ' WHERE 1=1'} AND ${extra.join(' AND ')} GROUP BY ${name} ORDER BY count DESC, ${name} LIMIT 12`;
  const current = combine ? catalogWhere({ ...options, filters: normalized, mode, dialect }) : null;
  return { sql: dialect === 'postgres' ? sql.replaceAll(`instr(lower(${name}), lower(?))`, `strpos(lower(${name}), lower(?))`) : sql, params, current };
}

export const catalogSort = (sort, dialect = 'sqlite') => ({ newest: 'm.year IS NULL, m.year DESC, m.rowid', oldest: 'm.year IS NULL, m.year, m.rowid', shortest: 'm.minutes IS NULL, m.minutes, m.rowid', rating: 'm.rating IS NULL, m.rating DESC, m.votes DESC, m.rowid' }[sort] || 'm.curated DESC, m.rowid').replaceAll('m.rowid', dialect === 'postgres' ? 'm.sequence' : 'm.rowid');

export function catalogOrder(options, dialect = 'sqlite') {
  if (options.sort !== 'collection' || !Array.isArray(options.ids)) return { sql: catalogSort(options.sort, dialect), params: [] };
  return {
    sql: dialect === 'postgres' ? '(SELECT position FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS selected(value,position) WHERE selected.value=m.id)' : '(SELECT CAST(selected.key AS INTEGER) FROM json_each(?) selected WHERE selected.value=m.id)',
    params: [JSON.stringify(options.ids)],
  };
}
