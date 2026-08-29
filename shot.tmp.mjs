import { chromium } from "@playwright/test";
const OUT="/tmp/claude-0/-home-user-PhlebLearn/7b014548-cf3e-501e-865c-fc59a3702355/scratchpad";
const browser = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium", args:["--enable-unsafe-swiftshader"] });
async function shot(name, vp, fn){
  const page = await browser.newPage({ viewport: vp });
  await page.goto("http://localhost:4176/PhlebLearn/");
  await page.waitForFunction(()=>window.__tinyVialsBooted===true,null,{timeout:25000});
  await page.waitForTimeout(1800);
  if(fn) await fn(page);
  await page.screenshot({ path:`${OUT}/${name}.png` });
  console.log("saved", name);
  await page.close();
}
await shot("01-firstrun-desktop", {width:1280,height:800});
await shot("02-firstrun-mobile", {width:390,height:844});
await shot("03-clockin-desktop", {width:1280,height:800}, async p=>{
  await p.locator("#helpClose").click(); await p.waitForTimeout(600);
});
await browser.close();
