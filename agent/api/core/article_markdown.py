"""Reader-grade cleanup of extracted article Markdown.

trafilatura (core/articles.py) already removes most page chrome and renders structure as
Markdown. What is left is the residue its heuristics cannot know about, and every rule here was
taken from real publisher pages (NYT, ESPN, Space.com, Live Science, Blue Bottle, Wikipedia):

- the page's own ``# Headline`` repeated inside the body (the reader prints the headline itself; an H1
  before any prose is that headline by construction, and a page's SEO ``<title>`` often differs from it);
- kicker / byline / "Follow us" lines that are nothing but links, ahead of the first paragraph;
- accessibility and ad furniture: ``Supported by``, ``[SKIP ADVERTISEMENT](…#after-sponsor)``;
- author avatars, the comment-gate footer some publishers append, a ``- Share:`` list item;
- share / related / newsletter sections, empty headings, carousel pagination (``Slide 1…``);
- ``<u>`` wrapped around link text (trafilatura renders underline as inline HTML);
- link and image destinations that are not http(s)/mailto (trafilatura keeps ``javascript:`` targets verbatim).

Ads are an explicit non-goal of the body: publisher advertising furniture is removed here and the
platform's own sponsored placements are rendered by the reader *around* the body, never inside this
Markdown, so what an agent or Context item receives is always editorial text only.

Block boundaries come from markdown-it-py (CommonMark + tables, raw HTML off), the same parser the
issue agents already use; a block is kept or dropped as its exact source lines, so nothing the
publisher wrote is re-serialised or reworded.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from markdown_it import MarkdownIt
from markdown_it.token import Token

MAX_CHARS = 60_000
#: A paragraph this long is article prose; anything shorter ahead of it can be page furniture.
PROSE_WORDS = 12
#: Link-only lines (kicker, byline, CTA) ahead of the first prose paragraph stay under this.
FURNITURE_WORDS = 10

#: Standalone lines that are never article text. Compared after ``_norm`` (case, punctuation).
BOILERPLATE_LINES = frozenset({
    "advertisement", "advertisements", "sponsored", "sponsored content", "supported by", "skip advertisement",
    "story continues below advertisement", "continue reading the main story", "follow us",
    "follow us on google news", "sign up for our newsletter", "subscribe", "subscribe now", "share",
    "share this article", "share this story", "listen to this article", "most popular", "trending",
    "read more", "read next", "recommended", "related", "related articles", "related stories",
    "related coverage", "you may also like", "more from", "comments", "leave a comment", "newsletter",
    # Future plc comment gate (Space.com, Live Science, Tom's Guide), appended to every article
    "you must confirm your public display name before commenting",
    "please logout and then login again you will then be prompted to enter your display name",
})
AVATAR_ALT = re.compile(r"\b(avatar|headshot|author (photo|picture|image)|profile (photo|picture|image)|byline photo)\b", re.I)
#: Headings that open a chrome section (removed with everything up to the next heading of equal or higher rank).
CHROME_HEADINGS = frozenset({
    "share", "share this article", "share this story", "related", "related articles", "related stories",
    "related coverage", "read more", "read next", "recommended", "you may also like", "trending",
    "most popular", "comments", "newsletter", "sign up for our newsletter", "advertisement",
})
#: Furniture that varies in wording but not in shape ("Article continues below this ad", "More from IndieWire"),
#: matched against ``_norm`` of a short standalone paragraph or heading. Real prose never opens this way.
FURNITURE_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r"^(article|story|content|video|this article|this story)? ?continues? (below|after|beneath|on)\b",
    r"^(scroll (down )?to continue|continue reading (below|after|the main story))\b",
    r"^(skip|close) (this )?(ad|advertisement)\b",
    r"^this (ad|advertisement) will (close|end)\b",
    r"^(advertisement|sponsored|paid content|ad)\b.{0,12}$",
    r"^more from\b",
    r"^(read|watch) (more|next|also)\b",
))
FURNITURE_WORDS_MAX = 10
BYLINE = re.compile(r"^(by|written by|reporting by|updated|published|posted|last updated)\b", re.I)
CAROUSEL_ITEM = re.compile(r"^- +slide \d+", re.I)
UNDERLINE = re.compile(r"</?u>", re.I)

#: A link destination: ``<...>``-wrapped (may contain spaces and parentheses) or bare, then an optional title.
_DEST = r"""\(\s*(?:<([^<>\n]*)>|([^()\s<>]*))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)"""
#: ``[label](dest)`` / ``![alt](dest)`` with a plain label.
_LINK = re.compile(r"(!?)\[([^\[\]]*)\]" + _DEST)
#: Whatever a nested construct (``[![a](https://i/x.png)](javascript:…)``) left behind.
_BAD_TAIL = re.compile(r"\]\(\s*<?\s*(?!(?:https?|mailto):)[a-z][a-z0-9+.\-]*:[^<>\n]*?>?\s*\)(?!\))", re.I)
_SCHEME = re.compile(r"^([a-z][a-z0-9+.\-]*):", re.I)

_parser = MarkdownIt("commonmark").enable(["table", "strikethrough"])


@dataclass
class Block:
    kind: str  # heading | paragraph | list | quote | table | code | rule | html
    text: str  # the block's exact source lines
    level: int = 0  # headings only
    content: str = ""  # headings and paragraphs: the inline source ("[News](https://…)")
    plain: str = ""  # visible text of that inline source (link text kept, destinations dropped)
    link_only: bool = False  # a paragraph made of nothing but links
    targets: tuple[str, ...] = ()  # destinations of those links
    image_only: bool = False
    alt: str = ""  # an image-only paragraph's alt text

    @property
    def words(self) -> int:
        return len(self.plain.split())


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def _inline_facts(inline: Token) -> tuple[str, bool, tuple[str, ...], bool, str]:
    plain: list[str] = []
    outside: list[str] = []
    targets: list[str] = []
    depth = 0
    images = 0
    alt = ""
    for child in inline.children or []:
        if child.type == "link_open":
            depth += 1
            targets.append(str(child.attrGet("href") or ""))
        elif child.type == "link_close":
            depth -= 1
        elif child.type == "image":
            images += 1
            alt = alt or child.content
        elif child.type in ("text", "code_inline"):
            plain.append(child.content)
            if depth == 0:
                outside.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            plain.append(" ")
    visible = " ".join("".join(plain).split())
    separators = re.sub(r"[\W_]+", "", "".join(outside))
    link_only = bool(targets) and not separators and not images
    image_only = images > 0 and not visible and not targets
    return visible, link_only, tuple(targets), image_only, alt


def split_blocks(markdown: str) -> list[Block]:
    """Top-level blocks as exact source slices, with just enough facts about each to filter on."""
    lines = markdown.split("\n")
    tokens = _parser.parse(markdown)
    blocks: list[Block] = []
    for index, token in enumerate(tokens):
        if token.level != 0 or token.map is None or token.nesting == -1:
            continue
        text = "\n".join(lines[token.map[0]:token.map[1]]).rstrip()
        if not text.strip():
            continue
        inline = tokens[index + 1] if token.nesting == 1 and index + 1 < len(tokens) and tokens[index + 1].type == "inline" else None
        if token.type == "heading_open" and inline is not None:
            plain = _inline_facts(inline)[0]
            blocks.append(Block("heading", text, level=int(token.tag[1]), content=inline.content, plain=plain))
        elif token.type == "paragraph_open" and inline is not None:
            plain, link_only, targets, image_only, alt = _inline_facts(inline)
            blocks.append(Block("paragraph", text, content=inline.content, plain=plain, link_only=link_only,
                                targets=targets, image_only=image_only, alt=alt))
        elif token.type in ("bullet_list_open", "ordered_list_open"):
            blocks.append(Block("list", text))
        elif token.type == "blockquote_open":
            blocks.append(Block("quote", text))
        elif token.type == "table_open":
            blocks.append(Block("table", text))
        elif token.type in ("fence", "code_block"):
            blocks.append(Block("code", text))
        elif token.type == "hr":
            blocks.append(Block("rule", text))
        else:
            blocks.append(Block("html", text))
    return blocks


def _same_page_fragment(href: str, page_url: str) -> bool:
    """``https://host#after-sponsor`` / ``#main``: a skip link, not a source."""
    target = urlsplit(href)
    page = urlsplit(page_url)
    if not target.fragment:
        return False
    if target.netloc and target.netloc != page.netloc:
        return False
    return target.path in ("", "/", page.path)


