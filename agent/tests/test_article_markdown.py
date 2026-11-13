"""Reader cleanup rules. Every input below is an artifact observed in real extractor output
(NYT, ESPN, Space.com, Live Science, ScienceDaily, Blue Bottle), run through the real parser."""
import pytest

from agent.api.core.article_markdown import clean_markdown, plain_length, safe_destinations, split_blocks

PAGE = "https://www.nytimes.com/2026/11/08/technology/story.html"
PROSE = "This is a full sentence of article prose that is comfortably longer than the twelve word threshold."


def clean(markdown: str, **kwargs) -> str:
    return clean_markdown(markdown, page_url=kwargs.pop("page_url", PAGE), **kwargs)[0]


def test_blocks_are_exact_source_slices_with_fences_and_tables_intact():
    source = f"{PROSE}\n\n- one\n- two\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nx = 1\n\ny = 2\n```\n\n---\n"
    blocks = split_blocks(source)
    assert [b.kind for b in blocks] == ["paragraph", "list", "quote", "table", "code", "rule"]
    assert blocks[4].text == "```py\nx = 1\n\ny = 2\n```"
    assert clean(source) == source.strip()


def test_headline_h1_before_prose_is_dropped_even_when_it_differs_from_the_seo_title():
    # Live Science: <title> is "Euclid telescope unveils …", the on-page H1 is the print headline.
    out = clean(f"# 'Far more than beautiful pictures': Euclid images 900 million galaxies\n\n{PROSE}", title="Euclid telescope unveils photos")
    assert out == PROSE


def test_later_h1_is_demoted_not_dropped():
    out = clean(f"# Headline\n\n{PROSE}\n\n# A second top-level section\n\n{PROSE}")
    assert out == f"{PROSE}\n\n## A second top-level section\n\n{PROSE}"


def test_h2_headline_is_dropped_only_when_it_matches_the_title():
    assert clean(f"## The Big Story\n\n{PROSE}", title="The Big Story | Example") == PROSE
    assert clean(f"## Background\n\n{PROSE}", title="The Big Story | Example") == f"## Background\n\n{PROSE}"


def test_leading_link_only_lines_are_removed_but_the_same_link_inside_prose_is_kept():
    # Space.com: kicker, byline and a CTA ahead of the first paragraph.
    out = clean(f"[News](https://www.space.com/news)\n\n[Robert Lea](https://www.space.com/author/robert-lea)\n\n{PROSE}\n\n[Follow us](https://google.com/preferences/source?q=space.com)")
    assert out == PROSE
    kept = clean(f"{PROSE}\n\n[Read the full report](https://example.com/report)")
    assert kept.endswith("[Read the full report](https://example.com/report)")


def test_skip_links_and_publisher_ad_furniture_are_removed():
    # NYT: "Supported by" + a same-page skip link; the skip link also goes when its text differs.
    out = clean(f"Supported by\n\n[SKIP ADVERTISEMENT](https://www.nytimes.com#after-sponsor)\n\n{PROSE}\n\n[Jump to comments](https://www.nytimes.com/2026/11/08/technology/story.html#comments)\n\nAdvertisement")
    assert out == PROSE


def test_a_real_link_to_another_site_with_a_fragment_is_kept():
    text = f"{PROSE}\n\nSee [the filing](https://www.sec.gov/doc.htm#page=4) for the figures in the long form of this particular sentence."
    assert clean(text) == text


def test_avatars_and_the_comment_gate_are_removed_but_figures_stay():
    out = clean(
        f"{PROSE}\n\n![Harry Baker's avatar](https://cdn.example.com/a.jpg)\n\n![An artist's illustration of Roman](https://cdn.example.com/b.jpg)\n\n{PROSE}\n\n"
        "You must confirm your public display name before commenting\n\n"
        "Please logout and then login again, you will then be prompted to enter your display name.")
    assert "avatar" not in out and "display name" not in out
    assert "![An artist's illustration of Roman](https://cdn.example.com/b.jpg)" in out


def test_chrome_sections_are_removed_through_the_next_heading_of_equal_rank():
    out = clean(f"{PROSE}\n\n## Related articles\n\n- [One](https://e.com/1)\n- [Two](https://e.com/2)\n\n### Detail inside\n\nstuff\n\n## Methods\n\n{PROSE}")
    assert out == f"{PROSE}\n\n## Methods\n\n{PROSE}"


def test_empty_and_repeated_headings_and_carousel_residue_go():
    # Blue Bottle: "### Share", the same heading twice, "Slide 1(Current Slide)…".
    out = clean(f"{PROSE}\n\n## Pour Over Instructions\n\n## Pour Over Instructions\n\n- Slide 1(Current Slide)\n- Slide 2\n- Slide 3\n\n### Share\n")
    assert out == PROSE
    kept = clean(f"## Method\n\n{PROSE}\n\n## Method\n\n{PROSE}")
    assert kept.count("## Method") == 2


