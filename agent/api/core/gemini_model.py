"""Gemini model whose tool results carry their images as multimodal function-response parts.

Extends the vended ``strands.models.gemini.GeminiModel`` (subclass and override, as ``mistral_model`` and
``xai_model`` do). The vended formatter turns every non-json tool-result item into ``Part.to_json_dict()``
inside ``FunctionResponse.response`` (``strands/models/gemini.py:189-206``), so an image reaches the model as
base64 text in a JSON value, not as an image. The Gemini API documents the native form: "For Gemini 3 series
models, you can include multimodal content in the function response parts that you send to the model … include
it as one or more parts nested within the ``functionResponse`` part. Each multimodal part must contain either
``inlineData`` … or ``fileData``"; images ``image/png``, ``image/jpeg``, ``image/webp``
(https://aistudio.google.com/docs/function-calling?generate-content=true#multimodal). google-genai 2.24.0 has
``FunctionResponse.parts: list[FunctionResponsePart]`` with ``inline_data: FunctionResponseBlob``.

This subclass moves a tool result's images into ``FunctionResponse.parts`` for the models
``media_capabilities`` marks as Gemini 3 series with image input; text/json stay in ``response`` as before.
"""
from __future__ import annotations

from typing import Any

from google import genai
from strands.models.gemini import GeminiModel
from strands.types.content import ContentBlock
from typing_extensions import override

from agent.api.core.media_capabilities import media_capability

#: Image MIME types the documentation lists for function-response parts.
FUNCTION_RESPONSE_IMAGE_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "webp": "image/webp"}


class RonGeminiModel(GeminiModel):
    """``GeminiModel`` that sends tool-result images as ``FunctionResponse.parts`` on Gemini 3 series models."""

    @override
    def _format_request_content_part(self, content: ContentBlock, tool_use_id_to_name: dict[str, str]) -> genai.types.Part:
        if "toolResult" not in content or not media_capability("gemini", self.config["model_id"]).tool_result_images:
            return super()._format_request_content_part(content, tool_use_id_to_name)
        result = content["toolResult"]
        images = [item for item in result["content"]
                  if "image" in item and item["image"]["format"] in FUNCTION_RESPONSE_IMAGE_TYPES]
        if not images:
            return super()._format_request_content_part(content, tool_use_id_to_name)
        rest: list[Any] = [item for item in result["content"] if not any(item is image for image in images)]
        part = super()._format_request_content_part({"toolResult": {**result, "content": rest}}, tool_use_id_to_name)
        if part.function_response is None:
            raise TypeError("toolResult did not format as a function response")
        part.function_response.parts = [
            genai.types.FunctionResponsePart(inline_data=genai.types.FunctionResponseBlob(
                mime_type=FUNCTION_RESPONSE_IMAGE_TYPES[item["image"]["format"]], data=item["image"]["source"]["bytes"]))
            for item in images
        ]
        return part


__all__ = ["FUNCTION_RESPONSE_IMAGE_TYPES", "RonGeminiModel"]
