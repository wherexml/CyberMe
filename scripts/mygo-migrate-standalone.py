#!/usr/bin/env python3
"""One-shot local upgrade: closed source writer, private atomic target, source retained."""
import json, os, sqlite3, shutil, stat, subprocess, hashlib
from pathlib import Path
root=Path(__file__).resolve().parent.parent
target=Path.home()/'Library/Application Support/OpsTwins'
for p in [target,*target.parents]:
    if p.is_symlink(): raise SystemExit('Refuse symlink destination ancestor')
if target.exists(): raise SystemExit('Destination already exists; refuse overwrite')
for port in [46110,46312]:
    if subprocess.run(['lsof','-t',f'-iTCP:{port}','-sTCP:LISTEN'],capture_output=True).returncode==0: raise SystemExit('Stop owned service before migration')
stage=target.with_name('OpsTwins.migrating-'+str(os.getpid()))
stage.mkdir(mode=0o700)
def copy(src,dst):
    if not src.exists(): return
    if src.is_symlink(): raise RuntimeError('Symlinks forbidden in migration')
    if src.is_dir():
        dst.mkdir(parents=True,exist_ok=True,mode=0o700)
        for child in src.iterdir(): copy(child,dst/child.name)
    else:
        dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        shutil.copyfile(src,dst);dst.chmod(0o700 if src.stat().st_mode&0o111 else 0o600)
def backup(src,dst):
    dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with sqlite3.connect(src.as_uri()+'?mode=ro',uri=True) as a,sqlite3.connect(dst) as b: a.backup(b)
    dst.chmod(0o600)
try:
    backup(root/'data/opstwin-advance.db',stage/'data/opstwin-advance.db')
    for name in ['files','outbound','feishu-attachments']: copy(root/'data'/name,stage/'data'/name)
    for name in ['config.json','jev.json','feishu-binding']: copy(root/'.local'/name,stage/'.local'/name)
    copy(root/'.local/mygo-workspace/state.json',stage/'.local/mygo-workspace/state.json')
    binding=root/'.local/wechat-attachment-runtime.json'
    if binding.exists():
        b=json.loads(binding.read_text());src=Path(b['cliPath']);expected=root/'.local/greenbubbles-attachment-candidate/bin'/b['sha256']/'greenbubbles'
        if src!=expected or hashlib.sha256(src.read_bytes()).hexdigest()!=b['sha256']: raise RuntimeError('Invalid archived WeChat binary')
        rel=src.relative_to(root);copy(src,stage/rel);(stage/rel).chmod(0o555)
        b['cliPath']=str(target/rel);f=stage/'.local/wechat-attachment-runtime.json';f.write_text(json.dumps(b));f.chmod(0o600)
    # Independent read-only source snapshot, not a runtime dependency on sibling project.
    sibling=root.parent/'opstwin/server/data'
    if (sibling/'dev.db').exists():
        backup(sibling/'dev.db',stage/'data/source-cache/dev.db')
        copy(sibling/'feishu-attachments',stage/'data/source-cache/feishu-attachments')
    rewritten=0
    # Rewrite only structured runtime file locations, never bodies/messages/user text.
    def relocate(value,key=''):
        global rewritten
        if isinstance(value,dict): return {k:relocate(v,k) for k,v in value.items()}
        if isinstance(value,list): return [relocate(v,key) for v in value]
        if isinstance(value,str) and key in {'path','diskPath','filePath','localPath','stored_path'} and value.startswith(str(root/'data')+'/'):
            rewritten+=1;return str(target/'data')+value[len(str(root/'data')):]
        return value
    with sqlite3.connect(stage/'data/opstwin-advance.db') as db:
        before=db.execute('select count(*) from entities').fetchone()[0]
        for table,col in [('entities','data'),('source_snapshots','data')]:
            for rowid,text in db.execute(f'select rowid,{col} from {table}').fetchall():
                old=json.loads(text);new=relocate(old)
                if old!=new:db.execute(f'update {table} set {col}=? where rowid=?',(json.dumps(new,ensure_ascii=False),rowid))
        assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
        assert before==db.execute('select count(*) from entities').fetchone()[0]
    report={'schema':1,'entities':before,'relocatedPathFields':rewritten,'sourceRetained':True,'privateCredentialsIncludedInApp':False}
    (stage/'migration.json').write_text(json.dumps(report,indent=2));(stage/'migration.json').chmod(0o600)
    os.rename(stage,target)
    out=root/'output/mygo-standalone-20261016';out.mkdir(parents=True,exist_ok=True);(out/'migration.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
except Exception:
    print('Migration failed; source unchanged; private staging retained for diagnosis')
    raise
