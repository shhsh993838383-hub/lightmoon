-- Build a covering tag index once; keep it current for every import path.
-- Movie records, accounts, ratings and comments remain intact.
CREATE TRIGGER IF NOT EXISTS movies_tags_insert AFTER INSERT ON movies BEGIN
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'genre',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.genre'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'mood',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.mood'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'theme',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.theme'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'country',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.country'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.country')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'director',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.director'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.director')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'cast',CAST(tag.value AS TEXT) FROM json_each((SELECT json_group_array(DISTINCT json_extract(person.value, '$.name')) FROM json_each(NEW.data, '$.cast') person WHERE json_extract(person.value, '$.name') IS NOT NULL)) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'decade',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN NEW.year IS NULL THEN '[]' ELSE json_array(CASE WHEN NEW.year < 1940 THEN '1940 年前' ELSE CAST((NEW.year / 10) * 10 AS TEXT) || ' 年代' END) END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'language',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.language'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.language')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'pace',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.pace'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'structure',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.structure'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
END;
CREATE TRIGGER IF NOT EXISTS movies_tags_update AFTER UPDATE OF data,year ON movies BEGIN
  DELETE FROM movie_tags WHERE movie_id=NEW.id;
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'genre',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.genre'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'mood',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.mood'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'theme',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.theme'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'country',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.country'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.country')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'director',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.director'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.director')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'cast',CAST(tag.value AS TEXT) FROM json_each((SELECT json_group_array(DISTINCT json_extract(person.value, '$.name')) FROM json_each(NEW.data, '$.cast') person WHERE json_extract(person.value, '$.name') IS NOT NULL)) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'decade',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN NEW.year IS NULL THEN '[]' ELSE json_array(CASE WHEN NEW.year < 1940 THEN '1940 年前' ELSE CAST((NEW.year / 10) * 10 AS TEXT) || ' 年代' END) END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'language',CAST(tag.value AS TEXT) FROM json_each(CASE WHEN COALESCE(json_extract(NEW.data, '$.language'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(NEW.data, '$.language')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'pace',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.pace'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
  INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag) SELECT NEW.id,'structure',CAST(tag.value AS TEXT) FROM json_each(COALESCE(json_extract(NEW.data, '$.structure'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';
END;
CREATE TRIGGER IF NOT EXISTS movies_tags_delete AFTER DELETE ON movies BEGIN
  DELETE FROM movie_tags WHERE movie_id=OLD.id;
END;

DELETE FROM movie_tags;
INSERT OR IGNORE INTO movie_tags(movie_id,facet,tag)
SELECT m.id AS movie_id, 'genre' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(COALESCE(json_extract(m.data, '$.genre'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'mood' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(COALESCE(json_extract(m.data, '$.mood'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'theme' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(COALESCE(json_extract(m.data, '$.theme'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'country' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(CASE WHEN COALESCE(json_extract(m.data, '$.country'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(m.data, '$.country')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'director' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(CASE WHEN COALESCE(json_extract(m.data, '$.director'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(m.data, '$.director')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'cast' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each((SELECT json_group_array(DISTINCT json_extract(person.value, '$.name')) FROM json_each(m.data, '$.cast') person WHERE json_extract(person.value, '$.name') IS NOT NULL)) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'decade' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(CASE WHEN m.year IS NULL THEN '[]' ELSE json_array(CASE WHEN m.year < 1940 THEN '1940 年前' ELSE CAST((m.year / 10) * 10 AS TEXT) || ' 年代' END) END) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'language' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(CASE WHEN COALESCE(json_extract(m.data, '$.language'), '') = '' THEN '[]' ELSE '[' || replace(json_quote(json_extract(m.data, '$.language')), ' / ', '","') || ']' END) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'pace' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(COALESCE(json_extract(m.data, '$.pace'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>''
UNION ALL
SELECT m.id AS movie_id, 'structure' AS facet, CAST(tag.value AS TEXT) AS tag FROM movies m JOIN json_each(COALESCE(json_extract(m.data, '$.structure'), '[]')) tag WHERE tag.type='text' AND trim(tag.value)<>'';

CREATE INDEX IF NOT EXISTS movies_rating_order ON movies(rating DESC,votes DESC);
INSERT INTO metadata(key,value) VALUES ('catalogTagIndexVersion','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
PRAGMA optimize;
