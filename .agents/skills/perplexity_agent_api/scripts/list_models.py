#!/usr/bin/env python3
"""
List all available models for the Perplexity Agent API.
Fetches from GET /v1/models and presents in a clean, readable table.
"""

import sys
import json
import argparse
from perplexity_client import PerplexityAgentClient


def main():
    parser = argparse.ArgumentParser(description="List available models for Perplexity Agent API.")
    parser.add_argument("--json", action="store_true", help="Output raw JSON format.")
    parser.add_argument("--filter", type=str, default="", help="Filter models by name/provider substring.")
    parser.add_argument("--api-key", type=str, default=None, help="Explicit API key.")
    args = parser.parse_args()

    client = PerplexityAgentClient(api_key=args.api_key)

    try:
        models = client.list_models()
        if args.filter:
            models = [m for m in models if args.filter.lower() in m.get("id", "").lower()]

        if args.json:
            print(json.dumps(models, indent=2))
            return

        print(f"\nAvailable Agent API Models ({len(models)} found):\n")
        print(f"{'Model ID':<45} {'Owner / Provider':<20} {'Created'}")
        print("-" * 80)
        for m in sorted(models, key=lambda x: x.get("id", "")):
            mid = m.get("id", "")
            owner = m.get("owned_by", "") or (mid.split("/")[0] if "/" in mid else "perplexity")
            created = str(m.get("created", ""))
            print(f"{mid:<45} {owner:<20} {created}")
        print("\nNote: You can pass any of these models to --model, or up to 5 models to --fallback-models.")
    except Exception as e:
        sys.stderr.write(f"Error listing models: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
