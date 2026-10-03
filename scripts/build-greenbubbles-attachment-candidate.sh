#!/bin/bash
# Pinned tracked-source-only isolated candidate. No installed/profile/userdata writes.
set -euo pipefail
umask 077
project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
python3 - "$project_root" <<'PYBUILD'
import os,sys,json,hashlib,subprocess,stat,tempfile,datetime,uuid
from pathlib import Path
project=Path(sys.argv[1]);upstream=Path('/Users/steve/Projects/greenbubbles')
commit='bec043be12db76a0d828cc222535315740bbde6c'
expected_patch_hash='e5c51fc8ec1d39ceded51d431fa7675f691f2a2d9dcd1ae1b377a899a7ebdb0a'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def safe_existing(path,directory=None):
    try:m=path.lstat()
    except FileNotFoundError:return False
    if stat.S_ISLNK(m.st_mode) or m.st_uid!=os.geteuid() or m.st_mode&0o022:
        raise SystemExit('Refusing symlink, owner or writable mode')
    if directory is True and not stat.S_ISDIR(m.st_mode):raise SystemExit('Refusing invalid directory')
    if directory is False and not stat.S_ISREG(m.st_mode):raise SystemExit('Refusing invalid file')
    return True
def safe_directory(path):
    current=project
    for part in path.relative_to(project).parts:
        current=current/part
        if not safe_existing(current,True):current.mkdir(mode=0o700)
    if path.resolve()!=path:raise SystemExit('Refusing path alias')
def safe_tree(path):
    if not safe_existing(path):return
    for parent,dirs,files in os.walk(path,followlinks=False):
        safe_existing(Path(parent),True)
        for name in dirs+files:safe_existing(Path(parent)/name)
def exclusive_write(path,data,mode=0o600):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
root=project/'.local/greenbubbles-attachment-candidate';out=project/'output/native-parity-20261003/wechat-attachment-cli'
safe_directory(root);safe_directory(out)
# Existing legacy target is not reused, but unsafe tampering is explicitly rejected.
safe_tree(root/'target');safe_existing(out/'candidate-ready.json',False)
patch=project/'patches/greenbubbles-default-attachment-source.patch';safe_existing(patch,False)
patch_data=patch.read_bytes()
if hashlib.sha256(patch_data).hexdigest()!=expected_patch_hash:raise SystemExit('Refusing unexpected patch hash')
run=Path(tempfile.mkdtemp(prefix='build.',dir=root));source=run/'source';source.mkdir(mode=0o700)
frozen_patch=run/'attachment.patch';exclusive_write(frozen_patch,patch_data,0o400)
# Only tracked committed crate + public license/readme. No mutable checkout/private inputs.
archive=subprocess.run(['git','-C',str(upstream),'archive',commit,'Native/GreenBubbles/src','Native/GreenBubbles/Cargo.toml','Native/GreenBubbles/Cargo.lock','LICENSE','README.md'],stdout=subprocess.PIPE,check=True).stdout
subprocess.run(['tar','-x','-C',str(source)],input=archive,check=True);safe_tree(source)
subprocess.run(['patch','--directory',str(source),'-p1','--forward','--dry-run'],input=patch_data,stdout=subprocess.DEVNULL,check=True)
subprocess.run(['patch','--directory',str(source),'-p1','--forward'],input=frozen_patch.read_bytes(),stdout=subprocess.DEVNULL,check=True)
for file in source.rglob('*'):
    if file.is_file():file.chmod(0o400)
def snapshot():
    hashes={};versions={}
    for p in sorted(source.rglob('*')):
        safe_existing(p)
        if p.is_file():
            m=p.stat();key=str(p.relative_to(source));hashes[key]=sha(p);versions[key]=[m.st_dev,m.st_ino,m.st_size,m.st_mtime_ns,m.st_ctime_ns,m.st_mode]
    return hashes,versions
