// Isolated synthetic profile; no external requests or real data.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(process.env.TMPDIR || process.env.TEMP, 'meusgastos-composition', process.env.PHASE || 'after');
fs.mkdirSync(out, {recursive:true});
const server = http.createServer((req,res) => {
  const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file,(err,data)=> { if(err) return res.writeHead(404).end(); res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream'); res.end(data); });
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true}); const observations=[], failures=[], errors=[];
 try {
  for(const width of [320,375]) {
   const context=await browser.newContext({viewport:{width,height:812},serviceWorkers:'block'});
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin); await page.evaluate(async()=>{const d=new Date(), date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; const id='composition-synthetic'; localStorage.setItem('meus-gastos-google-user',JSON.stringify({id,email:'visual@example.invalid'})); await MGLocalStore.save(id,{settings:{onboarding_status:'completed',current_balance:12345.67,balance_reference_date:date},entries:[{id:'synthetic-1',date,type:'ALIMENTAÇÃO',description:'SUPERMERCADO',detail:'Compra fictícia da semana',flow_type:'expense',value:186.50,paid:false,created_at:date+'T12:00:00Z'},{id:'synthetic-2',date,type:'A RECEBER',description:'ENTRADA FICTÍCIA',flow_type:'income',value:1500,paid:false,created_at:date+'T12:00:00Z'}],syncQueue:[],recurrenceSeries:[]});});
   await page.reload(); await page.waitForSelector('#appShell:not([hidden])');
   const before=await page.evaluate(()=>JSON.stringify([state.entries,state.settings,state.syncQueue]));
   async function capture(name) {
    await page.screenshot({path:path.join(out,`${name}-${width}.png`)});
    const m=await page.evaluate(()=>{const visible=e=>e&&e.checkVisibility(); const box=e=>{if(!visible(e))return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};const text=e=>visible(e)?parseFloat(getComputedStyle(e).fontSize):null; const nav=document.querySelector('.app-navigation');const action=document.querySelector('#openModalMobile'); const controls=[...document.querySelectorAll('#appShell button,#appShell summary,#appShell input:not([type=checkbox]),#appShell select')].filter(visible); return {heading:text(document.querySelector('.view-heading h2')),balance:text(document.querySelector('.balance-card .amount')),overview:box(document.querySelector('.decision-overview')),firstUpcoming:box(document.querySelector('.upcoming-item')),firstEntry:box(document.querySelector('#rows .dense-entry')),sync:box(document.querySelector('.sync-notice')),action:box(action),actionPosition:getComputedStyle(action).position,nav:box(nav),overflow:document.documentElement.scrollWidth>innerWidth+1,small:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<47.9||r.height<47.9}).map(e=>e.id||e.textContent.trim().slice(0,35))};});
    observations.push({name,width,...m}); return m;
   }
   async function checkComposition(scale) {
   const issues=await page.evaluate(()=>{
    const issues=[]; const rect=e=>e.getBoundingClientRect();
    const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
    const brand=document.querySelector('.top .brand h1'), nav=[...document.querySelectorAll('.app-navigation button')];
    const textRect=e=>{const range=document.createRange();range.selectNodeContents(e);return range.getBoundingClientRect()};
    const title=textRect(brand), top=rect(document.querySelector('.top'));
    if(title.left<top.left-1||title.right>top.right+1) issues.push('brand outside header');
    for(const other of document.querySelectorAll('.top button')) if(other.checkVisibility()&&overlap(title,rect(other))) issues.push('brand overlaps header button');
    for(const button of nav) {
     const span=button.querySelector('span'), r=textRect(span), b=rect(button);
     if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1) issues.push(`nav label outside button: ${span.textContent}`);
     for(const other of nav) if(other!==button&&overlap(r,rect(other.querySelector('span')))) issues.push(`nav labels overlap: ${span.textContent}`);
     if(b.width<47.9||b.height<47.9) issues.push('small navigation target');
    }
    const input=document.querySelector('#filterMonth'), ir=rect(input), style=getComputedStyle(input);
    // Native month fields hide internal clipping from scrollWidth. Reserve space for
    // the longest localized month, year, native picker icon and input padding.
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'); ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const required=ctx.measureText('September 8888').width+48+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
    if(ir.width+1<required) issues.push(`month input too narrow: ${ir.width} < ${required}`);
    for(const id of ['filterMonth','previousMonth','nextMonth','goToCurrentMonth']) {const e=document.getElementById(id), r=rect(e);if(!e.checkVisibility()||r.width<47.9||r.height<47.9) issues.push(`missing/small period control: ${id}`);}
    return issues;
   });
   failures.push(...issues.map(issue=>`${width}px text ${scale}%: ${issue}`));
  }
  await checkComposition(100);
  const home=await capture('home');
   if(home.heading>22) failures.push(`home ${width}: heading ${home.heading}px > 22px`);
   // Keep the 16px labels/14px notes readable: at 320px they wrap more.
   const overviewLimit = width === 320 ? 340 : 300;
   if(home.overview.height>overviewLimit) failures.push(`home ${width}: overview ${home.overview.height}px > ${overviewLimit}px`);
   if(home.balance<26||home.balance>30) failures.push(`home ${width}: balance out of range`);
   await page.locator('.app-navigation [data-app-destination="records"]').click(); await page.evaluate(()=>scrollTo(0,0));
   const records=await capture('records');
   if(records.heading>22) failures.push(`records ${width}: heading ${records.heading}px > 22px`);
   for(const m of [home,records]) {if(m.overflow) failures.push(`${width}: overflow`); if(m.small.length) failures.push(`${width}: small controls ${m.small}`); if(['fixed','absolute'].includes(m.actionPosition)) failures.push(`${width}: floating action`);}
   await page.evaluate(()=>scrollTo(0,300)); await capture('records-scroll');
   await page.evaluate(()=>{setSyncStatus('syncing','Sincronizando alterações...');scrollTo(0,0)}); await capture('sync-loading');
   await page.evaluate(()=>setSyncStatus('conflict','Conflito de sincronização')); await capture('sync-conflict');
   await page.evaluate(()=>setSyncStatus('idle','Modo local'));
   await page.locator('.app-navigation [data-app-destination="home"]').click();
   await page.evaluate(()=>{const entries=[...document.querySelectorAll('body *')].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,s] of entries)e.style.setProperty('font-size',`${s*2}px`,'important')});
   await checkComposition(200);
  const large=await capture('home-text-200'); if(large.overflow) failures.push(`home ${width}: text zoom overflow`);
  for(const destination of ['monthly','settings','projection','records','home']) {
   await page.locator(`.app-navigation [data-app-destination="${destination}"]`).click();
   assert.equal(await page.locator('#appShell').getAttribute('data-view'),destination);
  }
  const monthScroll=page.locator('.month-input-scroll');
  await monthScroll.evaluate(e=>{e.scrollLeft=e.scrollWidth});
  const monthScrollState=await monthScroll.evaluate(e=>({needed:e.scrollWidth>e.clientWidth, left:e.scrollLeft}));
  if(monthScrollState.needed && !monthScrollState.left) failures.push(`${width}: month selector cannot scroll`);
  await page.locator('#nextMonth').click(); await page.locator('#previousMonth').click();
   await page.locator('.app-navigation [data-app-destination="records"]').click(); const largeRecords=await capture('records-text-200'); if(largeRecords.overflow) failures.push(`records ${width}: text zoom overflow`);
   const after=await page.evaluate(()=>JSON.stringify([state.entries,state.settings,state.syncQueue])); if(before!==after) failures.push(`${width}: financial state changed`);
   await context.close();
  }
  fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({observations,failures,errors},null,2));
  console.log(JSON.stringify({out,observations,failures,errors},null,2)); assert.deepEqual(errors,[]); assert.deepEqual(failures,[]);
 } finally {await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
