"""Extract event definitions from the frontend chunks and match their topic0 against
the signatures observed on the V6 factory.

    python tools/extract-events.py
"""

import re
from pathlib import Path

CHUNKS = Path.home() / "AppData" / "Local" / "Temp" / "allchunks"
OBSERVED = {
    "0x5e4996fc710ab2bf894de604570b39df292e3629ba35a424cd622f8da787e537": 102,
    "0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8": 102,
    "0x026fa5670c8bd26fb284c0b8a90db90d26b2153647ef066ab0fba18762931a83": 11,
    "0xfec4a7b18877540a81f226317e33de4aa4e1d5432b706b3c18932dfe0b6b5fbf": 7,
}
TOKEN_LAUNCHED = "0x56eef5c350583250e71791d6d659f4d181796c9deb08b977252efc3995aa9279"

events = {}
name_re = re.compile(r'name\s*:\s*"([A-Za-z0-9_]+)"')
for f in sorted(CHUNKS.glob("*.js")):
    txt = f.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'type\s*:\s*"event"', txt):
        # find the enclosing object boundaries (search back to '{' and forward to matching '}')
        start = txt.rfind("{", max(0, m.start() - 1200), m.start())
        if start == -1:
            continue
        depth = 0
        i = start
        while i < len(txt):
            if txt[i] == "{":
                depth += 1
            elif txt[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        obj = txt[start : i + 1]
        names = name_re.findall(obj)
        if not names:
            continue
        # the event name is the first name; the rest are input names
        ev = names[0]
        inputs = re.findall(r'type\s*:\s*"([A-Za-z0-9_\[\]]+)"', obj)
        inputs = [t for t in inputs if t != "event"]
        indexed = len(re.findall(r'indexed\s*:\s*true', obj))
        sig = f"{ev}({','.join(inputs)})"
        events.setdefault(sig, {"file": f.name, "indexed": indexed, "inputs": inputs})

print(f"{len(events)} distinct event signatures found in the bundles\n")
for sig, meta in events.items():
    print(f"  {sig[:150]}   [{meta['file']}, indexed={meta['indexed']}]")
