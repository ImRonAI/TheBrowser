"""
FastAPI Server for Perplexity Sonar Reasoning Pro
Implements concise streaming mode from streaming.md lines 434-527
"""

import os
import uuid
from typing import Dict
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import OpenAI

from .memory_store import MemoryStore


app = FastAPI(title="Perplexity Reasoning Pro Server")

# Session storage: session_id -> MemoryStore
sessions: Dict[str, MemoryStore] = {}


class ChatStartRequest(BaseModel):
    session_id: str = None


class ChatStreamRequest(BaseModel):
    session_id: str
    query: str
    model: str = "sonar-reasoning-pro"


class ConciseStreamHandler:
    """
    Exact pattern from streaming.md lines 434-527
    Handles 4 chunk types: chat.reasoning, chat.reasoning.done, chat.completion.chunk, chat.completion.done
    """

    def __init__(self):
        self.content = ""
        self.reasoning_steps = []
        self.search_results = []
        self.images = []
        self.usage = None

    def process_chunk(self, chunk):
        """Route chunk to appropriate handler"""
        chunk_type = chunk.object

        if chunk_type == "chat.reasoning":
            self.handle_reasoning(chunk)
        elif chunk_type == "chat.reasoning.done":
            self.handle_reasoning_done(chunk)
        elif chunk_type == "chat.completion.chunk":
            self.handle_content(chunk)
        elif chunk_type == "chat.completion.done":
            self.handle_done(chunk)

    def handle_reasoning(self, chunk):
        """Process reasoning updates"""
        delta = chunk.choices[0].delta

        if hasattr(delta, 'reasoning_steps'):
            for step in delta.reasoning_steps:
                self.reasoning_steps.append(step)

    def handle_reasoning_done(self, chunk):
        """Process end of reasoning"""
        if hasattr(chunk, 'search_results'):
            self.search_results = chunk.search_results

        if hasattr(chunk, 'images'):
            self.images = chunk.images

    def handle_content(self, chunk):
        """Process content chunks"""
        delta = chunk.choices[0].delta

        if hasattr(delta, 'content') and delta.content:
            self.content += delta.content

    def handle_done(self, chunk):
        """Process completion"""
        if hasattr(chunk, 'usage'):
            self.usage = chunk.usage

    def get_result(self):
        """Return complete result"""
        return {
            'content': self.content,
            'reasoning_steps': self.reasoning_steps,
            'search_results': self.search_results,
            'images': self.images,
            'usage': self.usage
        }


def create_perplexity_client():
    """Initialize Perplexity API client"""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable not set")

    return OpenAI(
        api_key=api_key,
        base_url="https://api.perplexity.ai"
    )


@app.post("/chat/start")
def start_chat_session(request: ChatStartRequest):
    """Initialize LanceDB session"""
    session_id = request.session_id or str(uuid.uuid4())

    if session_id in sessions:
        return {"session_id": session_id, "status": "existing"}

    # Create new memory store for session
    memory_store = MemoryStore(
        db_path=f"./lancedb_sessions/{session_id}",
        table_name="chat_history"
    )
    sessions[session_id] = memory_store

    return {"session_id": session_id, "status": "created"}


@app.post("/chat/stream")
async def stream_chat(request: ChatStreamRequest):
    """Stream with concise mode + memory retrieval"""
    if request.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found. Call /chat/start first.")

    memory_store = sessions[request.session_id]

    # Retrieve top 3 relevant historical interactions
    context_nodes = memory_store.retrieve_context(request.query, top_k=3)
    context_text = "\n".join([node.text for node in context_nodes])

    # Build messages with context
    messages = []
    if context_text:
        messages.append({
            "role": "system",
            "content": f"Previous conversation context:\n{context_text}"
        })
    messages.append({
        "role": "user",
        "content": request.query
    })

    # Create Perplexity client
    client = create_perplexity_client()

    # Stream generator using exact pattern from docs
    async def generate():
        handler = ConciseStreamHandler()

        try:
            # Create streaming request with concise mode
            stream = client.chat.completions.create(
                model=request.model,
                messages=messages,
                stream=True,
                stream_mode="concise"
            )

            # Process each chunk
            for chunk in stream:
                handler.process_chunk(chunk)

                # Stream chunk to client as SSE
                chunk_data = {
                    "object": chunk.object,
                    "delta": {}
                }

                if chunk.object == "chat.reasoning":
                    if hasattr(chunk.choices[0].delta, 'reasoning_steps'):
                        chunk_data["delta"]["reasoning_steps"] = [
                            {"thought": step.thought, "type": step.type}
                            for step in chunk.choices[0].delta.reasoning_steps
                        ]

                elif chunk.object == "chat.reasoning.done":
                    if hasattr(chunk, 'search_results'):
                        chunk_data["search_results"] = [
                            {"title": r.get("title"), "url": r.get("url")}
                            for r in chunk.search_results[:5]
                        ]

                elif chunk.object == "chat.completion.chunk":
                    if hasattr(chunk.choices[0].delta, 'content'):
                        chunk_data["delta"]["content"] = chunk.choices[0].delta.content

                elif chunk.object == "chat.completion.done":
                    if hasattr(chunk, 'usage'):
                        chunk_data["usage"] = {
                            "total_tokens": chunk.usage.total_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                            "prompt_tokens": chunk.usage.prompt_tokens
                        }

                yield f"data: {chunk_data}\n\n"

            # Store interaction in memory
            result = handler.get_result()
            memory_store.store_interaction(request.query, result['content'])

            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/chat/history/{session_id}")
def get_chat_history(session_id: str):
    """Retrieve conversation history"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    memory_store = sessions[session_id]

    # Retrieve all stored conversations
    try:
        import lancedb
        db = lancedb.connect(f"./lancedb_sessions/{session_id}")
        table = db.open_table("chat_history")
        history = table.to_pandas()[["text", "metadata"]].to_dict(orient="records")
        return {"session_id": session_id, "history": history}
    except Exception as e:
        return {"session_id": session_id, "history": [], "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
