"""Validate every fenced ```json block in the doc parses as JSON (contracts must be real)."""
import json
import re
from pathlib import Path

DOC = Path(r"D:\WorkSpace\octop-src\chronic-care\docs\数据模型与接口.md")
text = DOC.read_text(encoding="utf-8")
blocks = re.findall(r"```json\n(.*?)```", text, re.S)
print(f"json blocks: {len(blocks)}")
bad = 0
for i, b in enumerate(blocks, 1):
    try:
        json.loads(b)
    except Exception as e:
        bad += 1
        print(f"  [{i}] {e}: {b.strip().splitlines()[0][:70]}")
print("invalid:", bad)

# front-end field contract spot checks
need = ['"sbp"', '"dbp"', '"vitals"', '"lamp"', '"why"', '"tag"', '"note"', '"ev"',
        '"recs"', '"target"', '"low"', '"stats"', '"delta"', '"latest"', '"unit"']
missing = [n for n in need if n not in text]
print("missing front-end fields:", missing or "none")
