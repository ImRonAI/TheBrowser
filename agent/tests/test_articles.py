import asyncio
import json
import socket

import httpx
import pytest
from pydantic import ValidationError

from agent.api.core import articles
from agent.api.endpoints.chat import ChatRequest


def attachment(**updates):
    return {"id": "article-1", "title": "Reference", "source": "example.com", "url": "https://example.com/story",
            "text": "The complete reference text.", "status": "extracted", **updates}


@pytest.mark.parametrize("url", ["http://example.com", "file:///etc/passwd", "https://user:pass@example.com", "https://example.com:8443"])
def test_reader_rejects_unsafe_url_shapes(url):
    with pytest.raises(ValueError):
        asyncio.run(articles.public_address(url))


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "224.0.0.1"])
def test_reader_rejects_private_dns(monkeypatch, address):
    async def scenario():
        async def resolve(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
        monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
        with pytest.raises(ValueError):
            await articles.public_address("https://example.com/story")
    asyncio.run(scenario())


PARA = ("The city council voted on Tuesday to approve a long-debated transit plan, ending nearly three years of argument "
        "over routes, funding and the pace of construction across the metropolitan region. ")
PAGE_HTML = f"""<html lang="en"><head><title>Council approves transit plan | Example Times</title>
<meta property="og:image" content="/img/hero.jpg"><meta property="og:site_name" content="Example Times">
<meta name="author" content="Jane Roe; John Poe"><meta property="article:published_time" content="2026-11-12T08:00:00Z">
<meta name="description" content="A summary of the vote."></head><body><nav><a href="/home">Home</a><a href="/sports">Sports</a></nav>
<article><h1>Council approves transit plan</h1><p class="byline">By <a href="/authors/jane">Jane Roe</a></p>
<p>{PARA}See <a href="/2026/plan">the plan</a>, the <a href="https://sec.example.org/filing#p4">filing</a> and <a href="javascript:alert(1)">this</a>.</p>
<figure><img src="/img/map.png" alt="Route map"><figcaption>The approved routes.</figcaption></figure>
<h2>What changes</h2><ol><li>Faster <b>buses</b></li><li>A new <a href="/rail">rail line</a></li></ol>
<blockquote><p>"This is overdue," said the mayor.</p><p>Second paragraph of the quote.</p></blockquote>
<table><tr><th>Line</th><th>Year</th></tr><tr><td>Blue</td><td>2029</td></tr></table>
<p>{PARA}</p><script>stealCookies()</script><aside>Advertisement: buy now</aside>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pixel"></article><footer>Copyright</footer></body></html>"""


def test_the_real_pipeline_turns_a_page_into_safe_rich_markdown_with_metadata():
    article = articles.article_from_html(PAGE_HTML.encode(), "https://news.example.com/2026/11/story")
    text = article["text"]
    # structure the old plain-text extractor flattened
    assert "[the plan](https://news.example.com/2026/plan)" in text            # relative link made absolute
    assert "[filing](https://sec.example.org/filing#p4)" in text               # external fragment link kept
    assert "![Route map](https://news.example.com/img/map.png)" in text
    assert "\n## What changes\n" in text and "1. Faster **buses**" in text and "2. A new [rail line](https://news.example.com/rail)" in text
    assert '> "This is overdue," said the mayor.\n>\n> Second paragraph of the quote.' in text
    assert "| Blue | 2029 |" in text
    # what must never reach the renderer, an agent attachment or a Context item
    assert "javascript:" not in text and "stealCookies" not in text and "Advertisement: buy now" not in text
    assert "data:image" not in text and "Copyright" not in text and "Home" not in text
    assert not text.lstrip().startswith("#")                                   # the headline is the reader's, not the body's
    assert article["format"] == "markdown" and article["status"] == "extracted" and not article["truncated"]
    assert article["authors"] == ["Jane Roe", "John Poe"] and article["published"] == "2026-11-12"
    assert article["site_name"] == "Example Times" and article["description"] == "A summary of the vote."
    assert article["image"] == "https://news.example.com/img/hero.jpg"


def test_metadata_image_must_be_https_and_text_must_be_substantial():
    insecure = PAGE_HTML.replace('content="/img/hero.jpg"', 'content="http://cdn.example.com/hero.jpg"')
    assert articles.article_from_html(insecure, "https://news.example.com/s")["image"] is None
    with pytest.raises(ValueError):
        articles.article_from_html("<html><body><article><p>Too short to be an article.</p></article></body></html>", "https://news.example.com/s")


def test_fetch_pins_ip_and_revalidates_redirect(monkeypatch):
    seen = []
    async def address(url):
        seen.append(url)
        if 'internal' in url:
            raise ValueError('private address')
        return 'example.com', '93.184.216.34'
    def respond(request):
        assert request.url.host == '93.184.216.34'
        assert request.headers['host'] == 'example.com'
        assert request.extensions['sni_hostname'] == 'example.com'
        return httpx.Response(302, headers={'location': 'https://internal/secret'})
    client = httpx.AsyncClient
    monkeypatch.setattr(articles, 'public_address', address)
    monkeypatch.setattr(articles.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    with pytest.raises(ValueError):
        asyncio.run(articles.extract_article('https://example.com/story'))
    assert seen == ['https://example.com/story', 'https://internal/secret']


@pytest.mark.parametrize('content,content_type', [(b'x' * (articles.MAX_BYTES + 1), 'text/html'), (b'pdf', 'application/pdf')])
def test_fetch_enforces_type_and_size(monkeypatch, content, content_type):
    async def address(url):
        return 'example.com', '93.184.216.34'
    client = httpx.AsyncClient
    monkeypatch.setattr(articles, 'public_address', address)
    monkeypatch.setattr(articles.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=content, headers={'content-type': content_type})), **kwargs))
    with pytest.raises(ValueError):
        asyncio.run(articles.extract_article('https://example.com/story'))


def test_attachment_validation_and_native_blocks():
    article = articles.ArticleAttachment(**attachment())
    blocks = articles.article_message('My actual question', [article])
    assert blocks[0] == {'text': 'My actual question'}
    assert json.loads(blocks[1]['text'][len(articles.ARTICLE_PREFIX):]) == attachment()
    for updates in ({'url': 'javascript:alert(1)'}, {'text': 'x' * 60001}, {'status': 'full'}):
        with pytest.raises(ValidationError):
            articles.ArticleAttachment(**attachment(**updates))
    with pytest.raises(ValidationError):
        ChatRequest(session_id='session', action='checkpoint_resume', attachments=[article])