#!/usr/bin/env python3
"""
CLI runner for Perplexity Agent API.
Allows executing agent runs with full configuration:
- Model override or multi-model fallback chain
- Preset override with customized max_steps
- Background execution with optional auto-polling
- Tool enablement (web_search, sandbox, fetch_url, finance_search, people_search, mcp)
- Skill enablement (built-in office, custom skills, inline skills)
- Automatic sandbox file downloading
"""

import os
import sys
import json
import argparse
from perplexity_client import PerplexityAgentClient


def main():
    parser = argparse.ArgumentParser(
        description="Run Perplexity Agent API requests with flexible models, tools, and presets."
    )

    # Core Prompt / Input
    parser.add_argument(
        "-p", "--prompt", type=str, help="Input prompt text. If omitted, reads from stdin."
    )
    parser.add_argument(
        "--file-prompt", type=str, help="Path to file containing input prompt text."
    )
    parser.add_argument(
        "--instructions", type=str, help="System instructions / prompt."
    )

    # Preset & Models
    parser.add_argument(
        "--preset",
        type=str,
        default=None,
        choices=["fast", "low", "medium", "high", "xhigh"],
        help="Agent preset configuration (e.g., 'fast', 'medium', 'high').",
    )
    parser.add_argument(
        "-m",
        "--model",
        type=str,
        default=None,
        help="Single model identifier (e.g., 'anthropic/claude-3-7-sonnet', 'openai/gpt-4o').",
    )
    parser.add_argument(
        "--fallback-models",
        "--models",
        nargs="+",
        default=None,
        help="Fallback model chain (up to 5 models in priority order).",
    )

    # Loop bound / Steps
    parser.add_argument(
        "--steps",
        "--max-steps",
        dest="max_steps",
        type=int,
        default=None,
        help="Maximum research loop steps (1-100). Overrides preset default.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=None,
        help="Max output tokens (required for Anthropic models).",
    )

    # Execution Mode
    parser.add_argument(
        "--background",
        action="store_true",
        help="Run agent in background mode (asynchronous).",
    )
    parser.add_argument(
        "--wait",
        action="store_true",
        help="If --background is set, poll automatically until the response completes.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Polling timeout in seconds when waiting for background runs (default: 300s).",
    )

    # Tools
    parser.add_argument(
        "--tools",
        nargs="+",
        default=[],
        choices=[
            "web_search",
            "fast_search",
            "sandbox",
            "fetch_url",
            "finance_search",
            "people_search",
        ],
        help="List of built-in tools to enable.",
    )
    parser.add_argument(
        "--search-domains",
        nargs="+",
        default=None,
        help="Domain filter allowlist for web_search.",
    )

    # Skills
    parser.add_argument(
        "--skills",
        nargs="+",
        default=[],
        help="Skills to enable (e.g. 'office', 'office/pdf', 'office/docx', or custom skill IDs).",
    )

    # File Generation & Output
    parser.add_argument(
        "--download-files",
        type=str,
        default=None,
        help="Directory to save any files produced by sandbox code execution.",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default=None,
        help="File path to save the full raw JSON response.",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=None,
        help="Explicit Perplexity API Key (defaults to env PERPLEXITY_API_KEY).",
    )
    parser.add_argument(
        "--list-models",
        action="store_true",
        help="List all available models and exit.",
    )

    args = parser.parse_args()

    client = PerplexityAgentClient(api_key=args.api_key)

    # Quick list-models option
    if args.list_models:
        try:
            models = client.list_models()
            print(f"Total models available: {len(models)}\n")
            for m in models:
                mid = m.get("id")
                created = m.get("created")
                print(f"  - {mid}")
            sys.exit(0)
        except Exception as e:
            sys.stderr.write(f"Error fetching models: {e}\n")
            sys.exit(1)

    # Determine prompt text
    prompt = args.prompt
    if not prompt and args.file_prompt:
        with open(args.file_prompt, "r") as f:
            prompt = f.read()
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read().strip()

    if not prompt:
        parser.print_help()
        sys.stderr.write("\nError: Please provide a prompt via -p/--prompt or stdin.\n")
        sys.exit(1)

    # Configure tools
    enable_web_search = False
    if "web_search" in args.tools:
        if args.search_domains:
            enable_web_search = {
                "search_type": "web",
                "filters": {"search_domain_filter": args.search_domains},
            }
        else:
            enable_web_search = True
    elif "fast_search" in args.tools:
        enable_web_search = {"search_type": "fast"}

    enable_sandbox = "sandbox" in args.tools
    enable_fetch_url = "fetch_url" in args.tools
    enable_finance_search = "finance_search" in args.tools
    enable_people_search = "people_search" in args.tools

    sys.stderr.write("[*] Dispatching request to Perplexity Agent API...\n")
    if args.preset:
        sys.stderr.write(f"    Preset: {args.preset}\n")
    if args.fallback_models:
        sys.stderr.write(f"    Fallback Models: {', '.join(args.fallback_models)}\n")
    elif args.model:
        sys.stderr.write(f"    Model: {args.model}\n")
    if args.max_steps:
        sys.stderr.write(f"    Max Steps Override: {args.max_steps}\n")
    if args.skills:
        sys.stderr.write(f"    Skills: {', '.join(args.skills)}\n")
    if args.background:
        sys.stderr.write(f"    Mode: Background (Async)\n")

    try:
        response = client.create_agent(
            input_data=prompt,
            preset=args.preset,
            model=args.model,
            fallback_models=args.fallback_models,
            max_steps=args.max_steps,
            max_output_tokens=args.max_tokens,
            background=args.background,
            instructions=args.instructions,
            enable_web_search=enable_web_search,
            enable_sandbox=enable_sandbox,
            enable_fetch_url=enable_fetch_url,
            enable_finance_search=enable_finance_search,
            enable_people_search=enable_people_search,
            skills=args.skills if args.skills else None,
            poll_until_complete=args.wait,
            poll_timeout_sec=args.timeout,
            download_files_dir=args.download_files,
        )

        response_id = response.get("id")
        status = response.get("status")

        if args.background and not args.wait:
            sys.stderr.write(f"[+] Background job submitted successfully!\n")
            print(f"Response ID: {response_id}")
            print(f"Status: {status}")
            print(f"Check status with: python3 scripts/run_agent.py --retrieve {response_id}")
            return

        # Output result
        sys.stderr.write(f"\n[+] Agent Run Finished. Status: {status}\n")
        output_items = response.get("output", [])
        text_outputs = []

        for item in output_items:
            item_type = item.get("type")
            if item_type == "message":
                content = item.get("content", [])
                for c in content:
                    if c.get("type") == "text":
                        text_outputs.append(c.get("text", ""))

        if text_outputs:
            print("\n".join(text_outputs))
        else:
            # Fallback to dumping the whole output list if not simple message
            print(json.dumps(output_items, indent=2))

        # Check for files
        if response_id:
            files = client.list_response_files(response_id)
            if files:
                sys.stderr.write(f"\n[+] Generated Files ({len(files)}):\n")
                for f in files:
                    sys.stderr.write(f"  - {f.get('filename')} (ID: {f.get('id')})\n")
                if args.download_files:
                    sys.stderr.write(f"  Saved to: {args.download_files}\n")

        # Save JSON if requested
        if args.output_json:
            with open(args.output_json, "w") as f:
                json.dump(response, f, indent=2)
            sys.stderr.write(f"[+] Full JSON saved to {args.output_json}\n")

    except Exception as e:
        sys.stderr.write(f"\n[-] Error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
