"""Title extraction for the recipe list.

Reads only the title, in the same order as the app's parser (src/utils/cooklangParser.ts):
YAML front matter first, then legacy `>> title:` lines, where a later line wins.
Steps, ingredients and cookware are not parsed.
"""

import re

MAX_TITLE_LENGTH = 200

_FRONT_MATTER = re.compile(r"^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)")
_FRONT_MATTER_TITLE = re.compile(r"^title\s*:\s*(.*)$", re.IGNORECASE)
_LEGACY_TITLE = re.compile(r"^>>\s*title\s*:(.*)$", re.IGNORECASE)
_QUOTED = re.compile(r"""^(['"])(.*)\1$""")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
_WHITESPACE = re.compile(r"\s+")


def clean_title(raw: str) -> str:
    """One line, no control characters, collapsed whitespace, at most MAX_TITLE_LENGTH."""
    text = _CONTROL.sub(" ", raw)
    text = _WHITESPACE.sub(" ", text).strip()
    return text[:MAX_TITLE_LENGTH].rstrip()


def _strip_quotes(value: str) -> str:
    value = value.strip()
    match = _QUOTED.match(value)
    return match.group(2) if match else value


def extract_title(content: str) -> str | None:
    """Raw title from the recipe text, or None if the recipe declares none."""
    body = content.lstrip("﻿")
    title: str | None = None

    front_matter = _FRONT_MATTER.match(body)
    if front_matter:
        for line in front_matter.group(1).splitlines():
            match = _FRONT_MATTER_TITLE.match(line.strip())
            if match:
                title = _strip_quotes(match.group(1))
        body = body[front_matter.end():]

    for line in body.splitlines():
        line = line.strip()
        comment = line.find("--")
        if comment != -1:
            line = line[:comment].strip()
        match = _LEGACY_TITLE.match(line)
        if match:
            title = match.group(1).strip()

    return title


def recipe_title(content: str, path: str) -> str:
    """Cleaned title for the list, falling back to the file name."""
    title = clean_title(extract_title(content) or "")
    if title:
        return title
    return clean_title(path.rsplit("/", 1)[-1]) or path
