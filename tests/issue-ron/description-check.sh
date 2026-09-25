#!/bin/bash
set -euo pipefail
ab() { agent-browser --session description-ron-regression "$@"; }
trap 'ab close >/dev/null 2>&1 || true' EXIT
ab open http://127.0.0.1:5188/__description-ron
ab fill 'input[placeholder="What should this description say?"]' 'Write a description'
ab find role button click --name 'Write description' --exact
ab wait --text 'Review the description and save changes.'
ab eval 'if(document.querySelector(".tiptap").textContent !== "Complete final description <safe text>.") throw Error("Final chunk lost or unsafe HTML"); if(document.querySelector(".animate-pulse")) throw Error("Waiting animation survived output"); if(document.querySelector(".tiptap").getAttribute("contenteditable") !== "true") throw Error("Editor stayed locked"); "PASS final chunk, escaped text, waiting transition, editor unlocked"'
ab errors