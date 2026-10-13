// No input/output body or plaintext credential is stored. Price is fixed JPY 1 inclusive.
export const one=(s,sql,...args)=>[...s.sql.exec(sql,...args)][0];
export function state(s){return JSON.parse(one(s,'SELECT data FROM billing WHERE id=1').data);}
export function saveState(s,value){s.sql.exec('UPDATE billing SET data=? WHERE id=1',JSON.stringify(value));}
export function initMeter(s){
  s.sql.exec('CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY,digest TEXT NOT NULL,version TEXT NOT NULL,period TEXT NOT NULL,createdAt INTEGER NOT NULL,unitAmount INTEGER NOT NULL,eventId TEXT NOT NULL UNIQUE,sendState TEXT NOT NULL,firstAttempt INTEGER,attempts INTEGER NOT NULL DEFAULT 0,nextAttempt INTEGER NOT NULL DEFAULT 0,invoiceId TEXT)');
  s.sql.exec('CREATE TABLE IF NOT EXISTS meter (id INTEGER PRIMARY KEY CHECK(id=1),count INTEGER NOT NULL,outstanding INTEGER NOT NULL,paid INTEGER NOT NULL,waived INTEGER NOT NULL)');
  // Old development ledgers fail closed until explicitly reconciled; preserve every receipt.
  const columns=[...s.sql.exec('PRAGMA table_info(calls)')].map(x=>x.name);
  const additions={createdAt:'INTEGER NOT NULL DEFAULT 0',unitAmount:'INTEGER NOT NULL DEFAULT 1',eventId:'TEXT',sendState:"TEXT NOT NULL DEFAULT 'hold'",firstAttempt:'INTEGER',attempts:'INTEGER NOT NULL DEFAULT 0',nextAttempt:'INTEGER NOT NULL DEFAULT 0',invoiceId:'TEXT'};
  for(const [name,type]of Object.entries(additions))if(!columns.includes(name))s.sql.exec(`ALTER TABLE calls ADD COLUMN ${name} ${type}`);
  const meterColumns=[...s.sql.exec('PRAGMA table_info(meter)')].map(x=>x.name);
  for(const name of ['outstanding','paid','waived'])if(!meterColumns.includes(name))s.sql.exec(`ALTER TABLE meter ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  if(!meterColumns.includes('outstanding'))s.sql.exec('UPDATE meter SET outstanding=count');
  s.sql.exec('INSERT OR IGNORE INTO meter VALUES (1,0,0,0,0)');
  s.sql.exec('CREATE TABLE IF NOT EXISTS periods (period TEXT PRIMARY KEY,count INTEGER NOT NULL)');
  s.sql.exec('CREATE TABLE IF NOT EXISTS billing (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
  s.sql.exec('INSERT OR IGNORE INTO billing VALUES (1,?)',JSON.stringify({active:false,checkoutComplete:false,cancelRequested:false,cancelConfirmed:false,checkedUntil:0,collectionHold:true}));
  s.sql.exec('CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY,start INTEGER NOT NULL,end INTEGER NOT NULL,status TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0)');
  s.sql.exec('CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY,digest TEXT NOT NULL,data TEXT NOT NULL)');
  s.sql.exec('CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY,created INTEGER NOT NULL)');
}
export function recordSuccess(s,key,digest,cap,period,now,eventId){
  return s.transactionSync(()=>{
    const old=one(s,'SELECT digest,version FROM calls WHERE id=?',key),meter=one(s,'SELECT * FROM meter WHERE id=1');
    const monthlyCount=one(s,'SELECT count FROM periods WHERE period=?',period)?.count||0;
    if(old)return old.digest===digest&&old.version==='1'?{status:200,replay:true,count:meter.count,monthlyCount,outstanding:meter.outstanding}:{status:409};
    const b=state(s);
    if(!b.active||!b.checkoutComplete||b.cancelRequested||b.cancelConfirmed||b.collectionHold||b.requiresManual||b.pendingInvoice||b.checkedUntil<=now||b.periodStart>now||b.periodEnd<=now||one(s,"SELECT id FROM calls WHERE createdAt<? AND invoiceId IS NULL LIMIT 1",b.periodStart)||one(s,"SELECT id FROM invoices WHERE status!='paid' LIMIT 1"))return {status:503};
    if(!/^rc_[0-9a-f]{64}$/.test(eventId||''))return {status:503};
    if(monthlyCount>=cap||meter.outstanding>=1000||meter.count>=100000)return {status:429};
    s.sql.exec("INSERT INTO calls (id,digest,version,period,createdAt,unitAmount,eventId,sendState) VALUES (?,?,'1',?,?,1,?,'queued')",key,digest,period,now,eventId);
    s.sql.exec('UPDATE meter SET count=count+1,outstanding=outstanding+1 WHERE id=1');
    s.sql.exec('INSERT INTO periods VALUES (?,1) ON CONFLICT(period) DO UPDATE SET count=count+1',period);
    return {status:200,replay:false,count:meter.count+1,monthlyCount:monthlyCount+1,outstanding:meter.outstanding+1};
  });
}
