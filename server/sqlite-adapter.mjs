// The local SQLite database implements the small D1 surface shared by accounts.
export function sqliteD1Adapter(sqlite) {
  return {
    prepare(sql) {
      const build = parameters => ({
        bind(...values) { return build(values); },
        async first() { return sqlite.prepare(sql).get(...parameters) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...parameters), success: true }; },
        execute() { return { results: sqlite.prepare(sql).all(...parameters), success: true }; },
        async run() { return sqlite.prepare(sql).run(...parameters); },
      });
      return build([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
