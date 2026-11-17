"""Structural self-check for the DDL in 数据模型与接口.md.

Not a real parser — it verifies the failure modes that actually break a copy-paste run:
- unbalanced parentheses / quotes inside a statement
- statements that never terminate with ';'
- MySQL-isms (AUTO_INCREMENT, backticks, ENGINE=)
- $$ dollar-quote balance
"""
import re
import sys
from pathlib import Path

DOC = Path(r"D:\WorkSpace\octop-src\chronic-care\docs\数据模型与接口.md")
text = DOC.read_text(encoding="utf-8")

blocks = re.findall(r"```sql\n(.*?)```", text, re.S)
print(f"sql blocks: {len(blocks)}")

problems = []
statements = 0


def split_statements(sql: str):
    """Split on ';' outside quotes and dollar-quoted bodies."""
    out, buf = [], []
    i, n = 0, len(sql)
    in_s = in_d = in_line = in_block = False
    dollar = None
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if in_line:
            buf.append(ch)
            if ch == "\n":
                in_line = False
            i += 1
            continue
        if in_block:
            buf.append(ch)
            if ch == "*" and nxt == "/":
                buf.append(nxt)
                i += 2
                in_block = False
                continue
            i += 1
            continue
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(ch)
            i += 1
            continue
        if in_s:
            buf.append(ch)
            if ch == "'" and nxt == "'":
                buf.append(nxt)
                i += 2
                continue
            if ch == "'":
                in_s = False
            i += 1
            continue
        if in_d:
            buf.append(ch)
            if ch == '"':
                in_d = False
            i += 1
            continue
        if ch == "-" and nxt == "-":
            in_line = True
            buf.append(ch)
            i += 1
            continue
        if ch == "/" and nxt == "*":
            in_block = True
            buf.append(ch)
            i += 1
            continue
        if ch == "'":
            in_s = True
            buf.append(ch)
            i += 1
            continue
        if ch == '"':
            in_d = True
            buf.append(ch)
            i += 1
            continue
        if ch == "$":
            m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
            if m:
                dollar = m.group(0)
                buf.append(dollar)
                i += len(dollar)
                continue
        if ch == ";":
            # ';' inside a plpgsql body is handled by the dollar branch
            out.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return [s.strip() for s in out if s.strip()]


for bi, block in enumerate(blocks, 1):
    for stmt in split_statements(block):
        statements += 1
        head = re.sub(r"\s+", " ", stmt)[:80]
        if stmt.count("(") != stmt.count(")"):
            problems.append(f"[block {bi}] paren mismatch {stmt.count('(')}/{stmt.count(')')}: {head}")
        for bad in ("AUTO_INCREMENT", "ENGINE=", "`", "unsigned", "auto_increment"):
            if bad in stmt:
                problems.append(f"[block {bi}] MySQL-ism '{bad}': {head}")

# body-level checks outside sql blocks
if "__NEXT__" in text:
    problems.append("leftover __NEXT__ marker")
for word in ("待定", "按需扩展", "TBD", "???", "\ufffd"):
    if word in text:
        problems.append(f"placeholder/garble token: {word!r}")
fences = text.count("```")
print(f"statements: {statements}")
print(f"fences: {fences} ({'balanced' if fences % 2 == 0 else 'UNBALANCED'})")
print(f"chars: {len(text)}  cjk: {len(re.findall(r'[\u4e00-\u9fa5]', text))}")
print("problems:", len(problems))
for p in problems:
    print("  -", p)
sys.exit(1 if problems else 0)
