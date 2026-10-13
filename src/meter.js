// SQL transaction encompasses idempotency receipt and count. No input/output body is stored.
export function initMeter(storage) {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, digest TEXT NOT NULL, version TEXT NOT NULL, period TEXT NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS meter (id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER NOT NULL)');
  storage.sql.exec('INSERT OR IGNORE INTO meter VALUES (1,0)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS periods (period TEXT PRIMARY KEY, count INTEGER NOT NULL)');
}
export function recordSuccess(storage, key, digest, cap, period) {
  return storage.transactionSync(() => {
    const old = [...storage.sql.exec('SELECT digest,version FROM calls WHERE id=?', key)][0];
    const count = [...storage.sql.exec('SELECT count FROM meter WHERE id=1')][0].count;
    const monthlyCount = [...storage.sql.exec('SELECT count FROM periods WHERE period=?', period)][0]?.count || 0;
    if (old) return old.digest === digest && old.version === '1' ? { status: 200, replay: true, count, monthlyCount } : { status: 409 };
    if (monthlyCount >= cap || count >= 100000) return { status: 429 };
    storage.sql.exec('INSERT INTO calls VALUES (?,?,?,?)', key, digest, '1', period);
    storage.sql.exec('UPDATE meter SET count=count+1 WHERE id=1');
    storage.sql.exec('INSERT INTO periods VALUES (?,1) ON CONFLICT(period) DO UPDATE SET count=count+1', period);
    return { status: 200, replay: false, count: count + 1, monthlyCount: monthlyCount + 1 };
  });
}
