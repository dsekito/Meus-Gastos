/* Isolated Edge layout contract. Run local server :8000, then node test/professional-redesign.e2e.cjs [--baseline]. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = process.argv.includes('--baseline');
const out = path.join('outputs','professional-redesign',baseline?'before':'after');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const results=[], errors=[];
 try {
  const context=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.fulfill({status:200,body:''}));
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.REDESIGN_URL||'http://localhost:8000');
  await page.evaluate(async()=>{
   const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
   const id='professional-redesign-synthetic-only';
   localStorage.setItem('meus-gastos-google-user',JSON.stringify({id,email:'redesign@example.invalid',user_metadata:{full_name:'Teste visual fictício'}}));
   await MGLocalStore.save(id,{settings:{onboarding_status:'completed',current_balance:12345.67,balance_reference_date:date},entries:[{id:'00000000-0000-4000-8000-000000009801',date,type:'ALIMENTAÇÃO',description:'SUPERMERCADO',detail:'Movimento sintético de avaliação',flow_type:'expense',value:186.5,paid:false,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`},{id:'00000000-0000-4000-8000-000000009802',date,type:'A RECEBER',description:'ENTRADA FICTÍCIA',flow_type:'income',value:1500,paid:false,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`}]});
  });
  await page.reload();await page.waitForSelector('#appShell:not([hidden])');
  const nav=v=>page.locator(`.app-navigation [data-app-destination="${v}"]`);
  async function capture(name,root='#appShell'){
   await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
   const r=await page.locator(root).evaluate(root=>{
    const visible=e=>e.checkVisibility(); const box=e=>e.getBoundingClientRect();
    const controls=[...root.querySelectorAll('button,input:not([type=checkbox]),select,summary')].filter(visible);
    const small=controls.filter(e=>box(e).width<47.9||box(e).height<47.9).map(e=>e.id||e.textContent.trim());
    const clipped=[...root.querySelectorAll('.amount,.card-note,.entry-title-text,.entry-detail,button')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+1&&['clip','hidden'].includes(getComputedStyle(e).overflowX)).map(e=>e.id||e.className);
    const cards=[...document.querySelectorAll('.decision-cards > article')].map(e=>({top:box(e).top,left:box(e).left,height:box(e).height}));
    const action=document.querySelector('#openModalMobile');
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,small,clipped,cards,actionPosition:getComputedStyle(action).position,overviewHeight:box(document.querySelector('.decision-cards')).height,navIcons:document.querySelectorAll('.app-navigation button svg').length};
   }); results.push({name,...r});return r;
  }
  await page.setViewportSize({width:375,height:812});await nav('home').click();
  assert.ok(await page.locator('.top .brand h1').evaluate(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1),'Brand should not wrap at normal mobile size');
  await page.setViewportSize({width:320,height:812});
  assert.ok(await page.locator('.app-navigation').evaluate(nav=>[...nav.querySelectorAll('button span')].every(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1)),'Navigation labels should not break mid-word at normal 320px size');
  for(const width of [320,375,1280]){
   await page.setViewportSize({width,height:width===1280?900:812});
   for(const v of ['home','records','projection','monthly','settings']){await nav(v).click();await capture(`${v}-${width}`);}
   await nav('home').click();await page.locator('#openModalMobile').click();await capture(`entry-${width}`,'#entryDialog');await page.locator('#entryDialog [data-close]').first().click();
  }
  await page.setViewportSize({width:320,height:812});await nav('home').click();
  assert.equal(await page.locator('.top .brand h1').isVisible(),true,'Brand name remains visible at 320px');
  assert.ok((await page.locator('#filterMonth').boundingBox()).width>=240,'Native month text has enough width at 320px');
  await page.setViewportSize({width:375,height:400});await nav('home').click();await page.locator('#openModalMobile').click();
  await page.locator('#value').focus();await page.keyboard.type('123');assert.equal(await page.locator('#value').inputValue(),'123');
  await capture('entry-keyboard-short-viewport','#entryDialog');await page.locator('#entryDialog [data-close]').first().click();
  await page.setViewportSize({width:640,height:450});await nav('home').click();await capture('home-200percent-reflow');
  await page.setViewportSize({width:320,height:812});
  await page.evaluate(()=>{const all=[...document.querySelectorAll('body *')].map(e=>[e,getComputedStyle(e).fontSize]);for(const [e,size]of all)e.style.setProperty('font-size',parseFloat(size)*2+'px','important');});
  await capture('home-text-200percent');
  await page.reload();await page.waitForSelector('#appShell:not([hidden])');
  await page.setViewportSize({width:375,height:812});await nav('home').click();
  await page.evaluate(()=>{const n=document.querySelector('#syncNotice');n.hidden=false;n.dataset.state='syncing';document.querySelector('#syncNoticeTitle').textContent='Sincronizando';document.querySelector('#syncNoticeAction').textContent='Cancelar';});
  await page.screenshot({path:path.join(out,'syncing-375.png')});
  const disclosure=page.locator('#syncDetails');
  assert.equal(await disclosure.count(),1,'Sync explanation must be an optional disclosure, never its action');
  assert.equal(await page.locator('#syncNoticeAction').isVisible(),true,'Cancel remains visible with collapsed details');
  assert.equal(await page.locator('#syncNoticeDetail').isVisible(),false,'Routine explanation starts collapsed');
  await disclosure.locator('summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#syncNoticeDetail').isVisible(),true,'Details open with keyboard');
  await page.evaluate(()=>{document.querySelector('#syncNotice').dataset.state='conflict';document.querySelector('#syncNoticeTitle').textContent='Conflito: revise antes de sincronizar';});
  await page.screenshot({path:path.join(out,'sync-conflict-375.png')});
  assert.equal(await page.locator('#syncNoticeTitle').isVisible(),true);assert.equal(await page.locator('#syncNoticeAction').isVisible(),true);
  fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({results,errors},null,2));
  const violations=[];
  for(const r of results){if(r.overflow||r.small.length||r.clipped.length)violations.push({name:r.name,overflow:r.overflow,small:r.small,clipped:r.clipped});
   if(/^home-(320|375|1280)$/.test(r.name)){
    if(['fixed','absolute'].includes(r.actionPosition))violations.push({name:r.name,reason:'New entry must be in document flow',actual:r.actionPosition});
    if(Math.abs(r.cards[1].top-r.cards[2].top)>1)violations.push({name:r.name,reason:'Minimum and end-month forecasts must be grouped side by side'});
    if(r.overviewHeight>470)violations.push({name:r.name,reason:'Dashboard overview must be compact',height:r.overviewHeight});
    if(r.navIcons!==5)violations.push({name:r.name,reason:'Five destinations need scan-friendly icons',icons:r.navIcons});
   }
  }
  fs.writeFileSync(path.join(out,'violations.json'),JSON.stringify(violations,null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(violations,[],'Monitor composition, in-flow action, accessible responsive geometry');
  console.log(`PASS ${results.length} Edge scenarios. Artifacts: ${out}`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