def test_underline_markup_around_links_is_unwrapped_but_code_is_left_alone():
    out = clean(f"{PROSE} Read [<u>NASA</u>](https://www.nasa.gov) today.\n\n```html\n<u>keep</u>\n```")
    assert "[NASA](https://www.nasa.gov)" in out and "<u>keep</u>" in out and "<u>NASA" not in out


def test_list_boilerplate_items_are_dropped_from_a_list_that_keeps_its_content():
    # ScienceDaily's Date / Source / Summary / Share definition list.
    out = clean(f"{PROSE}\n\n- Date:\n- November 10, 2026\n- Source:\n- Caltech\n- Share:\n")
    assert out.endswith("- Date:\n- November 10, 2026\n- Source:\n- Caltech")


def test_byline_lines_before_the_first_paragraph_are_removed():
    assert clean(f"By Jane Roe\n\nUpdated Nov. 12, 2026\n\n{PROSE}") == PROSE
    assert "By Jane Roe" in clean(f"{PROSE}\n\nBy Jane Roe")


def test_truncation_happens_on_a_block_boundary_and_is_reported():
    paragraphs = [f"Paragraph {i}. {PROSE}" for i in range(40)]
    out, truncated = clean_markdown("\n\n".join(paragraphs), page_url=PAGE, max_chars=1000)
    assert truncated and len(out) <= 1000
    assert out.endswith(PROSE) and out.count("Paragraph") == len(out.split("\n\n"))


def test_plain_length_ignores_link_destinations():
    link = "[word](https://example.com/" + "x" * 500 + ")"
    assert plain_length(link) == len("[word]")


@pytest.mark.parametrize("source,expected", [
    ("see [this](<javascript:alert(1)>).", "see this."),
    ("[x](JaVaScRiPt:alert(1)) ok", "[x] ok"),  # an inert label is all that is left; there is no destination
    ("[a](vbscript:x) [b](file:///etc/passwd) [c](blob:https://x/1)", "a b c"),
    ("[d](//cdn.example.com/x) [e](/relative) [f](#frag) [g]()", "d e f g"),
    ("![p](data:image/gif;base64,AAAA)!", "!"),
    ("![insecure](http://i.example.com/a.png) ![ok](https://i.example.com/a.png)", " ![ok](https://i.example.com/a.png)"),
    ("[![a](https://i.example.com/x.png)](javascript:evil())", "[![a](https://i.example.com/x.png)]"),
    ('[g](https://example.com/p "Title") [h](<https://example.com/a b>) [m](mailto:a@b.co) [p](http://e.com/a_(b))',
     '[g](https://example.com/p "Title") [h](<https://example.com/a b>) [m](mailto:a@b.co) [p](http://e.com/a_(b))'),
])
def test_only_http_https_and_mailto_destinations_survive(source, expected):
    assert safe_destinations(source) == expected


def test_unsafe_destinations_are_removed_inside_cleaned_articles_but_not_inside_code():
    out = clean(f"{PROSE} Click [here](javascript:alert(1)) or [there](https://e.com/ok).\n\n```\n[x](javascript:keep)\n```")
    assert "javascript:alert" not in out and "[there](https://e.com/ok)" in out and "[x](javascript:keep)" in out


@pytest.mark.parametrize("line", [
    "Article continues below this ad",          # Austin American-Statesman, mid-body
    "Story continues below advertisement",
    "Content continues after advertisement",
    "Scroll to continue reading",
    "Skip advertisement",
    "This ad will close in 5 seconds",
    "Advertisement",
    "More from IndieWire",
    "Read more: [Council approves plan](https://e.com/plan)",
    "Watch next",
])
def test_ad_and_promo_furniture_is_removed_wherever_it_sits_in_the_body(line):
    assert clean(f"{PROSE}\n\n{line}\n\n{PROSE} Second.") == f"{PROSE}\n\n{PROSE} Second."


@pytest.mark.parametrize("line", [
    "Projected record: 54-28",
    "Chances to make the conference finals: 58.5%",
    "*Stock Advisor returns as of November 13, 2026.",
    "Here are the results:",
    "Continues to be a problem in the region for many farmers across the state.",   # real prose, over ten words and not an ad
    "The advertisement industry grew.",
    "Read the filing",
])
def test_legitimate_short_lines_are_not_mistaken_for_furniture(line):
    text = f"{PROSE}\n\n{line}\n\n{PROSE}"
    assert clean(text) == text


def test_a_more_from_section_is_removed_with_its_links():
    out = clean(f"{PROSE}\n\n## More from IndieWire\n\n- [One](https://e.com/1)\n- [Two](https://e.com/2)\n\n## Verdict\n\n{PROSE}")
    assert out == f"{PROSE}\n\n## Verdict\n\n{PROSE}"