def _is_prose(block: Block) -> bool:
    if block.kind == "paragraph":
        return not block.link_only and not block.image_only and block.words >= PROSE_WORDS
    return block.kind in ("list", "quote", "table", "code")


def _is_furniture(block: Block, page_url: str) -> bool:
    if block.kind != "paragraph":
        return False
    if block.image_only:
        return bool(AVATAR_ALT.search(block.alt))
    folded = _norm(block.plain)
    if folded in BOILERPLATE_LINES:
        return True
    if block.words <= FURNITURE_WORDS_MAX and any(pattern.match(folded) for pattern in FURNITURE_PATTERNS):
        return True
    if block.link_only and block.targets and all(_same_page_fragment(href, page_url) for href in block.targets):
        return True
    return False


def safe_destinations(text: str) -> str:
    """Links may point at http(s) or mailto, images at https; anything else (``javascript:``, ``data:``, ``file:``,
    ``vbscript:``, and relative, ``//host`` or ``#fragment`` targets, which mean nothing outside the publisher's page)
    is unwrapped to its label, or removed for an image.

    The renderer sanitises again; this is the boundary that keeps such targets out of stored Context items and
    agent attachments, which are never rendered at all."""
    def repair(match: re.Match[str]) -> str:
        bang, label, wrapped, bare = match.groups()
        scheme = _SCHEME.match((wrapped if wrapped is not None else bare) or "")
        name = scheme.group(1).lower() if scheme else ""
        if bang:
            return match.group(0) if name == "https" else ""
        return match.group(0) if name in ("http", "https", "mailto") else label

    previous = None
    while previous != text:  # a repaired inner link can expose an outer one
        previous, text = text, _LINK.sub(repair, text)
    return _BAD_TAIL.sub("]", text)


