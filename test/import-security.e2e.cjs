// Actual app/file chooser/IndexedDB; ephemeral Edge context; no real Google/user data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.RESERVED_CATEGORY_EVIDENCE
  ? path.join(root, 'outputs/audit-fixes/reserved-categories')
  : path.join(root, 'outputs/audit-fixes/import');
const user = { id: 'synthetic-import-security', email: 'import-security@example.invalid' };
const auth = `window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>false,getAccessToken:()=>null,isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{},signIn:async()=>{throw Error('REAL_GOOGLE_FORBIDDEN')}})};`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/seed') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Synthetic seed</title>'); }
  if (pathname === '/js/google-auth.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(auth); }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});
const record = (extra = {}) => ({ id:'legacy-1', date:'2026-11-11', value:25, type:'CASA', description:'Conta', paid:false, ...extra });
const cases = [
  ...['constructor', '__proto__', 'toString', 'hasOwnProperty', 'CASA'].map(category => ({
    name:`reserved-category-${category}`, input:[record({type:category})], editCategory:category,
  })),
  { name:'quote-id-rejected-before-confirmation', input:[record({id:'audit" data-audit-injected="yes'})], invalid:true },
  { name:'missing-classification-rejected', input:[{id:'minimal-1',date:'2026-11-11',value:1},{id:'minimal-2',date:'2026-11-11',value:2}], invalid:true },
  { name:'legacy-array-migrates-paid-and-renders', input:[{id:'legacy',date:'2026-11-11',value:25,type:'CASA',description:'Conta'},{id:'legacy-2',date:'2026-11-11',value:50,type:'CASA',description:'Outra'}] },
  { name:'existing-unsafe-id-stays-data-in-all-renderers', seedOnly:true, seed:record({id:'audit" data-audit-injected="yes'}) },
];
async function snapshot(page) {
  return page.evaluate(async id => {
    const persisted=await MGLocalStore.load(id,{observe:false});
    // The UI intentionally preflights saveLocal before validation; savedAt is diagnostic only.
    delete persisted.savedAt;
    return {entries:structuredClone(state.entries),queue:structuredClone(state.syncQueue),persisted};
  }, user.id);
}
(async () => {
  fs.mkdirSync(artifacts,{recursive:true});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const results=[];
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const origin=`http://127.0.0.1:${server.address().port}`;
    for (const scenario of cases) {
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
      const external=[], errors=[], dialogs=[];
      await context.route('**/*', route => {
        if(new URL(route.request().url()).origin===origin) return route.continue();
        external.push(route.request().url());
        return route.fulfill({status:200,contentType:'application/javascript',body:'/* blocked synthetic external resource */'});
      });
      const page=await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror',e=>errors.push(e.message));
      page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()}); await dialog.accept();});
      const result={name:scenario.name,status:'FAIL'};
      try {
        await page.goto(origin+'/seed');
        await page.addScriptTag({url:origin+'/js/local-store.js'});
        await page.evaluate(async ({user,seed})=>{
          localStorage.setItem('meus-gastos-google-user',JSON.stringify(user));
          await MGLocalStore.save(user.id,{entries:seed?[seed]:[],recurrenceSeries:[],syncQueue:[],settings:{current_balance:0,balance_reference_date:'2026-11-11',onboarding_status:'completed'}});
        },{user,seed:scenario.seed});
        await page.goto(origin+'/');
        await page.waitForFunction(id=>typeof state!=='undefined' && state.user?.id===id && document.body.getAttribute('aria-busy')==='false',user.id);
        if(scenario.seedOnly) {
          await page.getByRole('button',{name:'Registros',exact:true}).click();
          assert.equal(await page.locator('.dense-entry').getAttribute('data-entry'),scenario.seed.id);
          assert.equal(await page.locator('[data-audit-injected]').count(),0,'existing IDs must not create attributes in record/status/menu markup');
          await page.locator('#entryActions > summary').click();
          await page.locator('#openRecentRecordsMain').click();
          assert.equal(await page.locator('[data-edit-recent]').getAttribute('data-edit-recent'),scenario.seed.id);
          assert.equal(await page.locator('[data-audit-injected]').count(),0,'history renderer must escape existing IDs');
          await page.keyboard.press('Escape');
          if(!await page.locator('#openRecordsManagerMain').isVisible())await page.locator('#entryActions > summary').click();
          await page.locator('#openRecordsManagerMain').click();
          assert.equal(await page.locator('[data-manager-select]').getAttribute('data-manager-select'),scenario.seed.id);
          assert.equal(await page.locator('[data-audit-injected]').count(),0,'manager renderers must escape existing IDs');
        } else {
        await page.locator('[data-app-destination="settings"]').click();
        await page.locator('[data-settings-topic="data"]').click();
        await page.evaluate(()=>saveLocal());
        const before=await snapshot(page);
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importLocalBackup').click()]);
        await chooser.setFiles({name:'synthetic-import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scenario.input))});
        if(!scenario.invalid){const confirmation=page.locator('#confirmDialog[open]');await confirmation.waitFor({state:'visible'});dialogs.push({type:'confirm',message:await confirmation.innerText()});await confirmation.locator('[data-confirm-accept]').click();}
        await page.waitForFunction(()=>!recoveryBusy && !document.querySelector('#importLocalBackup').disabled && !!document.querySelector('#toast').textContent);
        const after=await snapshot(page);
        result.dialogs=dialogs;
        result.toast=await page.locator('#toast').innerText();
        if(scenario.invalid){
          assert.equal(dialogs.length,0,'invalid import must fail before preview confirmation');
          assert.match(result.toast,/inválido/i);
          assert.deepEqual(after,before,'invalid import must not change financial memory or exact IndexedDB snapshot');
          assert.equal(await page.locator('[data-audit-injected]').count(),0);
        } else {
          assert.equal(dialogs.length,1);
          assert.equal(after.entries.length,scenario.input.entries?.length || scenario.input.length);
          assert.deepEqual(after.persisted.entries,after.entries);
          for(const entry of after.entries){assert.equal(entry.paid,false);assert.equal(entry.import_local_only,true);}
          const saved=after.entries;
          await page.reload();
          await page.waitForFunction(()=>typeof state!=='undefined' && state.entries.length>0 && document.body.getAttribute('aria-busy')==='false');
          assert.deepEqual((await snapshot(page)).entries,saved);
          await page.getByRole('button',{name:'Registros',exact:true}).click();
          assert.equal(await page.locator('.dense-entry').count(),saved.length,'same-date legacy records sort/render under pending filter');
          if (scenario.editCategory) {
            await page.locator('.dense-entry').click();
            await page.waitForTimeout(50);
            assert.equal(await page.evaluate(()=>dialog.open),true,'accepted category remains editable after import/reload');
            assert.equal(await page.evaluate(()=>type.value),scenario.editCategory,'category spelling is preserved');
            assert.equal(await page.evaluate(()=>desc.value),'Conta');
            // Exercise lookup consumers used by option creation and removal too.
            await page.evaluate(()=>closeEntryDialog());
            await page.evaluate(async category=>{
              // Removal asks through the in-app dialog; accept each confirmation.
              const confirmation=document.querySelector('#confirmDialog');
              new MutationObserver(()=>{if(confirmation.open)confirmation.querySelector('[data-confirm-accept]').click();})
                .observe(confirmation,{attributes:true,attributeFilter:['open']});
              if (!state.types.includes(category)) state.types.push(category);
              renderOptionManagement({descriptionType:category,selectedDescription:'Conta'});
              await removeDescriptionOption();
              const creating=addOption('descriptions',category);
              optionName.value='REGRESSION CUSTOM';
              optionForm.requestSubmit();
              await creating;
              deleteDescriptionType.innerHTML='';
              deleteDescriptionType.add(new Option(category,category));
              deleteDescriptionType.value=category;
              if (!state.types.includes(category)) state.types.push(category);
              renderOptionManagement({descriptionType:category,selectedDescription:'REGRESSION CUSTOM'});
              if(deleteDescriptionType.value!==category || deleteDescriptionOption.value!=='REGRESSION CUSTOM')throw Error('option management selection missing: '+JSON.stringify({type:deleteDescriptionType.value,desc:deleteDescriptionOption.value}));
              await removeDescriptionOption();
              if(!Object.hasOwn(state.customDescriptionOptionsByType,category))throw Error('custom category must be an own property');
              if(!Object.hasOwn(state.hiddenDescriptionsByType,category))throw Error('hidden category must be an own property');
              if(state.customDescriptionOptionsByType[category].includes('REGRESSION CUSTOM'))throw Error('custom option was not removed');
              if(!state.hiddenDescriptionsByType[category].includes('REGRESSION CUSTOM'))throw Error('removed option was not hidden');
            },scenario.editCategory);
            await page.locator('.dense-entry').click();
            assert.equal(await page.evaluate(()=>dialog.open),true);
            assert.equal(await page.evaluate(()=>type.value),scenario.editCategory);
            assert.equal(await page.evaluate(()=>desc.value),'Conta','selected hidden description survives editing');
            await page.evaluate(()=>form.requestSubmit());
            await page.waitForFunction(()=>!dialog.open);
            result.category=await page.evaluate(()=>state.entries[0].type);
            assert.equal(result.category,scenario.editCategory,'saving must not normalize accepted category names');
            assert.deepEqual((await snapshot(page)).persisted.entries,(await snapshot(page)).entries);
          }
        }
        }
        assert.deepEqual(errors,[],'no uncaught rendering errors');
        result.status='PASS';
      } catch(error){result.error=error.stack;process.exitCode=1;await page.screenshot({path:path.join(artifacts,`${scenario.name}.png`),fullPage:true}).catch(()=>{});}
      finally{result.browserErrors=errors;result.blockedExternal=external;results.push(result);console.log(`${result.status} ${result.name}${result.error?'\n'+result.error:''}`);await context.close();}
    }
    fs.writeFileSync(path.join(artifacts,`browser-${process.env.EVIDENCE_PHASE || 'latest'}.json`),JSON.stringify({browser:'ephemeral Playwright Edge',externalNetworking:'all third parties fulfilled locally; no external requests leave context',results},null,2));
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
