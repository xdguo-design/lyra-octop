"""Subprocess adapter for PPT Master's documented native-shape Python API."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    skill = Path(sys.argv[1]).resolve()
    project = Path(sys.argv[2]).resolve()
    sys.path.insert(0, str(skill / "scripts"))
    from attribution_guard import (
        require_skill_integrity,
    )

    require_skill_integrity()
    from svg_to_pptx import (
        create_pptx_with_native_svg,
    )

    result = create_pptx_with_native_svg(
        sorted((project / "svg_output").glob("*.svg")),
        project / "presentation.pptx",
        resource_root=project,
        canvas_format="ppt169",
        verbose=False,
        notes=json.loads((project / "notes.json").read_text(encoding="utf-8")),
        use_native_shapes=True,
        workers=1,
        image_optimize=False,
        pptx_structure="flat",
        expected_viewbox="0 0 1280 720",
        transition="none",
        dangerous_nonconforming_export=False,
    )
    if not result:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
