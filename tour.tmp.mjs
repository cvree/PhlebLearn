import { chromium } from '@playwright/test';
const OUT='/tmp/claude-0/-home-user-PhlebLearn/a2148914-3044-5e44-8afb-b8d2cecff1cc/scratchpad';
const steps = process.argv.slice(2);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport:{width:1100,height:900} });
pg.on('pageerror', e=>console.log('PAGEERR:', e.message));
await pg.goto('http://localhost:4173/PhlebLearn/?e2e=1');
await pg.waitForFunction(()=>!!window.__phlebTest, null, {timeout:30000});
for(const s of steps){
  await pg.evaluate(id=>window.__phlebTest.gotoProcedureStep(id,["lightblue","lavender"],"learn"), s);
  await pg.waitForTimeout(2500);
  const txt = await pg.evaluate(()=>document.getElementById('panel')?.innerText||'');
  console.log('\n######## '+s+' ########\n'+txt);
  await pg.screenshot({path:`${OUT}/new-${s}.png`});
}
await b.close();
