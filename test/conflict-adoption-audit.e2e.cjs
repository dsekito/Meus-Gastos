// Strict intended-behavior regressions. No production rewriting or function extraction.
// Run: node test/conflict-adoption-audit.e2e.cjs [scenario-substring]
// Fresh Edge contexts, real app/repository/validator/sync/local-store and IndexedDB.
// Only auth is synthetic; all Drive transport is fulfilled locally, never continued.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs/audit-fixes/conflicts');
fs.mkdirSync(out, { recursive: true });
const user = { id: 'conflict-audit-only', email: 'synthetic@example.invalid' };
const entry = (id, detail) => ({ id, date:'2026-11-11', value:10, type:'OUTROS', description:'OUTROS', flow_type:'expense', paid:false, detail, updated_at:'2026-11-01T12:00:00Z' });
const localEntry = entry('00000000-0000-4000-8000-000000000001', 'LOCAL');
const cloudEntry = entry('00000000-0000-4000-8000-000000000002', 'CLOUD');
const series = id => ({ id, active:false, start_date:'2026-11-01', frequency:'monthly', interval:1, end_mode:'never', value:10, type:'OUTROS', description:'OUTROS', flow_type:'expense' });
const cloud = { schemaVersion:2, revision:1, updatedAt:'2026-11-10T12:00:00Z', entries:[cloudEntry], recurrenceSeries:[series('cloud-series')], settings:{ current_balance:222, balance_reference_date:'2026-11-01', onboarding_status:'completed', types:['CLOUD'], descriptions:['CLOUD DESCRIPTION'], customDescriptionOptionsByType:{ CLOUD:['CLOUD DESCRIPTION'] }, hiddenTypes:['HIDDEN CLOUD'], hiddenDescriptionsByType:{} }, tombstones:{}, compactedDeltas:{} };
const servedApp = fs.readFileSync(path.join(root,'js/app.js'));
const servedAppHash = crypto.createHash('sha256').update(servedApp).digest('hex');
const sourceHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'js/app.js'))).digest('hex');
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/seed') return res.end('<!doctype html><title>isolated synthetic fixture</title>');
  if (pathname === '/js/google-auth.js') {
    res.setHeader('Content-Type','application/javascript');
    return res.end(`window.__auditToken=false; window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>window.__auditToken,getAccessToken:()=>window.__auditToken?'NOT-A-REAL-TOKEN':null,isAccessTokenExpired:()=>false,clearToken:()=>{window.__auditToken=false},signOut:async()=>{window.__auditToken=false},signIn:async()=>{throw Error('REAL_AUTH_FORBIDDEN')}})};`);
  }
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);});
});
const scenarios = ['recurrence-adopts-cloud','full-cloud-adoption','load-failure-preserves-pending','invalid-cloud-preserves-pending','cancel-preserves-pending','account-change-isolation','new-mutation-preserved','idb-abort-preserves-pending'];
async function snapshot(page) {
  return page.evaluate(async user => {
    const memory=Object.fromEntries(['entries','recurrenceSeries','recurrenceDirty','settings','settingsDirty','types','descriptions','customDescriptionOptionsByType','hiddenTypes','hiddenDescriptionsByType','syncQueue'].map(k=>[k,structuredClone(state[k])]));
    memory.deletedEntryIds=[...state.deletedEntryIds];
    const disk=await MGLocalStore.load(user.id,{observe:false});
    return {memory,disk,conflict:state.syncConflict,dialog:syncConflictDialog.open,toast:document.querySelector('#toast').textContent,user:state.user};
  },user);
}
const failuresFor=(actual,expected,prefix)=>Object.keys(expected).flatMap(k=>{
  try{assert.deepEqual(actual[k],expected[k],prefix+'.'+k);return [];}catch(e){return [e.message];}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const beforeHash=sourceHash();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const results=[];
  try {
    for(const scenario of scenarios.filter(x=>!process.argv[2]||x.includes(process.argv[2]))) {
      const context=await browser.newContext({serviceWorkers:'block',timezoneId:'America/Sao_Paulo'});
      const transport=[], errors=[];
      let reached, release;
      const atMedia=new Promise(r=>reached=r), gate=new Promise(r=>release=r);
      try {
        await context.route('**/*',async route=>{
          const req=route.request(), url=new URL(req.url());
          if(url.origin===origin) return route.continue();
          transport.push({url:url.href,method:req.method(),stubbed:true});
          if(url.hostname==='accounts.google.com')return route.fulfill({contentType:'application/javascript',body:'/* no Google identity network */'});
          if(url.hostname!=='www.googleapis.com')return route.abort('blockedbyclient');
          if(req.method()!=='GET')return route.fulfill({status:403,json:{error:'AUDIT_REMOTE_WRITES_FORBIDDEN'}});
          if(url.pathname==='/drive/v3/files')return route.fulfill({json:{files:url.searchParams.get('q').includes("name = 'meus-gastos.json'")?[{id:'synthetic-file',name:'meus-gastos.json',version:'7'}]:[]}});
          if(url.pathname==='/drive/v3/files/synthetic-file'&&url.searchParams.get('alt')==='media') {
            reached();
            await gate;
            if(scenario==='load-failure-preserves-pending')return route.fulfill({status:403,json:{error:'SYNTHETIC_LOAD_FAILURE'}});
            return route.fulfill({json:scenario==='invalid-cloud-preserves-pending'?{schemaVersion:999}:cloud});
          }
          return route.fulfill({status:403,json:{error:'UNEXPECTED_AUDIT_REQUEST'}});
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'/seed');await page.addScriptTag({url:origin+'/js/local-store.js'});
        await page.evaluate(async ({user,localEntry,localSeries})=>{
          localStorage.setItem('meus-gastos-google-user',JSON.stringify(user));
          await MGLocalStore.save(user.id,{entries:[localEntry],recurrenceSeries:[localSeries],recurrenceDirty:true,settings:{current_balance:111,balance_reference_date:'2026-11-01',onboarding_status:'completed'},settingsDirty:true,types:['LOCAL'],descriptions:['LOCAL DESCRIPTION'],customDescriptionOptionsByType:{LOCAL:['LOCAL DESCRIPTION']},hiddenTypes:['HIDDEN LOCAL'],hiddenDescriptionsByType:{},syncQueue:[{type:'upsert',entry:localEntry,mutationId:'local-mutation'},{type:'delete',id:'00000000-0000-4000-8000-000000000003',mutationId:'local-delete'}],syncConflict:{message:'GOOGLE_DRIVE_CONFLICT'}});
        },{user,localEntry,localSeries:series('local-series')});
        await page.goto(origin);await page.waitForFunction(()=>typeof state!=='undefined'&&state.entries.length===1&&document.body.getAttribute('aria-busy')==='false');
        const before=await snapshot(page);
        await page.evaluate(()=>{window.__auditToken=true;openSyncConflictDialog();window.__choice=useCloudVersion.onclick();});
        await Promise.race([atMedia,new Promise((_,reject)=>setTimeout(()=>reject(Error('harness: no actual repository media request')),7000))]);
        let expected=before;
        if(scenario==='cancel-preserves-pending')await page.evaluate(()=>repository.cancelPendingRequests());
        if(scenario==='account-change-isolation') {
          await page.evaluate(async()=>{window.__auditToken=false;await setCurrentUser({id:'conflict-audit-other',email:'other@example.invalid'});await saveLocal();});
          expected=await snapshot(page);
        }
        if(scenario==='new-mutation-preserved') {
          await page.evaluate(async()=>{window.__auditToken=false;await financialMutation(()=>{state.entries.push({...state.entries[0],id:'00000000-0000-4000-8000-000000000004',detail:'NEW DURING CHOICE'});queueUpsert(state.entries.at(-1));state.settings.current_balance=333;state.settingsDirty=true;});});
          expected=await snapshot(page);
        }
        if(scenario==='idb-abort-preserves-pending')await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const req=put.apply(this,args);this.transaction.abort();IDBObjectStore.prototype.put=put;return req;};});
        release();await page.evaluate(()=>window.__choice);const after=await snapshot(page);
        const failures=[];
        if(scenario==='recurrence-adopts-cloud'||scenario==='full-cloud-adoption') {
          const wanted=scenario==='recurrence-adopts-cloud'?{recurrenceSeries:cloud.recurrenceSeries,recurrenceDirty:false}:{entries:cloud.entries,recurrenceSeries:cloud.recurrenceSeries,recurrenceDirty:false,settings:{current_balance:222,balance_reference_date:'2026-11-01',onboarding_status:'completed'},settingsDirty:false,types:cloud.settings.types,descriptions:cloud.settings.descriptions,customDescriptionOptionsByType:cloud.settings.customDescriptionOptionsByType,hiddenTypes:cloud.settings.hiddenTypes,hiddenDescriptionsByType:{},syncQueue:[],deletedEntryIds:[]};
          failures.push(...failuresFor(after.memory,wanted,'memory'));
          const diskWanted={...wanted};delete diskWanted.deletedEntryIds;
          failures.push(...failuresFor(after.disk,diskWanted,'IndexedDB'));
        } else {
          failures.push(...failuresFor(after.memory,expected.memory,'memory preserved'));
          const diskWanted=Object.fromEntries(Object.keys(expected.memory).filter(k=>k!=='deletedEntryIds').map(k=>[k,expected.disk?.[k]]));
          failures.push(...failuresFor(after.disk,diskWanted,'IndexedDB preserved'));
          if(scenario==='account-change-isolation') {
            const otherDisk=await page.evaluate(()=>MGLocalStore.load('conflict-audit-other',{observe:false}));
            // deletedEntryIds is derived from syncQueue on load, not a persisted field.
            const persistedExpected=Object.fromEntries(Object.entries(expected.memory).filter(([key])=>key!=='deletedEntryIds'));
            failures.push(...failuresFor(otherDisk,persistedExpected,'other account IndexedDB'));
          }
        }
        if(errors.length)failures.push('Unhandled browser errors: '+JSON.stringify(errors));
        if(transport.some(r=>r.method!=='GET'))failures.push('Cloud adoption attempted remote write');
        results.push({scenario,status:failures.length?'FAIL':'PASS',failures,before,after,transport,errors});
        console.log(`${failures.length?'FAIL':'PASS'} ${scenario}\n${failures.join('\n')}`);
      } catch(error) {results.push({scenario,status:'HARNESS_ERROR',error:error.stack,transport,errors});console.error(error);} finally {release();await context.close();}
    }
  } finally {await browser.close();await new Promise(r=>server.close(r));}
  const evidence={appJsSHA256Before:beforeHash,appJsSHA256After:sourceHash(),results};
  fs.writeFileSync(path.join(out,'conflict-adoption-results.json'),JSON.stringify(evidence,null,2));
  const counts=results.reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{});
  console.log(JSON.stringify(counts));
  if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
