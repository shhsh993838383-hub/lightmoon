import { normalizeTmdbMovie } from '../../tmdb.mjs';

export const facetFixtures = [
  { id: 999001, title: '跨国测试甲', original_title: 'Fixture A', release_date: '2021-01-01', runtime: 90, genres: [{ id: 35 }], production_countries: [{ iso_3166_1: 'CN' }, { iso_3166_1: 'US' }], spoken_languages: [{ iso_639_1: 'zh' }], credits: { crew: [{ job: 'Director', name: '导演甲' }], cast: [{ name: '演员甲' }, { name: '演员乙' }] } },
  { id: 999002, title: '跨国测试乙', original_title: 'Fixture B', release_date: '1999-01-01', runtime: 130, genres: [{ id: 18 }], production_countries: [{ iso_3166_1: 'JP' }], spoken_languages: [{ iso_639_1: 'ja' }], credits: { crew: [{ job: 'Director', name: '导演甲' }, { job: 'Director', name: '导演乙' }], cast: [{ name: '演员乙' }] } },
  { id: 999003, title: '跨国测试丙', original_title: 'Fixture C', release_date: '', runtime: null, credits: { crew: [{ job: 'Director', name: '演员甲' }], cast: [] } },
].map(raw => normalizeTmdbMovie(raw));

export const metadataFilters = [
  { director: ['导演甲'] }, { cast: ['演员甲'] }, { cast: ['演员甲', '演员乙'] },
  { country: ['中国大陆'] }, { country: ['中国大陆', '美国'] }, { language: ['日语'] },
  { decade: ['2020 年代'] }, { decade: ['1990 年代'] },
  { director: ['导演甲'], cast: ['演员乙'], country: ['日本'], decade: ['1990 年代'] },
];

