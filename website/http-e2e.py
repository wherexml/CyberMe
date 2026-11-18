"""Compare the actual served site to the public deploy allowlist."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

PUBLIC = Path(__file__).resolve().parent / "public"
FILES = {
    "/": "index.html",
    "/en": "en.html",
    "/zh-hant": "zh-hant.html",
    "/assets/site.css": "assets/site.css",
    "/assets/site.js": "assets/site.js",
    "/assets/logo.svg": "assets/logo.svg",
}
MISSING = ("/download", "/CyberMe.dmg", "/CyberMe.zip", "/.env", "/_headers", "/README.md", "/api/bootstrap", "/assets/missing.svg")


def response(url):
    raw = subprocess.check_output([
        "curl", "--silent", "--show-error", "--compressed", "--include",
        "--suppress-connect-headers", "--max-time", "12", url,
    ])
    header, body = raw.split(b"\r\n\r\n", 1)
    return int(header.split(None, 2)[1]), header.lower(), body


def main():
    origin = sys.argv[1].rstrip("/")
    actual_files = {p.relative_to(PUBLIC).as_posix() for p in PUBLIC.rglob("*") if p.is_file()}
    assert actual_files == set(FILES.values()) | {"404.html", "_headers"}, actual_files
    results = []
    for route in (*FILES, *MISSING):
        status, headers, body = response(origin + route)
        if route in FILES:
            assert status == 200, (route, status)
            assert b"\r\ncontent-security-policy:" in headers, route
            assert b"\r\nx-content-type-options: nosniff" in headers, route
            assert b"no-transform" in headers, route
            assert body == (PUBLIC / FILES[route]).read_bytes(), route
            if FILES[route].endswith(".html"):
                assert not re.search(rb'(?:https?://|downloadUrl|Voicemore|<iframe|<form)', body, re.I), route
        else:
            assert status == 404 and b"<h1>404</h1>" in body, (route, status)
        results.append({"route": route, "status": status, "sha256": hashlib.sha256(body).hexdigest()})
    print(json.dumps({"origin": origin, "checks": results}, indent=2))


if __name__ == "__main__":
    main()
