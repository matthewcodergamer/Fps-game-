import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out=process.argv[2]||'/tmp/RGS_v411_modland.zip';
fs.mkdirSync(path.dirname(out),{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({acceptDownloads:true,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',locale:'en-US'});
const page=await ctx.newPage();
page.setDefaultTimeout(120000);
let fileUrl='';
const interesting=new Set();
page.on('request',r=>{const u=r.url();if(/download|\.zip|file|storage|cdn/i.test(u))interesting.add('REQ '+u)});
page.on('response',r=>{const u=r.url(),h=r.headers(),d=h['content-disposition']||'',ct=h['content-type']||'';if(/download|\.zip|file|storage|cdn/i.test(u)||/attachment/i.test(d)){interesting.add(`RES ${r.status()} ${u} ${d} ${ct}`);if(/attachment/i.test(d)||/application\/(zip|octet-stream)/i.test(ct)||/\.zip(?:\?|$)/i.test(u))fileUrl=u;}});
console.log('Opening authorized RGS download page…');
await page.goto('https://www.modland.net/download/300941',{waitUntil:'networkidle',timeout:120000}).catch(async()=>page.goto('https://www.modland.net/download/300941',{waitUntil:'domcontentloaded',timeout:120000}));
console.log('TITLE:',await page.title());

async function visibleControls(){return page.locator('a,button,input[type=button],input[type=submit]').evaluateAll(es=>es.map((e,i)=>({i,tag:e.tagName,text:(e.textContent||e.value||'').trim().replace(/\s+/g,' '),href:e.href||'',vis:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})))}
async function maybeSaveDownload(clicker){
  let dl=null;
  const listener=d=>{dl=d};
  page.once('download',listener);
  await clicker();
  for(let i=0;i<30&&!dl;i++)await page.waitForTimeout(500);
  if(dl){await dl.saveAs(out);return true;}
  return false;
}

// Stage 1: ModLand shows a button containing the package name. Clicking it reveals/starts the real download stage.
let controls=await visibleControls();
const packageControl=controls.find(x=>x.vis&&/RGS_v411_modland\.zip/i.test(x.text+x.href));
if(!packageControl)throw new Error('Package download control not found.');
console.log('Stage 1 control:',packageControl);
if(await maybeSaveDownload(()=>page.locator('a,button,input[type=button],input[type=submit]').nth(packageControl.i).click({force:true}))){console.log('Saved direct stage-1 download',fs.statSync(out).size);await browser.close();process.exit(0)}
await page.waitForTimeout(5000);
console.log('After stage 1 URL:',page.url());
console.log('After stage 1 title:',await page.title());
controls=await visibleControls();
console.log('Stage 2 controls:',controls.filter(x=>x.vis).slice(-35));

// Stage 2: prefer exact/direct download controls or newly revealed ZIP/CDN links.
const stage2=controls.filter(x=>x.vis&&(/direct download/i.test(x.text)||/RGS_v411_modland\.zip/i.test(x.text+x.href)||/\.zip(?:\?|$)/i.test(x.href)||/download/i.test(x.text)));
for(const c of stage2){
  console.log('Trying stage 2 control:',c);
  if(await maybeSaveDownload(()=>page.locator('a,button,input[type=button],input[type=submit]').nth(c.i).click({force:true}).catch(()=>{}))){console.log('Saved stage-2 download',fs.statSync(out).size);await browser.close();process.exit(0)}
  await page.waitForTimeout(2000);
  if(fileUrl)break;
}

// Some download hosts navigate/fetch instead of emitting a Playwright download event. Reuse the captured file URL with browser cookies.
if(!fileUrl){
  const hrefs=(await visibleControls()).map(x=>x.href).filter(Boolean);
  fileUrl=hrefs.find(h=>/\.zip(?:\?|$)|download-file|file\/download|storage|cdn/i.test(h))||'';
}
if(fileUrl){
  console.log('Fetching captured file URL:',fileUrl);
  const res=await ctx.request.get(fileUrl,{timeout:180000,headers:{Referer:page.url()}});
  console.log('File response:',res.status(),res.headers()['content-type'],res.headers()['content-disposition']);
  if(res.ok()){
    const body=await res.body();
    if(body.length>1000000){fs.writeFileSync(out,body);console.log('Saved',out,body.length,'bytes');await browser.close();process.exit(0)}
  }
}

console.log('Interesting network traffic:');for(const x of interesting)console.log(x);
console.log('BODY:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,16000));
console.log('CONTROLS:',JSON.stringify((await visibleControls()).filter(x=>x.vis),null,2));
await browser.close();
throw new Error('Could not resolve the final RGS package URL.');
