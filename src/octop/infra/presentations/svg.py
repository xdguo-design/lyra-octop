"""Small passive SVG contract shared by preview and the native exporter."""

from __future__ import annotations

import math
import re
from xml.etree import ElementTree

_NS = "http://www.w3.org/2000/svg"
_ELEMENTS = {
    "svg",
    "g",
    "rect",
    "text",
    "tspan",
    "line",
    "path",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
}
_ATTRIBUTES = {
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dx",
    "dy",
    "id",
    "transform",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "fx",
    "fy",
    "lang",
    "version",
}
_LOCAL_PAINT = re.compile(r"url\(#[A-Za-z_][A-Za-z0-9_.-]*\)\Z")
_GEOMETRY = {
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "stroke-width",
    "font-size",
    "dx",
    "dy",
    "transform",
    "gradientTransform",
}
_NUMBER = re.compile(r"[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?")


def validate_svg(content: str) -> str:
    """Reject active XML, unsupported constructs, external I/O, and oversized pages."""
    if len(content.encode("utf-8")) > 102400 or re.search(r"<!|<\?", content):
        raise ValueError("unsupported SVG declaration or size")
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as exc:
        raise ValueError("invalid SVG XML") from exc
    if root.tag != f"{{{_NS}}}svg":
        raise ValueError("SVG namespace is required")
    if root.get("viewBox", "").replace(",", " ").split() != ["0", "0", "1280", "720"]:
        raise ValueError("SVG canvas must be 1280 by 720")
    nodes = list(root.iter())
    if len(nodes) > 1500:
        raise ValueError("too many SVG elements")
    pending = [(root, 1)]
    while pending:
        element, depth = pending.pop()
        if depth > 32:
            raise ValueError("SVG nesting is too deep")
        pending.extend((child, depth + 1) for child in element)
    for element in nodes:
        if (
            not element.tag.startswith(f"{{{_NS}}}")
            or element.tag.split("}", 1)[1] not in _ELEMENTS
        ):
            raise ValueError(f"unsupported SVG element: <{element.tag.split('}')[-1]}>")
        for name, value in element.attrib.items():
            if name not in _ATTRIBUTES or len(value) > 20000:
                raise ValueError(f"unsupported SVG attribute: {name}")
            lowered = value.lower()
            if any(
                token in lowered
                for token in (
                    "javascript:",
                    "data:",
                    "http:",
                    "https:",
                    "file:",
                    "@import",
                    "expression(",
                )
            ):
                raise ValueError("external SVG resource")
            if "url" in lowered and (
                name not in {"fill", "stroke"} or not _LOCAL_PAINT.fullmatch(value)
            ):
                raise ValueError("invalid SVG paint reference")
            if re.search(r"(?<![a-z])(?:nan|inf(?:inity)?)(?![a-z])", lowered):
                raise ValueError("non-finite SVG geometry")
            if name in _GEOMETRY:
                numbers = [float(number) for number in _NUMBER.findall(value)]
                if any(not math.isfinite(number) or abs(number) > 100000 for number in numbers):
                    raise ValueError("SVG geometry exceeds bounds")
                if name in {"width", "height", "r", "rx", "ry", "font-size"} and any(
                    number < 0 for number in numbers
                ):
                    raise ValueError("negative SVG dimension")
    return content
