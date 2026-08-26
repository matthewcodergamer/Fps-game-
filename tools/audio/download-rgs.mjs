import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out=process.argv[2]||'/tmp/RGS_v411_modland.zip';
fs.mkdirSync(path.dirname(out),{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({acceptDownloads:true,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',locale:'en-US'});
const page=await ctx.newPage();
page.setDefaultTimeout(120000);
let fileUrl='',download=null;
const interesting=new Set();
page.on('download',d=>{download=d;console.log('DOWNLOAD EVENT',d.suggestedFilename())});
page.on('request',r=>{const u=r.url();if(/download|\.zip|file|storage|cdn/i.test(u))interesting.add('REQ '+u)});
page.on('response',r=>{const u=r.url(),h=r.headers(),d=h['content-disposition']||'',ct=h['content-type']||'';if(/download|\.zip|file|storage|cdn/i.test(u)||/attachment/i.test(d)){interesting.add(`RES ${r.status()} ${u} ${d} ${ct}`);if(/attachment/i.test(d)||/application\/(zip|octet-stream)/i.test(ct)||/\.zip(?:\?|$)/i.test(u))fileUrl=u;}});

async function controls(){return page.locator('a,button,input[type=button],input[type=submit]').evaluateAll(es=>es.map((e,i)=>({i,tag:e.tagName,text:(e.textContent||e.value||'').trim().replace(/\s+/g,' '),href:e.href||'',vis:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})))}
async function saveIfDownloaded(){if(!download)return false;await download.saveAs(out);console.log('Saved browser download',out,fs.statSync(out).size,'bytes');return true}

console.log('Opening authorized RGS download page…');
await page.goto('https://www.modland.net/download/300941',{waitUntil:'domcontentloaded',timeout:120000});
console.log('TITLE:',await page.title());

// The package control is rendered after a short JS countdown. Wait up to 30 seconds.
let list=[],pkg=null;
for(let i=0;i<30&&!pkg;i++){
  await page.waitForTimeout(1000);
  list=await controls();
  pkg=list.find(x=>x.vis&&/RGS_v411_modland\.zip/i.test(x.text+x.href));
}
if(!pkg){console.log('BODY BEFORE FAILURE:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000));throw new Error('Package download control not found after countdown.');}
console.log('Stage 1 control:',pkg);
await page.locator('a,button,input[type=button],input[type=submit]').nth(pkg.i).click({force:true});
for(let i=0;i<20;i++){await page.waitForTimeout(500);if(await saveIfDownloaded()){await browser.close();process.exit(0)}}

console.log('After stage 1 URL:',page.url());
console.log('After stage 1 title:',await page.title());
// The first click may start another countdown / reveal a final anchor.
let last='';
for(let round=0;round<45&&!download;round++){
  await page.waitForTimeout(1000);
  list=await controls();
  const candidates=list.filter(x=>x.vis&&(/RGS_v411_modland\.zip/i.test(x.text+x.href)||/direct download/i.test(x.text)||/\.zip(?:\?|$)/i.test(x.href)||(/download/i.test(x.text)&&!/most downloaded/i.test(x.text))));
  const sig=JSON.stringify(candidates);
  if(sig!==last){console.log('Stage 2 candidates:',candidates);last=sig;}
  const direct=candidates.find(x=>x.href&&(/\.zip(?:\?|$)/i.test(x.href)||/download|cdn|storage|file/i.test(x.href)));
  if(direct){fileUrl=direct.href;break;}
  const button=candidates.find(x=>x.tag!=='A'||!x.href);
  if(button&&round%5===0){
    console.log('Clicking revealed control:',button.text);
    await page.locator('a,button,input[type=button],input[type=submit]').nth(button.i).click({force:true}).catch(()=>{});
  }
  if(fileUrl||download)break;
}
if(await saveIfDownloaded()){await browser.close();process.exit(0)}

if(!fileUrl){
  const hrefs=(await controls()).map(x=>x.href).filter(Boolean);
  fileUrl=hrefs.find(h=>/\.zip(?:\?|$)|download-file|file\/download|storage|cdn/i.test(h))||'';
}
if(fileUrl){
  console.log('Fetching captured file URL:',fileUrl);
  const res=await ctx.request.get(fileUrl,{timeout:240000,headers:{Referer:page.url()}});
  console.log('File response:',res.status(),res.headers()['content-type'],res.headers()['content-disposition']);
  if(res.ok()){
    const body=await res.body();
    if(body.length>1000000){fs.writeFileSync(out,body);console.log('Saved HTTP file',out,body.length,'bytes');await browser.close();process.exit(0)}
  }
}
console.log('Interesting network traffic:');for(const x of interesting)console.log(x);
console.log('BODY:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,16000));
console.log('CONTROLS:',JSON.stringify((await controls()).filter(x=>x.vis),null,2));
await browser.close();
throw new Error('Could not resolve the final RGS package URL.');
