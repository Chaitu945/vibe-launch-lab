"""Package the project for handoff: zip the source tree without build artefacts.

    python tools/make-zip.py [output_path]

Excludes node_modules, dist and .git. Includes dotfiles (e.g. .github/workflows,
.gitignore) since those matter for deploy. Prints the entry count and size.
"""

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = {"node_modules", "dist", ".git", ".vercel", "__pycache__"}
EXCLUDE_SUFFIX = {".log", ".pyc", ".tsbuildinfo"}

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "vibe-launch-lab.zip"

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in sorted(ROOT.rglob("*")):
        if any(part in EXCLUDE_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.is_dir() or path.suffix in EXCLUDE_SUFFIX:
            continue
        z.write(path, Path(ROOT.name) / path.relative_to(ROOT))
        count += 1

size = out.stat().st_size
print(f"wrote {out}")
print(f"{count} files, {size / 1024:.0f} KB")

with zipfile.ZipFile(out) as z:
    names = z.namelist()
    print("top-level entries:", sorted({n.split('/')[1] for n in names if n.count('/') >= 1 and n.split('/')[1]}))
    print("sample:", names[:6])
