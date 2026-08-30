import { chromium } from '@playwright/test';
const OUT='/tmp/claude-0/-home-user-PhlebLearn/a2148914-3044-5e44-8afb-b8d2cecff1cc/scratchpad';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport:{width:1100,height:900} });
pg.on('pageerror', e=>console.log('PAGEERR:', e.message));
await pg.goto('http://localhost:4173/PhlebLearn/?e2e=1');
await pg.waitForFunction(()=>!!window.__phlebTest, null, {timeout:30000});
// pretend every step has been met before
await pg.evaluate(()=>{ const k=Object.keys(localStorage).find(x=>x.includes('phleb')); const s=JSON.parse(localStorage.getItem(k)); s.taught={introduce:1,gather:1,tourniquet:1,palpate:1,clean:1,assemble:1,uncap:1,insert:1,fill:1,switch:1,release:1,withdraw:1,safety:1,dispose:1,pressure:1,bandage:1,invert:1}; localStorage.setItem(k,JSON.stringify(s)); });
await pg.reload();
await pg.waitForFunction(()=>!!window.__phlebTest, null, {timeout:30000});
for(const s of ['insert','tourniquet']){
  await pg.evaluate(id=>window.__phlebTest.gotoProcedureStep(id,["lightblue","lavender"],"learn"), s);
  await pg.waitForTimeout(2500);
  console.log('\n######## '+s+' (already taught) ########\n'+await pg.evaluate(()=>document.getElementById('panel')?.innerText||''));
  await pg.screenshot({path:`${OUT}/taught-${s}.png`});
}
await b.close();
