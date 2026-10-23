import re

SRC = r"C:\Users\xdguo\prd_source.html"
DST = r"outbound/prd_clean.html"

src = open(SRC, encoding="utf-8").read()
clean = re.sub(r"data:image/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+", "data:IMG_B64_REMOVED", src)
open(DST, "w", encoding="utf-8").write(clean)
print(len(src), "->", len(clean))
