import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out=process.argv[2]||'/tmp/RGS_v411_modland.zip';
fs.mkdirSync(path.dirname(out),{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({acceptDownloads:true});
page.setDefaultTimeout(120000);
console.log('Opening authorized RGS download page…');
await page.goto('https://www.modland.net/download/300941',{waitUntil:'domcontentloaded',timeout:120000});

let download=null;
for(let attempt=0;attempt<12&&!download;attempt++){
  await page.waitForTimeout(attempt===0?8000:3000);
  const anchors=await page.locator('a').evaluateAll(as=>as.map(a=>({text:(a.textContent||'').trim(),href:a.href,display:getComputedStyle(a).display,vis:!!(a.offsetWidth||a.offsetHeight||a.getClientRects().length)})));
  const candidates=anchors.filter(a=>a.vis && (/RGS_v411_modland\.zip/i.test(a.text)||/RGS_v411_modland\.zip/i.test(a.href)||/download/i.test(a.text)&&/\.zip/i.test(a.text)));
  console.log('Attempt',attempt+1,'download candidates',candidates.map(x=>({text:x.text,href:x.href})));
  for(const c of candidates){
    try{
      const dPromise=page.waitForEvent('download',{timeout:25000});
      await page.locator(`a[href="${c.href.replaceAll('"','\\"')}"]`).first().click({timeout:10000});
      download=await dPromise;break;
    }catch{}
  }
  if(!download){
    try{
      const textLoc=page.getByText(/RGS_v411_modland\.zip/i).last();
      if(await textLoc.count()){
        const dPromise=page.waitForEvent('download',{timeout:25000});
        await textLoc.click({timeout:10000});
        download=await dPromise;
      }
    }catch{}
  }
}
if(!download){
  await page.screenshot({path:'/tmp/modland-download-debug.png',fullPage:true}).catch(()=>{});
  await browser.close();
  throw new Error('Could not trigger RGS direct download from ModLand.');
}
await download.saveAs(out);
console.log('Saved',out,fs.statSync(out).size,'bytes');
await browser.close();
