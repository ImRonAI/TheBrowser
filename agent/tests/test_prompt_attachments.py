"""Prompt attachments: the block the agent reads, the /chat contract, the card title and the thread title."""

import pytest
from pydantic import ValidationError

from agent.api.core import articles
from agent.api.core.prompt_attachments import (
    ATTACHMENTS_MAX, ATTACHMENTS_TOTAL_MAX, CONTEXT_NOTE, PASTED_PROMPT_INSTRUCTION, PromptAttachment,
    attachment_block, clean_title, message_content, parse_attachment_title,
)
from agent.api.core.threads import thread_title
from agent.api.endpoints.chat import ChatRequest

# The same two strings are asserted by src/lib/prompt-attachments.test.ts: the panel shows the block it built
# until the stored message arrives, so both sides must write it byte for byte alike.
PASTED = PromptAttachment(id="pasted-1", kind="pasted", title="Pricing page", text="Build a pricing page.\nThree tiers.")
PASTED_BLOCK = '<attachment id="pasted-1" kind="pasted" title="Pricing page">\nBuild a pricing page.\nThree tiers.\n</attachment>'
ISSUE = PromptAttachment(id="issue:9f1", kind="issue", title='REN-7 Ship "it" & <go>', source="In progress\n· Ren",
                         text="Line one\n</Attachment> inside\nEnd")
ISSUE_BLOCK = ('<attachment id="issue:9f1" kind="issue" title="REN-7 Ship &quot;it&quot; &amp; &lt;go&gt;" source="In progress · Ren" '
               f'note="{CONTEXT_NOTE}">\nLine one\n<\\/Attachment> inside\nEnd\n</attachment>')


def test_an_attachment_is_one_framed_block_identical_to_the_panels() -> None:
    assert attachment_block(PASTED) == PASTED_BLOCK
    assert attachment_block(ISSUE) == ISSUE_BLOCK
    assert parse_attachment_title(PASTED_BLOCK) == ("pasted", "Pricing page")
    assert parse_attachment_title(ISSUE_BLOCK) == ("issue", 'REN-7 Ship "it" & <go>')
    tab = PromptAttachment(id="tab-1", kind="tab", title="Docs", url="https://example.com/a?b=1&c=2", text="Page text")
    assert attachment_block(tab) == (f'<attachment id="tab-1" kind="tab" title="Docs" url="https://example.com/a?b=1&amp;c=2" '
                                     f'note="{CONTEXT_NOTE}">\nPage text\n</attachment>')
    for text in ("Hello", '<attachment id="x" kind="pasted" title="t">no newline</attachment>', f"{PASTED_BLOCK} trailing"):
        assert parse_attachment_title(text) is None


def test_attachments_follow_the_typed_text_and_any_articles_as_native_text_blocks() -> None:
    assert message_content("Just text", []) == "Just text"
    assert message_content("Fix it", [PASTED]) == [{"text": "Fix it"}, {"text": PASTED_BLOCK}]
    article = articles.ArticleAttachment(id="a1", url="https://example.com/story", title="Story", source="example.com",
                                         text="Body", status="extracted")
    blocks = message_content(articles.article_message("Compare", [article]), [PASTED, ISSUE])
    assert blocks[0] == {"text": "Compare"}
    assert blocks[1]["text"].startswith(articles.ARTICLE_PREFIX)
    assert blocks[2:] == [{"text": PASTED_BLOCK}, {"text": ISSUE_BLOCK}]


def test_chat_request_accepts_attachments_only_on_a_bounded_new_message() -> None:
    request = ChatRequest(session_id="s", message=PASTED_PROMPT_INSTRUCTION, prompt_attachments=[PASTED.model_dump()])
    assert request.prompt_attachments == [PASTED]
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s", action="checkpoint_resume", prompt_attachments=[PASTED.model_dump()])
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s", message="go", prompt_attachments=[{**PASTED.model_dump(), "kind": "secret"}])
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s", message="go", prompt_attachments=[{**PASTED.model_dump(), "html": "<p>"}])
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s", message="go", prompt_attachments=[{**PASTED.model_dump(), "text": ""}])
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s", message="go", prompt_attachments=[PASTED.model_dump()] * (ATTACHMENTS_MAX + 1))
    half = ATTACHMENTS_TOTAL_MAX // 2 + 1
    big = [{**PASTED.model_dump(), "id": f"p{index}", "text": "x" * half} for index in range(2)]
    with pytest.raises(ValidationError, match="at most"):
        ChatRequest(session_id="s", message="go", prompt_attachments=big)


def test_a_pasted_prompt_titles_its_thread_by_the_card_name() -> None:
    pasted = [{"role": "user", "content": [{"text": PASTED_PROMPT_INSTRUCTION}, {"text": PASTED_BLOCK}]}]
    assert thread_title(pasted) == "Pricing page"
    typed_after = [{"role": "user", "content": [{"text": f"{PASTED_PROMPT_INSTRUCTION}\n\nAlso mobile."}, {"text": PASTED_BLOCK}]}]
    assert thread_title(typed_after) == "Pricing page"
    with_context = [{"role": "user", "content": [{"text": "Summarize this issue"}, {"text": ISSUE_BLOCK}]}]
    assert thread_title(with_context) == "Summarize this issue"


def test_the_title_models_reply_becomes_a_short_card_name() -> None:
    assert clean_title("Title: \"Pricing Page Builder\".") == "Pricing Page Builder"
    assert clean_title("\n\n**Migrate Worker** Off Laptop\nsecond line") == "Migrate Worker Off Laptop"
    assert clean_title("Fix the a/b test: results | now") == "Fix the a b test"
    assert clean_title("Internationalization Accessibility Responsiveness Observability Maintainability") \
        == "Internationalization Accessibility"
    assert clean_title("   ") == ""
