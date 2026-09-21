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


def test_extraction_keeps_text_not_executable_markup():
    parser = articles.ArticleParser()
    parser.feed('<nav>Ignore</nav><article><h1>Title</h1><p>Hello &amp; <b>world</b>.</p><script>evil()</script><aside>advertisement</aside><p>Next.</p></article>')
    assert parser.text() == 'Title\n\nHello & world.\n\nNext.'


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