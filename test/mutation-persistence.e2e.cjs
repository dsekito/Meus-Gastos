// Real Edge + IndexedDB, isolated synthetic account; no Google traffic.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const user={id:'mutation-regression-synthetic',email:'test@example.invalid'};
const id='00000000-0000-4000-8000-000000000091';
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/seed')return res.end('<!doctype html><title>Seed</title>');
  if(pathname==='/js/google-auth.js'){
    res.setHeader('Content-Type','application/javascript');
    return res.end(`window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>false,getAccessToken:()=>null,isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{},signIn:async()=>{throw Error('REAL_AUTH_FORBIDDEN')}})};`);
  }
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);});
});
async function abortNextPut(page){await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);this.transaction.abort();IDBObjectStore.prototype.put=put;return request;};});}
async function snapshot(page){return page.evaluate(async user=>({entries:structuredClone(state.entries),recurrenceSeries:structuredClone(state.recurrenceSeries),recurrenceDirty:state.recurrenceDirty,settings:structuredClone(state.settings),settingsDirty:state.settingsDirty,syncQueue:structuredClone(state.syncQueue),deletedEntryIds:[...state.deletedEntryIds],disk:await MGLocalStore.load(user.id,{observe:false}),toast:document.querySelector('#toast').textContent,editingId:state.editingId}),user);}
async function settled(page){await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]:is(button)'));await page.waitForTimeout(80);}
const cases={
  async 'create-abort-retry'(page){
    await page.evaluate(()=>{openNew();dateInput.value='2026-11-11';valueInput.value='50';flowType.value='expense';renderEntryOptions('OUTROS','OUTROS');recurrence.value='single';detailInput.value='keep draft';updateEntryFormVisibility();});
    const before=await snapshot(page);await abortNextPut(page);await page.locator('#saveEntry').click();await settled(page);
    const failed=await snapshot(page);assert.deepEqual(failed.entries,before.entries,'abort must roll back unsaved creation');assert.deepEqual(failed.syncQueue,before.syncQueue);assert.equal(await page.locator('#value').inputValue(),'50');assert.match(failed.toast,/não salv|não foi possível salvar/i);
    await page.locator('#saveEntry').click();await page.waitForFunction(()=>!document.querySelector('#entryDialog').open);
    const after=await snapshot(page);assert.equal(after.disk.entries.length,2,'retry must create exactly once');assert.equal(after.entries.length,2);
  },
  async 'delete-abort'(page){
    const before=await snapshot(page);await abortNextPut(page);await page.evaluate(id=>{state.activeEntry=id;deleteEntry();},id);await page.locator('#confirmDelete').click();await settled(page);
    const failed=await snapshot(page);assert.deepEqual(failed.entries,before.entries,'failed deletion must restore financial state');assert.deepEqual(failed.syncQueue,before.syncQueue);assert.deepEqual(failed.deletedEntryIds,before.deletedEntryIds);assert.deepEqual(failed.disk.entries,before.disk.entries);assert.match(failed.toast,/não salva/i);assert.equal(await page.locator('#confirmDelete').isEnabled(),true);
  },
  async 'delete-cas'(page,{context,origin}){
    const other=await context.newPage();await other.goto(origin+'/seed');await other.addScriptTag({url:origin+'/js/local-store.js'});
    await other.evaluate(async user=>{const data=await MGLocalStore.load(user.id);data.entries[0].detail='OTHER TAB';data.settings.current_balance=9999;data.settingsDirty=true;data.recurrenceDirty=true;data.types=['EXTERNAL'];data.syncQueue=[{type:'upsert',entry:data.entries[0]}];await MGLocalStore.save(user.id,data);},user);
    await page.evaluate(id=>{state.activeEntry=id;deleteEntry();},id);await page.locator('#confirmDelete').click();await settled(page);
    const failed=await snapshot(page);assert.equal(failed.entries[0]?.detail,'OTHER TAB','CAS must load latest entries');assert.equal(failed.settings.current_balance,9999,'CAS must load full snapshot');assert.equal(failed.settingsDirty,true);assert.equal(failed.recurrenceDirty,true);assert.deepEqual(failed.syncQueue,failed.disk.syncQueue);assert.equal(await page.evaluate(()=>state.types[0]),'EXTERNAL');assert.match(failed.toast,/não salva.*outra aba/i);
    await page.waitForTimeout(400);assert.equal((await snapshot(page)).disk.entries.length,1,'no automatic replay');
  },
  async 'settings-abort'(page){
    await page.evaluate(()=>{openSettingsDialog('projection');currentBalanceInput.value='5000';balanceReferenceDateInput.value='2026-11-01';});
    const before=await snapshot(page);await abortNextPut(page);await page.locator('#saveSettings').click();await settled(page);
    const failed=await snapshot(page);assert.deepEqual(failed.settings,before.settings,'failed settings must roll back');assert.equal(failed.settingsDirty,before.settingsDirty);assert.equal(failed.disk.settings.current_balance,1000);assert.equal(await page.locator('#currentBalance').inputValue(),'5000');assert.equal(await page.evaluate(()=>settingsDialog.open),true);assert.match(failed.toast,/não salva/i);
    await page.locator('#saveSettings').click();await settled(page);assert.equal((await snapshot(page)).disk.settings.current_balance,5000);
  },
  async 'bulk-delete-abort'(page){
    await page.evaluate(id=>{enterSelectionMode(id);},id);const before=await snapshot(page);await abortNextPut(page);
    await page.evaluate(id=>performDeleteSelectedEntries(new Set([id])),id);const after=await snapshot(page);
    assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.syncQueue,before.syncQueue);assert.deepEqual(after.deletedEntryIds,before.deletedEntryIds);assert.match(after.toast,/não salva/i);assert.equal(await page.evaluate(id=>state.selectedEntries.has(id),id),true);
  },
  async 'recurring-delete-abort'(page){
    await page.evaluate(()=>{openNew();dateInput.value='2026-11-11';valueInput.value='50';flowType.value='expense';renderEntryOptions('OUTROS','OUTROS');recurrence.value='monthly';endMode.value='after_occurrences';occurrenceCount.value='3';updateEntryFormVisibility();});
    await page.locator('#saveEntry').click();await page.waitForFunction(()=>!document.querySelector('#entryDialog').open);
    const before=await snapshot(page);await page.evaluate(()=>{state.activeEntry=state.entries.find(e=>e.series_id).id;seriesScopeDialog.showModal();});await abortNextPut(page);
    await page.evaluate(()=>deleteRecurringScope('all'));const after=await snapshot(page);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.recurrenceSeries,before.recurrenceSeries);assert.equal(after.recurrenceDirty,before.recurrenceDirty);assert.deepEqual(after.syncQueue,before.syncQueue);assert.match(after.toast,/não salva/i);assert.equal(await page.evaluate(()=>seriesScopeDialog.open),true);
  },
  async 'edit-abort-retry'(page){
    await page.evaluate(id=>{state.activeEntry=id;editEntry();valueInput.value='75';},id);
    const before=await snapshot(page);await abortNextPut(page);await page.locator('#saveEntry').click();await settled(page);
    const failed=await snapshot(page);assert.deepEqual(failed.entries,before.entries);assert.deepEqual(failed.syncQueue,before.syncQueue);assert.equal(failed.editingId,id);assert.equal(await page.locator('#value').inputValue(),'75');
    await page.locator('#saveEntry').click();await page.waitForFunction(()=>!document.querySelector('#entryDialog').open);
    const after=await snapshot(page);assert.equal(after.disk.entries.length,1);assert.equal(after.disk.entries[0].id,id);assert.equal(after.disk.entries[0].value,75);
  },
  async 'bulk-edit-abort'(page){
    await page.locator('.app-navigation [data-app-destination="records"]').click();await page.locator('#startSelection').click();await page.locator(`[data-entry="${id}"]`).click();
    await page.locator('#editSelection').click();await page.locator('#bulkEditDialog[open]').waitFor();
    await page.locator('#bulkStatus').selectOption('paid');await page.locator('#bulkDate').fill('2026-11-20');
    const before=await snapshot(page);await abortNextPut(page);await page.locator('#reviewBulkEdit').click();await page.locator('#confirmDialog[open] [data-confirm-accept]').click();await page.waitForFunction(()=>/não salva/i.test(document.querySelector('#toast').textContent));
    const after=await snapshot(page);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.syncQueue,before.syncQueue);assert.match(after.toast,/não salva/i);
    assert.equal(await page.evaluate(()=>document.querySelector('#bulkEditDialog').open),true,'the dialog stays open with the choices');assert.equal(await page.locator('#bulkStatus').inputValue(),'paid');
    assert.equal(await page.evaluate(id=>state.selectedEntries.has(id),id),true,'selection survives a failed save');
  },
  async 'recovery-conversion-keeps-local-only'(page){
    await page.evaluate(async id=>{const entry=state.entries[0];entry.import_local_only=true;queueUpsert(entry);await saveLocal();state.activeEntry=id;editEntry();recurrence.value='installments';installments.value='3';updateEntryFormVisibility();},id);
    await page.locator('#saveEntry').click();await page.waitForFunction(()=>!document.querySelector('#entryDialog').open);
    const after=await snapshot(page);assert.equal(after.disk.entries.length,3);assert.ok(after.disk.entries.every(entry=>entry.import_local_only===true),'replacement installments must retain recovery policy');assert.equal(await page.evaluate(()=>hasLocalOnlyRecovery()),true);assert.match(after.toast,/Drive pausado/i);
  },
  async 'concurrent-refresh-is-held-during-local-commit'(page){
    await page.evaluate(()=>{
      window.__remoteReads=0;window.__commitStarted=false;window.__saveAttempts=0;
      const originalSave=MGLocalStore.save;
      window.__commitGate=new Promise(resolve=>{window.__releaseCommit=resolve;});
      MGLocalStore.save=async(...args)=>{window.__saveAttempts++;window.__commitStarted=true;await window.__commitGate;return originalSave(...args);};
      window.__mutationWork=financialMutation(()=>{state.entries[0].value=333;queueUpsert(state.entries[0]);});
    });
    await page.waitForFunction(()=>window.__commitStarted);
    await page.evaluate(()=>{
      googleAuth.hasAccessToken=()=>true;
      repository.fetchEntries=async()=>{window.__remoteReads++;return[];};
      window.__refreshWork=retrySynchronization();
    });
    await page.waitForTimeout(100);
    const reads=await page.evaluate(()=>window.__remoteReads);
    const saveAttempts=await page.evaluate(()=>window.__saveAttempts);
    await page.evaluate(()=>window.__releaseCommit());
    await page.evaluate(()=>Promise.all([window.__mutationWork,window.__refreshWork]));
    assert.equal(reads,0,'cloud refresh must wait until the local transaction settles');
    assert.equal(saveAttempts,1,'background refresh must not persist an in-flight mutation snapshot');
    assert.equal((await snapshot(page)).disk.entries[0]?.value,333);
  },
  async 'overlapping-bulk-abort-and-single-status'(page){
    await page.evaluate(async()=>{state.entries.push({...state.entries[0],id:'overlap-B'});await saveLocal();});
    await page.evaluate(id=>{
      enterSelectionMode(id);
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){
        const request=put.apply(this,args);IDBObjectStore.prototype.put=put;
        window.__overlappingStatus=persistEntryStatus('overlap-B',true);
        this.transaction.abort();return request;
      };
    },id);
    await page.evaluate(()=>bulkEditDialog.commit(new Set(state.selectedEntries),{paid:true}));
    await page.evaluate(()=>window.__overlappingStatus);
    const after=await snapshot(page);
    assert.equal(after.entries.find(e=>e.id===id).paid,false);
    assert.equal(after.disk.entries.find(e=>e.id===id).paid,false,'aborted bulk change must not hitchhike on another status save');
    assert.deepEqual(after.disk.entries,after.entries,'memory and persisted financial state must agree after overlapping writes');
    assert.deepEqual(after.disk.syncQueue,after.syncQueue);
    assert.match(after.toast,/não salva/i);
  },
  async 'bulk-status-abort'(page){
    await page.evaluate(id=>enterSelectionMode(id),id);const before=await snapshot(page);await abortNextPut(page);await page.evaluate(()=>bulkEditDialog.commit(new Set(state.selectedEntries),{paid:true}));await page.waitForTimeout(150);
    const after=await snapshot(page);assert.deepEqual(after.entries,before.entries,'bulk status must roll back');assert.deepEqual(after.syncQueue,before.syncQueue);assert.match(after.toast,/não salva/i);assert.equal(await page.evaluate(id=>state.selectedEntries.has(id),id),true);
  },
};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});let failures=0;
 try{for(const [name,run] of Object.entries(cases)){
  if(process.env.CASE&&!name.includes(process.env.CASE))continue;
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'America/Sao_Paulo',viewport:{width:1280,height:900}});const errors=[],remote=[];
  await context.addInitScript(()=>{const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-11-11T15:00:00Z']));}static now(){return new OriginalDate('2026-11-11T15:00:00Z').getTime();}};});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();remote.push(route.request().url());return route.fulfill({contentType:'application/javascript',body:'/*blocked*/'});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin+'/seed');await page.addScriptTag({url:origin+'/js/local-store.js'});
   await page.evaluate(async({user,id})=>{localStorage.setItem('meus-gastos-google-user',JSON.stringify(user));await MGLocalStore.save(user.id,{entries:[{id,date:'2026-11-10',value:200,type:'OUTROS',description:'OUTROS',paid:false,flow_type:'expense',detail:'synthetic',updated_at:'2026-11-01T12:00:00Z'}],settings:{onboarding_status:'completed',current_balance:1000,balance_reference_date:'2026-11-01'},syncQueue:[]});},{user,id});
   await page.goto(origin);await page.waitForFunction(()=>typeof state!=='undefined'&&state.entries.length===1&&document.body.getAttribute('aria-busy')==='false');
   await run(page,{context,origin});assert.deepEqual(errors,[],'no unhandled mutation failures');assert.ok(remote.every(url=>url==='https://accounts.google.com/gsi/client'),'no remote data traffic');console.log('PASS',name);
  }catch(error){failures++;console.error('FAIL',name,error);}finally{await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 assert.equal(failures,0,`${failures} mutation regressions failed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
