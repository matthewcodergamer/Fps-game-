#!/usr/bin/env python3
from __future__ import annotations
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT=Path.cwd(); INBOX=ROOT/'assets-source'/'project-strike-inbox'; BATCHES=ROOT/'assets-source'/'project-strike-batches'; RUNTIME=ROOT/'public'/'game-assets'; REPORTS=RUNTIME/'manifests'/'conversion-reports'; BLENDER_SCRIPT=ROOT/'tools'/'blender'/'export_glb.py'; GITHUB_MAX=100*1024*1024; TARGET_MAX=95*1024*1024

def run(cmd,check=True):
    print('+',' '.join(map(str,cmd)),flush=True)
    return subprocess.run(cmd,check=check,text=True)

def safe_name(name,fallback='asset'):
    name=Path(str(name)).name; name=re.sub(r'[^A-Za-z0-9._-]+','_',name).strip('_'); return name or fallback

def valid_category(category):
    category=str(category or 'models/props')
    return category if re.fullmatch(r'(?:models|animations)/[A-Za-z0-9_./-]+',category) else 'models/props'

def copy_parts(parts,out,expected=0):
    if not parts: raise RuntimeError(f'No chunks available for {out}')
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('wb') as w:
        for part in parts:
            with part.open('rb') as r: shutil.copyfileobj(r,w,1024*1024)
    if expected and out.stat().st_size!=expected: raise RuntimeError(f'Reconstructed size mismatch for {out.name}: expected {expected}, got {out.stat().st_size}')

def reconstruct_package(manifest_path,manifest):
    root=manifest_path.parent; raw=root/'raw'; raw.mkdir(parents=True,exist_ok=True)
    source=raw/safe_name(manifest.get('sourceName') or 'source.glb','source.glb')
    copy_parts(sorted((root/'chunks').glob('part-*.bin')),source,int(manifest.get('originalBytes') or 0))
    for dep in manifest.get('dependencies') or []:
        wanted=safe_name(dep.get('path') or 'dependency.bin','dependency.bin')
        out=raw/'dependencies'/wanted
        staged=dep.get('staged')
        if staged:
            src=ROOT/str(staged)
            if not src.exists(): raise RuntimeError(f'Missing staged dependency: {src}')
            out.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,out)
            expected=int(dep.get('size') or 0)
            if expected and out.stat().st_size!=expected: raise RuntimeError(f'Dependency size mismatch for {wanted}: expected {expected}, got {out.stat().st_size}')
            continue
        chunk_root=dep.get('chunkRoot')
        if chunk_root:
            chunk_dir=ROOT/str(chunk_root); copy_parts(sorted(chunk_dir.glob('part-*.bin')),out,int(dep.get('size') or 0))
    return source

def optimize_glb(path):
    opt=path.with_suffix('.optimized.glb')
    r=run(['gltf-transform','optimize',str(path),str(opt),'--texture-compress','webp'],check=False)
    if r.returncode==0 and opt.exists() and opt.stat().st_size: opt.replace(path)
    else: opt.unlink(missing_ok=True); print('WARN: optimize failed; keeping current GLB',file=sys.stderr)
    if path.stat().st_size<TARGET_MAX: return
    for size in (1536,1024,768):
        resized=path.with_name(f'{path.stem}.resize-{size}.glb'); optimized=path.with_name(f'{path.stem}.resize-{size}.opt.glb')
        r1=run(['gltf-transform','resize',str(path),str(resized),'--width',str(size),'--height',str(size)],check=False)
        if r1.returncode==0:
            r2=run(['gltf-transform','optimize',str(resized),str(optimized),'--texture-compress','webp'],check=False)
            if r2.returncode==0 and optimized.exists() and optimized.stat().st_size: optimized.replace(path)
        resized.unlink(missing_ok=True); optimized.unlink(missing_ok=True)
        if path.stat().st_size<TARGET_MAX: return

def validate_glb(path,report,source_format=''):
    if not path.exists() or path.stat().st_size<1024: raise RuntimeError(f'Output GLB missing or too small: {path}')
    with path.open('rb') as f:
        if f.read(4)!=b'glTF': raise RuntimeError(f'Invalid GLB header: {path}')
    if path.stat().st_size>=GITHUB_MAX: raise RuntimeError(f'Runtime GLB still exceeds GitHub 100 MiB limit after optimization: {path.stat().st_size} bytes')
    data=json.loads(report.read_text()) if report.exists() else {'sourceFormat':source_format,'assertions':{}}
    data['postOptimizationBytes']=path.stat().st_size; data.setdefault('assertions',{})['belowGitHub100MiB']=True; data['assertions']['validGlbHeader']=True
    report.parent.mkdir(parents=True,exist_ok=True); report.write_text(json.dumps(data,indent=2))

def convert_package(manifest_path):
    manifest=json.loads(manifest_path.read_text()); source=reconstruct_package(manifest_path,manifest); category=valid_category(manifest.get('category')); asset=safe_name(manifest.get('runtimeName') or source.stem); out=RUNTIME/category/f'{asset}.glb'; report=REPORTS/f'{asset}.json'; out.parent.mkdir(parents=True,exist_ok=True); report.parent.mkdir(parents=True,exist_ok=True)
    source_format=(manifest.get('sourceFormat') or source.suffix.lstrip('.')).lower()
    # Already-valid GLBs do not need an expensive Blender round-trip. Reconstruct,
    # optimize them directly, and only use Blender for source formats that require conversion.
    if source_format=='glb':
        shutil.copy2(source,out)
        report.write_text(json.dumps({'version':4,'source':str(source),'sourceFormat':'glb','output':str(out),'inputBytes':source.stat().st_size,'assertions':{'reconstructed':True}},indent=2))
    else:
        run(['blender','-b','-P',str(BLENDER_SCRIPT),'--',str(source),str(out),str(report)])
    optimize_glb(out); validate_glb(out,report,source_format); print('VALIDATED',out.relative_to(ROOT),out.stat().st_size,'bytes'); return out

def main():
    REPORTS.mkdir(parents=True,exist_ok=True); markers=sorted(BATCHES.glob('*/ready.json')) if BATCHES.exists() else []
    if not markers: print('No Project Strike batch markers found.'); return 0
    failures=[]; converted=0
    for marker in markers:
        try: batch=json.loads(marker.read_text())
        except Exception as exc: failures.append(f'{marker}: invalid batch JSON: {exc}'); continue
        job=safe_name(batch.get('jobId') or marker.parent.name,marker.parent.name); packages=[safe_name(p,'package') for p in (batch.get('packages') or [])]; print(f'Processing batch {job}: {len(packages)} package(s)')
        for pid in packages:
            manifest=INBOX/job/pid/'package.json'
            if not manifest.exists(): failures.append(f'Missing manifest: {manifest}'); continue
            try: convert_package(manifest); converted+=1; shutil.rmtree(manifest.parent,ignore_errors=True)
            except Exception as exc: msg=f'FAILED {job}/{pid}: {exc}'; failures.append(msg); print(msg,file=sys.stderr)
        shutil.rmtree(marker.parent,ignore_errors=True)
        try: (INBOX/job).rmdir()
        except OSError: pass
    print(f'Converted: {converted} | Failures: {len(failures)}')
    if failures:
        (REPORTS/'last-batch-failures.json').write_text(json.dumps({'failures':failures},indent=2)); return 1
    (REPORTS/'last-batch-failures.json').unlink(missing_ok=True)
    return 0

if __name__=='__main__': raise SystemExit(main())