before_hashes,before_versions=snapshot();crate=source/'Native/GreenBubbles';main=(crate/'src/main.rs').read_text();attachment=(crate/'src/live_attachment.rs').read_text()
patch_applied=main.count('resolve_query_invocation(explicit_source_root.clone(), &remaining)?')==2 and 'content_sha256' in attachment and 'attachment_parent_chain' in attachment and 'by_content' in attachment and 'changed_nanoseconds' in attachment
if not patch_applied:raise SystemExit('Refusing incomplete candidate patch')
target=run/'target';target.mkdir(mode=0o700);stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:12];log=out/('build-'+stamp+'.log')
env=dict(os.environ);env['CARGO_TARGET_DIR']=str(target)
with os.fdopen(os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as output:
    build=subprocess.run(['cargo','build','--release','--locked','--offline','--bin','greenbubbles','--manifest-path',str(crate/'Cargo.toml')],env=env,stdout=output,stderr=subprocess.STDOUT)
after_hashes,after_versions=snapshot();oldlock=subprocess.run(['git','-C',str(upstream),'show',commit+':Native/GreenBubbles/Cargo.lock'],stdout=subprocess.PIPE,check=True).stdout
stable=before_hashes==after_hashes and before_versions==after_versions and sha(frozen_patch)==expected_patch_hash and sha(patch)==expected_patch_hash
lock_equal=sha(crate/'Cargo.lock')==hashlib.sha256(oldlock).hexdigest();target_binary=target/'release/greenbubbles';success=build.returncode==0 and stable and lock_equal and safe_existing(target_binary,False)
# Fresh target may not contain injected deep links; verify all emitted files before consuming binary.
safe_tree(target)
binary=None;compiled_hash=None;version=None
if success:
    with os.fdopen(os.open(target_binary,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
        pre=os.fstat(f.fileno());data=f.read(256*1024*1024+1);post=os.fstat(f.fileno())
    if len(data)>256*1024*1024 or (pre.st_dev,pre.st_ino,pre.st_size,pre.st_mtime_ns,pre.st_ctime_ns)!=(post.st_dev,post.st_ino,post.st_size,post.st_mtime_ns,post.st_ctime_ns):raise SystemExit('Refusing changed binary')
    compiled_hash=hashlib.sha256(data).hexdigest();digest_dir=root/'bin'/compiled_hash;safe_directory(digest_dir);binary=digest_dir/'greenbubbles'
    if not safe_existing(binary,False):exclusive_write(binary,data,0o500)
    if sha(binary)!=compiled_hash or binary.stat().st_mode&0o222:raise SystemExit('Refusing changed archive')
    version=subprocess.run([str(binary),'--version'],stdout=subprocess.PIPE,text=True,check=True).stdout.strip()
script_hash=sha(project/'scripts/build-greenbubbles-attachment-candidate.sh')
report={'schema':2,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_BUILD' if success else 'FAIL_BUILD','buildExit':build.returncode,'upstreamCommit':commit,'sourceRoot':str(source),'candidateCli':str(binary) if binary else None,'compiledTarget':str(target_binary),'compiledHash':compiled_hash,'version':version,'archiveVerified':success,'patchHash':expected_patch_hash,'patchApplied':patch_applied,'patchSourceStable':stable,'sourceHashes':after_hashes,'sourceHashesBefore':before_hashes,'sourceVersionsStable':before_versions==after_versions,'candidateMainHash':sha(crate/'src/main.rs'),'candidateAttachmentHash':sha(crate/'src/live_attachment.rs'),'lockHash':sha(crate/'Cargo.lock'),'lockUnchanged':lock_equal,'buildLog':str(log),'buildScriptHash':script_hash,'locked':True,'offline':True,'uniqueTarget':True,'installedUnmodified':True,'profilesCredentialsCopied':False,'guiAcceptance':False}
encoded=(json.dumps(report,indent=2)+'\n').encode();exclusive_write(out/('build-'+stamp+'.json'),encoded)
if success:
    safe_existing(out/'candidate-ready.json',False)
    temp_ready=out/('.candidate-ready-'+uuid.uuid4().hex+'.json');exclusive_write(temp_ready,encoded);os.replace(temp_ready,out/'candidate-ready.json')
print(json.dumps({k:report[k] for k in ['status','candidateCli','compiledHash','lockUnchanged','patchSourceStable','uniqueTarget','buildExit']}))
if not success:raise SystemExit(1)
PYBUILD
