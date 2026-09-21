"""
LanceDB Vector Store for Persistent Memory
Pattern from: persistent-memory.md lines 22-27
"""

import os
from llama_index.core import VectorStoreIndex, StorageContext
from llama_index.vector_stores.lancedb import LanceDBVectorStore


class MemoryStore:
    """LanceDB-backed conversation memory with vector search"""

    def __init__(self, db_path: str = "./lancedb", table_name: str = "chat_history"):
        """Initialize LanceDB vector store with LlamaIndex"""
        self.vector_store = LanceDBVectorStore(uri=db_path, table_name=table_name)
        self.storage_context = StorageContext.from_defaults(vector_store=self.vector_store)
        self.index = VectorStoreIndex([], storage_context=self.storage_context)

    def retrieve_context(self, query: str, top_k: int = 3) -> list:
        """Retrieve top k relevant historical interactions"""
        retriever = self.index.as_retriever(similarity_top_k=top_k)
        context_nodes = retriever.retrieve(query)
        return context_nodes

    def store_interaction(self, query: str, response: str):
        """Store user query and response as vector embedding"""
        from llama_index.core.schema import Document

        doc = Document(
            text=f"Q: {query}\nA: {response}",
            metadata={"query": query, "response": response}
        )
        self.index.insert(doc)
