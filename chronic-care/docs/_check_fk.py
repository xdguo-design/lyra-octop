"""FK / column cross-reference audit for the DDL in 数据模型与接口.md.

Checks:
1. every `REFERENCES t(c)` points at a defined table (and the column exists)
2. the referenced column is a single-column PK or UNIQUE on the target table
3. every `CREATE INDEX` names columns that exist on that table
4. no table declares the same column twice
"""
import re
from pathlib import Path

DOC = Path(r"D:\WorkSpace\octop-src\chronic-care\docs\数据模型与接口.md")
text = DOC.read_text(encoding="utf-8")
blocks = re.findall(r"```sql\n(.*?)```", text, re.S)
sql = "\n".join(blocks)

# table body: from "( " after the name to a line starting with ")" ending in ";"
table_re = re.compile(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\((.*?)\n\)[^;\n]*;", re.S)
tables = {}
problems = []

KEYWORDS = {
    "constraint", "primary", "unique", "check", "foreign", "references", "on",
    "partition", "exclude", "like", "inherits", "using",
}

for m in table_re.finditer(sql):
    name, body = m.group(1), m.group(2)
    if name.endswith("_default") or re.search(r"_\d{4}_\d{2}$", name):
        continue
    cols, pk, uq = {}, set(), set()
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith("--"):
            continue
        first = s.split()[0].lower()
        col = re.match(r"([a-z_][a-z0-9_]*)\s+([a-z]+(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])?)", s)
        if col and first not in KEYWORDS:
            cname = col.group(1)
            if cname in cols and not s.lower().startswith("constraint"):
                problems.append(f"DUP COLUMN {name}.{cname}")
            cols[cname] = col.group(2)
            if re.search(r"\bPRIMARY KEY\b", s):
                pk.add(cname)
            if re.search(r"\bUNIQUE\b", s) and "(" not in s.split("UNIQUE")[-1].strip():
                uq.add(cname)
        tpk = re.search(r"PRIMARY KEY\s*\(\s*(\w+)\s*\)", s)
        if tpk:
            pk.add(tpk.group(1))
        tuq = re.search(r"UNIQUE\s*\(\s*(\w+)\s*\)", s)
        if tuq:
            uq.add(tuq.group(1))
        for m4 in re.finditer(r"UNIQUE\s*\(\s*(\w+)\s*\)", s):
            uq.add(m4.group(1))
    tables[name] = {"cols": cols, "pk": pk, "uq": uq, "body": body}

print(f"tables parsed: {len(tables)} of 31")
missing = 31 - len(tables)
if missing:
    parsed = set(tables)
    allnames = {m.group(1) for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(", sql)}
    allnames = {n for n in allnames if not n.endswith("_default") and not re.search(r"_\d{4}_\d{2}$", n)}
    print("  unparsed:", sorted(allnames - parsed))

for name, info in tables.items():
    for ref in re.finditer(r"REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)", info["body"]):
        tgt, col = ref.group(1), ref.group(2)
        if tgt not in tables:
            problems.append(f"{name} -> unknown table {tgt}")
            continue
        t = tables[tgt]
        if col not in t["cols"]:
            problems.append(f"{name} -> {tgt}.{col} missing column")
        elif col not in t["pk"] and col not in t["uq"]:
            problems.append(f"{name} -> {tgt}.{col} not PK/UNIQUE (FK would fail)")

for m in re.finditer(
    r"CREATE (?:UNIQUE )?INDEX (\w+)\s+ON\s+(\w+)\s*(?:USING \w+\s*)?\(([^)]*)\)", sql, re.S
):
    idx, tbl, cols = m.group(1), m.group(2), m.group(3)
    if tbl not in tables:
        problems.append(f"index {idx} on unknown table {tbl}")
        continue
    cols = re.sub(r"coalesce\s*\([^)]*\)", " ", cols, flags=re.I)  # expr indexes: check nothing
    if cols.count("(") != cols.count(")"):
        continue  # multi-line expression index — regex could not capture it fully
    for c in re.split(r",\s*", cols):
        c = c.strip()
        if not c or "(" in c or c.upper() in {"DESC", "ASC"}:
            continue
        base = c.split()[0]
        if base not in tables[tbl]["cols"]:
            problems.append(f"index {idx} on {tbl}: unknown column {base!r}")

for m in re.finditer(r"CREATE (?:UNIQUE )?INDEX (\w+)\s+ON\s+(\w+)\s*(?:USING \w+\s*)?\(([^)]*)\)[^;]*?WHERE\s+([^;]+);", sql, re.S):
    idx, tbl, _, pred = m.group(1), m.group(2), m.group(3), m.group(4)
    if tbl not in tables:
        continue
    pred = re.sub(r"'(?:[^']|'')*'", " ", pred)  # drop string literals (enum values)
    pred = re.sub(r"\(\s*\w+\s*,\s*0\s*\)", " ", pred)  # coalesce(tenant_id, 0) style expressions
    for c in re.findall(r"\b([a-z_][a-z0-9_]*)\b", pred):
        if c in {"and", "or", "not", "null", "is", "in", "true", "false", "now", "interval",
                 "green", "yellow", "red", "pending", "available", "failed", "processing",
                 "managing", "open", "acked", "draft", "queued"}:
            continue
        if c not in tables[tbl]["cols"]:
            problems.append(f"partial index {idx} predicate on {tbl}: unknown column {c!r}")

print("problems:", len(set(problems)))
for p in sorted(set(problems)):
    print("  -", p)
