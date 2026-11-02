#!/usr/bin/env python3
"""
CLI tool for Perplexity Agent Skills management.
Supports full lifecycle:
- Create skill from directory (containing SKILL.md) or ZIP file
- List skills with pagination
- Inspect skill metadata
- Upload new revision with expected_revision race-prevention
- List all revisions of a skill
- Download skill bundle
- Delete skill
"""

import sys
import json
import argparse
from perplexity_client import PerplexityAgentClient


def main():
    parser = argparse.ArgumentParser(description="Manage Perplexity Agent Skills.")
    parser.add_argument("--api-key", type=str, default=None, help="Explicit API key.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # list
    list_p = subparsers.add_parser("list", help="List all skills in project.")
    list_p.add_argument("--limit", type=int, default=50, help="Max results (default: 50).")
    list_p.add_argument("--json", action="store_true", help="Output raw JSON.")

    # get
    get_p = subparsers.add_parser("get", help="Get skill details by ID.")
    get_p.add_argument("skill_id", type=str, help="ID of the skill (e.g. skill_...).")
    get_p.add_argument("--revision", type=int, default=None, help="Specific revision number.")
    get_p.add_argument("--json", action="store_true", help="Output raw JSON.")

    # create
    create_p = subparsers.add_parser("create", help="Create a skill from directory or ZIP.")
    create_p.add_argument("--dir", type=str, default=None, help="Directory containing SKILL.md.")
    create_p.add_argument("--zip", type=str, default=None, help="Pre-packaged ZIP file.")

    # update
    update_p = subparsers.add_parser("update", help="Upload a new revision for a skill.")
    update_p.add_argument("skill_id", type=str, help="ID of the skill.")
    update_p.add_argument("--expected-revision", type=int, required=True, help="Current revision number.")
    update_p.add_argument("--dir", type=str, default=None, help="Directory containing SKILL.md.")
    update_p.add_argument("--zip", type=str, default=None, help="Pre-packaged ZIP file.")

    # revisions
    rev_p = subparsers.add_parser("revisions", help="List revisions of a skill.")
    rev_p.add_argument("skill_id", type=str, help="ID of the skill.")
    rev_p.add_argument("--limit", type=int, default=50, help="Max results.")

    # download
    dl_p = subparsers.add_parser("download", help="Download skill ZIP bundle.")
    dl_p.add_argument("skill_id", type=str, help="ID of the skill.")
    dl_p.add_argument("--out", type=str, required=True, help="Destination file path for .zip.")
    dl_p.add_argument("--revision", type=int, default=None, help="Revision to download.")

    # delete
    del_p = subparsers.add_parser("delete", help="Delete a skill.")
    del_p.add_argument("skill_id", type=str, help="ID of the skill.")
    del_p.add_argument("--expected-revision", type=int, required=True, help="Current revision number.")

    args = parser.parse_args()
    client = PerplexityAgentClient(api_key=args.api_key)

    try:
        if args.command == "list":
            skills = client.list_skills(limit=args.limit)
            if args.json:
                print(json.dumps(skills, indent=2))
                return
            print(f"\nSkills in Project ({len(skills)} found):\n")
            print(f"{'Skill ID':<30} {'Name':<25} {'Revision':<10} {'Description'}")
            print("-" * 90)
            for s in skills:
                sid = s.get("id", "")
                name = s.get("name", "")
                rev = str(s.get("revision", ""))
                desc = s.get("description", "")
                if len(desc) > 30:
                    desc = desc[:27] + "..."
                print(f"{sid:<30} {name:<25} {rev:<10} {desc}")

        elif args.command == "get":
            skill = client.get_skill(args.skill_id, revision=args.revision)
            print(json.dumps(skill, indent=2))

        elif args.command == "create":
            res = client.create_skill(zip_path=args.zip, dir_path=args.dir)
            print("[+] Skill created successfully!")
            print(json.dumps(res, indent=2))

        elif args.command == "update":
            res = client.update_skill_revision(
                args.skill_id,
                expected_revision=args.expected_revision,
                zip_path=args.zip,
                dir_path=args.dir,
            )
            print("[+] Skill revision updated successfully!")
            print(json.dumps(res, indent=2))

        elif args.command == "revisions":
            revs = client.list_skill_revisions(args.skill_id, limit=args.limit)
            print(json.dumps(revs, indent=2))

        elif args.command == "download":
            path = client.download_skill(args.skill_id, save_path=args.out, revision=args.revision)
            print(f"[+] Skill bundle downloaded to: {path}")

        elif args.command == "delete":
            res = client.delete_skill(args.skill_id, expected_revision=args.expected_revision)
            print(f"[+] Skill {args.skill_id} deleted successfully.")
            if res:
                print(json.dumps(res, indent=2))

    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