def clean_blocks(blocks: list[Block], *, title: str = "", page_url: str = "") -> list[Block]:
    wanted = _norm(title)
    kept: list[Block] = []
    seen_prose = False
    headline_dropped = False
    skip_level = 0  # inside a chrome section opened by a heading of this level
    for block in blocks:
        if block.kind == "heading":
            if skip_level and block.level > skip_level:
                continue
            skip_level = 0
            heading = _norm(block.plain)
            if heading in CHROME_HEADINGS or (block.words <= FURNITURE_WORDS_MAX and any(p.match(heading) for p in FURNITURE_PATTERNS)):
                skip_level = block.level
                continue
            # The reader prints the headline itself. Articles have one H1 and it comes first; an H2 headline
            # is only recognised by matching the title.
            if not seen_prose and not headline_dropped and (block.level == 1 or (
                    block.level == 2 and wanted and heading and (heading in wanted or wanted in heading))):
                headline_dropped = True
                continue
        elif skip_level:
            continue
        if block.kind == "paragraph" and _is_furniture(block, page_url):
            continue
        if not seen_prose and block.kind == "paragraph" and not block.image_only:
            if block.link_only and block.words <= FURNITURE_WORDS:
                continue
            if block.words <= FURNITURE_WORDS and BYLINE.match(block.plain):
                continue
        if block.kind == "list":
            lines = [line for line in block.text.splitlines() if line.strip()]
            if all(CAROUSEL_ITEM.match(line.strip()) for line in lines):
                continue
            tidy = [line for line in lines if _norm(re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", line)) not in BOILERPLATE_LINES]
            if len(tidy) != len(lines):
                if not tidy:
                    continue
                block = Block("list", "\n".join(tidy))
        if _is_prose(block):
            seen_prose = True
        kept.append(block)
    return _tidy_headings(kept)


def _tidy_headings(blocks: list[Block]) -> list[Block]:
    """No empty sections and no repeated headings; the page headline owns H1, so the body starts at H2."""
    out: list[Block] = []
    for index, block in enumerate(blocks):
        if block.kind == "heading":
            following = blocks[index + 1] if index + 1 < len(blocks) else None
            if following is None or (following.kind == "heading" and following.level <= block.level):
                continue
            previous = out[-1] if out else None
            if previous is not None and previous.kind == "heading" and _norm(previous.plain) == _norm(block.plain):
                continue
            if block.level == 1:
                block = Block("heading", "## " + block.content, level=2, content=block.content, plain=block.plain)
        out.append(block)
    return out


def clean_markdown(markdown: str, *, title: str = "", page_url: str = "", max_chars: int = MAX_CHARS) -> tuple[str, bool]:
    """Cleaned Markdown and whether it was cut at a block boundary to stay within ``max_chars``."""
    out: list[str] = []
    size = 0
    truncated = False
    for block in clean_blocks(split_blocks(markdown), title=title, page_url=page_url):
        text = block.text if block.kind == "code" else safe_destinations(UNDERLINE.sub("", block.text))
        if size + len(text) + 2 > max_chars:
            truncated = True
            break
        out.append(text)
        size += len(text) + 2
    return "\n\n".join(out), truncated


def plain_length(markdown: str) -> int:
    """Characters of readable text: link and image destinations do not count towards 'enough article'."""
    return len(re.sub(r"\]\([^)]*\)", "]", markdown))
