import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out=process.argv[2]||'/tmp/RGS_v411_modland.zip';
fs.mkdirSync(path.dirname(out),{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({
  acceptDownloads:true,
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  locale:'en-US'
});
const page=await ctx.newPage();
page.setDefaultTimeout(120000);
const interesting=new Set();
page.on('request',r=>{const u=r.url();if(/download|\.zip|file/i.test(u))interesting.add('REQ '+u)});
page.on('response',r=>{const u=r.url(),d=r.headers()['content-disposition']||'';if(/download|\.zip|file/i.test(u)||/attachment/i.test(d))interesting.add(`RES ${r.status()} ${u} ${d}`)});
console.log('Opening authorized RGS download page…');
await page.goto('https://www.modland.net/download/300941',{waitUntil:'networkidle',timeout:120000}).catch(async()=>page.goto('https://www.modland.net/download/300941',{waitUntil:'domcontentloaded',timeout:120000}));
console.log('TITLE:',await page.title());

let download=null;
for(let attempt=0;attempt<15&&!download;attempt++){
  await page.waitForTimeout(attempt===0?9000:3000);
  const controls=await page.locator('a,button,input[type=button],input[type=submit]').evaluateAll(es=>es.map((e,i)=>({i,tag:e.tagName,text:(e.textContent||e.value||'').trim().replace(/\s+/g,' '),href:e.href||'',vis:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})));
  const candidates=controls.filter(x=>x.vis && !/back to|discord|login|submit mod|categories/i.test(x.text) && (/RGS_v411/i.test(x.text+x.href)|direct download/i.test(x.text)|download/i.test(x.text)&&!/^download$/i.test(x.text)));
  console.log('Attempt',attempt+1,'candidate controls:',candidates.slice(0,20));
  for(const c of candidates){
    try{
      const loc=page.locator('a,button,input[type=button],input[type=submit]').nth(c.i);
      const dPromise=page.waitForEvent('download',{timeout:20000});
      await loc.click({force:true,timeout:10000});
      download=await dPromise;break;
    }catch{}
  }
  if(!download){
    const directHrefs=controls.map(x=>x.href).filter(Boolean).filter(h=>/\.zip(?:\?|$)|download-file|file\/download|cdn/i.test(h));
    for(const href of directHrefs){
      try{
        console.log('Trying href',href);
        const dPromise=page.waitForEvent('download',{timeout:20000});
        await page.goto(href,{timeout:30000});
        download=await dPromise;break;
      }catch{}
    }
  }
}
if(!download){
  console.log('Interesting network traffic:');for(const x of interesting)console.log(x);
  console.log('BODY:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000));
  const all=await page.locator('a,button,input[type=button],input[type=submit],script').evaluateAll(es=>es.slice(0,250).map(e=>({tag:e.tagName,text:(e.textContent||e.value||'').trim().replace(/\s+/g,' ').slice(0,300),href:e.href||e.src||'',type:e.type||''})));
  console.log('CONTROLS/SCRIPTS:',JSON.stringify(all,null,2));
  await browser.close();
  throw new Error('Could not trigger RGS direct download from ModLand.');
}
await download.saveAs(out);
console.log('Saved',out,fs.statSync(out).size,'bytes','suggested',download.suggestedFilename());
await browser.close();
