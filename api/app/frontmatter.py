"""Cooklang metadata as YAML front matter.

The old `>> key: value` lines are deprecated since cooklang-rs 0.14.0. `to_front_matter` gathers them
into one front matter block, wherever in the recipe they stand.
"""

import json
import re

LEGACY_LINE = re.compile(r"^>>\s*([^:]+?)\s*:\s*(.*?)\s*$")
FRONT_MATTER = re.compile(r"\A---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|\Z)")
_PLAIN_UNSAFE = re.compile(r"""(^[\s\-?:,\[\]{}#&*!|>'"%@`])|(: )|( #)|(\s$)""")


def yaml_value(value: str) -> str:
    """Plain YAML scalar, or a double-quoted one when plain would be misread."""
    if value and not _PLAIN_UNSAFE.search(value):
        return value
    return json.dumps(value, ensure_ascii=False)


def _without_key(lines: list[str], key: str) -> list[str]:
    """Front matter lines without the entry `key` (including its indented or list continuation lines)."""
    kept: list[str] = []
    skipping = False
    for line in lines:
        top_level = bool(line) and not line[0].isspace() and not line.startswith("- ") and not line.startswith("#")
        if top_level:
            match = re.match(r"^([^:]+?)\s*:", line)
            skipping = bool(match) and match.group(1).strip().lower() == key.lower()
        elif skipping and (not line.strip() or line[0].isspace() or line.startswith("- ")):
            continue
        else:
            skipping = False
        if not skipping:
            kept.append(line)
    return kept


def to_front_matter(cooklang: str) -> str:
    """Moves every `>> key: value` line into one YAML front matter block at the top.

    The lines are taken out of the recipe wherever they are, the blank line they leave behind is
    dropped. An existing front matter block is extended; a key given with `>>` replaces the same key
    there, and a later `>>` line replaces an earlier one. Text without `>>` lines comes back unchanged.
    """
    eol = "\r\n" if "\r\n" in cooklang else "\n"
    bom = "﻿" if cooklang.startswith("﻿") else ""
    text = cooklang.removeprefix("﻿").replace("\r\n", "\n")

    existing: list[str] = []
    match = FRONT_MATTER.match(text)
    if match:
        existing = match.group(1).split("\n")
        text = text[match.end():]

    entries: dict[str, tuple[str, str]] = {}
    body: list[str] = []
    skip_blank = False
    for line in text.split("\n"):
        legacy = LEGACY_LINE.match(line)
        if legacy:
            key = legacy.group(1)
            entries.pop(key.lower(), None)
            entries[key.lower()] = (key, legacy.group(2))
            skip_blank = True
            continue
        if skip_blank and not line.strip() and body and not body[-1].strip():
            skip_blank = False
            continue
        skip_blank = False
        body.append(line)
    if not entries:
        return cooklang

    for key, _ in entries.values():
        existing = _without_key(existing, key)
    block = ["---", *existing, *(f"{key}: {yaml_value(value)}" for key, value in entries.values()), "---"]
    return bom + "\n".join(block + body).replace("\n", eol)
