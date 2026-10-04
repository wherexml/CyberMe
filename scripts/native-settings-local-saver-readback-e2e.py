"""Read-only E2E readback of the recorded actual native failure/retry/restart.

No unit tests, model calls, UI mutations or copies of private settings bodies.
Reproduction steps and original failure are in the corresponding journey.
"""
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/native-parity-20261003/settings-local-saver-20261004"

def read(name):
    return json.loads((OUT / name).read_text())

def sha(data):
    return hashlib.sha256(data).hexdigest()

checks = []

def check(name, ok):
    checks.append({"name": name, "status": "PASS" if ok else "FAIL"})
    if not ok:
        raise RuntimeError(name)

try:
    bound = read("source-binding-signed.json")
    check("current settings source matches actual v38 build", sha((ROOT / "native/macos/app/src/settings.rs").read_bytes()) == bound["native/macos/app/src/settings.rs"])
    check("signed v38 executable matches GUI evidence", sha((ROOT / ".local/apps/OpsTwins-Acceptance-Resume-v38.app/Contents/MacOS/opstwin").read_bytes()) == bound["signedNativeBinary"])
    state_file = ROOT / ".local/acceptance/settings-local-saver-20261004/gui/settings-drafts.json"
    check("state is regular file after fault removed", state_file.is_file() and not state_file.is_symlink())
    state = json.loads(state_file.read_text())
    check("normal restart keeps exact confirmed snapshot", sha(state_file.read_bytes()) == read("v38-after-retry.json")["settingsHash"])
    check("confirmed 14pt retained", state["local"]["font"] == 14)
    check("unsubmitted model draft retained", state["drafts"]["models"]["standard"] == read("v38-after-retry.json")["draftModel"])
    check("actual failure has explicit retry action", "button 重试保存" in (OUT / "03-v38-failure-retains-14pt.ax.txt").read_text())
    check("local error survives section switch", "button 重试保存" in (OUT / "04-v38-model-draft-with-local-error.ax.txt").read_text())
    check("successful retry removes local retry action", "button 重试保存" not in (OUT / "05-v38-retry-clears-only-local-error.ax.txt").read_text())
    check("actual restart shows 14pt", "button 14 pt" in (OUT / "06-v38-restart-font.ax.txt").read_text())
    check("actual restart shows exact unsubmitted model", "button claude-haiku-4-5-20251001" in (OUT / "07-v38-restart-model-draft.ax.txt").read_text())
    with urllib.request.urlopen("http://127.0.0.1:46214/api/settings/models", timeout=10) as response:
        models = json.load(response)
    check("server model configuration unchanged", sha(models["version"].encode()) == read("v38-before-fault.json")["modelVersionHash"])
    status = "PASS"
except Exception as error:
    status = "FAIL"
    checks.append({"failure": str(error)})

(OUT / "readback-e2e.json").write_text(json.dumps({"status": status, "checks": checks, "scope": "Recorded actual GUI + live local snapshot + real redacted API GET; not a complete settings score"}, indent=2))
print(json.dumps({"status": status, "checks": len(checks)}))
raise SystemExit(0 if status == "PASS" else 1)
