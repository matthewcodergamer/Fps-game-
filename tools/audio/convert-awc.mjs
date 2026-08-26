import fs from 'node:fs';
import path from 'node:path';

const inputRoot = process.argv[2];
const outputRoot = process.argv[3];
if (!inputRoot || !outputRoot) {
  console.error('Usage: node convert-awc.mjs <input-content-dir> <output-audio-dir>');
  process.exit(2);
}

const STEP=[7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
const IDX=[-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8];

const u16=(b,o)=>b.readUInt16LE(o);
const u32=(b,o)=>b.readUInt32LE(o);
const i32=(b,o)=>b.readInt32LE(o);
const magic=(b,o)=>b.toString('ascii',o,o+4);
const clean=s=>String(s).replace(/\.awc$/i,'').replace(/[^a-z0-9._-]+/gi,'_').replace(/^_+|_+$/g,'')||'bank';

function parseAWC(buffer,name){
  if(buffer.length<16||magic(buffer,0)!=='ADAT') throw new Error('Not an ADAT AWC');
  const version=u16(buffer,4),flags=u16(buffer,6),count=i32(buffer,8);
  if(count<0||count>50000) throw new Error('Invalid stream count');
  let p=16;
  if(flags&1)p+=count*2;
  const infos=[];
  for(let i=0;i<count;i++){
    if(p+4>buffer.length)throw new Error('Truncated stream table');
    const raw=u32(buffer,p);p+=4;
    infos.push({cc:(raw>>>29)&7,id:raw&0x1fffffff});
  }
  const sets=[];
  for(const inf of infos){
    const chunks=[];
    for(let j=0;j<inf.cc;j++){
      if(p+8>buffer.length)throw new Error('Truncated chunk table');
      const lo=u32(buffer,p),hi=u32(buffer,p+4);p+=8;
      chunks.push({type:(hi>>>24)&255,size:((hi&0xffffff)*16)+Math.floor(lo/0x10000000),offset:lo&0x0fffffff});
    }
    sets.push(chunks);
  }
  const streams=[];
  for(let i=0;i<infos.length;i++){
    const fmt=sets[i].find(x=>x.type===0xFA),data=sets[i].find(x=>x.type===0x55);
    if(!fmt||!data||fmt.offset+20>buffer.length||data.offset+data.size>buffer.length)continue;
    const samples=u32(buffer,fmt.offset),sampleRate=u16(buffer,fmt.offset+8),codec=buffer[fmt.offset+19];
    if(sampleRate<1000||sampleRate>384000)continue;
    streams.push({index:i,id:infos[i].id,samples,sampleRate,codec,dataOffset:data.offset,dataSize:data.size,buffer});
  }
  if(!streams.length)throw new Error('No playable streams');
  return {name,version,streams};
}

function nibble(n,p,i){
  const s=STEP[i];let d=s>>3;
  if(n&1)d+=s>>2;if(n&2)d+=s>>1;if(n&4)d+=s;if(n&8)d=-d;
  p=Math.max(-32768,Math.min(32767,p+d));
  i=Math.max(0,Math.min(88,i+IDX[n]));
  return [p,i];
}

function decodeIMA(raw,expected){
  const sizes=[256,512,128,1024,2048];let best=256,score=Infinity;
  for(const bs of sizes){
    const est=Math.ceil(raw.length/bs)*(1+Math.max(0,bs-4)*2);
    const s=expected?Math.abs(est-expected):Math.abs(raw.length%bs);
    if(s<score){score=s;best=bs;}
  }
  const out=[];
  for(let off=0;off<raw.length;off+=best){
    const end=Math.min(raw.length,off+best);if(end-off<4)break;
    let p=raw.readInt16LE(off),i=Math.min(88,raw[off+2]);out.push(p);
    for(let j=off+4;j<end;j++){
      let r=nibble(raw[j]&15,p,i);p=r[0];i=r[1];out.push(p);
      r=nibble((raw[j]>>4)&15,p,i);p=r[0];i=r[1];out.push(p);
    }
  }
  return expected&&out.length>expected?out.slice(0,expected):out;
}

function decodeStream(s){
  const raw=s.buffer.subarray(s.dataOffset,s.dataOffset+s.dataSize);
  if(s.codec===0){
    const n=Math.min(Math.floor(raw.length/2),s.samples||Infinity),out=new Int16Array(n);
    for(let i=0;i<n;i++)out[i]=raw.readInt16LE(i*2);
    return out;
  }
  if(s.codec===4)return Int16Array.from(decodeIMA(raw,s.samples));
  throw new Error(`Unsupported codec ${s.codec}`);
}

function wav(samples,rate){
  const b=Buffer.allocUnsafe(44+samples.length*2);
  b.write('RIFF',0);b.writeUInt32LE(36+samples.length*2,4);b.write('WAVE',8);b.write('fmt ',12);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++)b.writeInt16LE(samples[i],44+i*2);
  return b;
}

function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())out.push(...walk(p));else out.push(p);
  }
  return out;
}

fs.mkdirSync(outputRoot,{recursive:true});
const manifest={format:'project-strike-audio-v3',generated:new Date().toISOString(),layers:{weapons_player:{root:'./game-assets/audio/weapons_player/',banks:[]},dlc_weapons:{root:'./game-assets/audio/dlc_weapons/',banks:[]},resident:{root:'./game-assets/audio/resident/',banks:[]}}};
let converted=0,skipped=0;
for(const file of walk(inputRoot).filter(f=>f.toLowerCase().endsWith('.awc'))){
  const rel=path.relative(inputRoot,file).replaceAll('\\','/');
  const top=rel.split('/')[0].toLowerCase();
  const layer=top.includes('dlc')?'dlc_weapons':top.includes('resident')?'resident':top.includes('weapons')?'weapons_player':null;
  if(!layer){console.warn('Skipping unknown layer:',rel);skipped++;continue;}
  const bank=clean(path.basename(file));
  const outDir=path.join(outputRoot,layer,bank);fs.mkdirSync(outDir,{recursive:true});
  try{
    const parsed=parseAWC(fs.readFileSync(file),rel);
    const bm={id:bank,source:rel,version:parsed.version,files:[],streams:[]};
    for(const s of parsed.streams){
      try{
        const pcm=decodeStream(s);
        const id='0x'+s.id.toString(16).padStart(8,'0');
        const fn=`stream_${String(s.index+1).padStart(3,'0')}_${id}.wav`;
        fs.writeFileSync(path.join(outDir,fn),wav(pcm,s.sampleRate));
        bm.files.push(fn);bm.streams.push({id,index:s.index,file:`${layer}/${bank}/${fn}`,codec:s.codec===0?'pcm16':s.codec===4?'ima-adpcm':`codec-${s.codec}`,sampleRate:s.sampleRate,samples:pcm.length,duration:pcm.length/s.sampleRate});
        converted++;
      }catch(err){console.warn('Stream skipped',rel,s.index,err.message);skipped++;}
    }
    if(bm.files.length)manifest.layers[layer].banks.push(bm);
  }catch(err){console.warn('Bank skipped',rel,err.message);skipped++;}
}
for(const l of Object.values(manifest.layers))l.banks.sort((a,b)=>a.id.localeCompare(b.id));
fs.writeFileSync(path.join(outputRoot,'audio-manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Converted ${converted} WAV streams; skipped ${skipped}.`);
for(const [layer,data] of Object.entries(manifest.layers))console.log(layer,data.banks.length,'banks',data.banks.reduce((n,b)=>n+b.files.length,0),'WAVs');
