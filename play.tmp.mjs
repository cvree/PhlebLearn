import { chromium } from '@playwright/test';
const OUT='/tmp/claude-0/-home-user-PhlebLearn/a2148914-3044-5e44-8afb-b8d2cecff1cc/scratchpad';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport:{width:900,height:1000} });
pg.on('console', m=>{ if(m.type()==='error') console.log('ERR:', m.text().slice(0,200)); });
await pg.goto('http://localhost:4173/PhlebLearn/');
await pg.waitForTimeout(4000);
await pg.screenshot({path:OUT+'/01-load.png'});
const dump = async (tag)=>{
  const t = await pg.evaluate(()=>({ panel: document.getElementById('panel')?.innerText, state: window.__state }));
  console.log('=== '+tag+' ===\n'+(t.panel||'(none)').slice(0,2500));
};
await dump('after-load');
await b.close();
