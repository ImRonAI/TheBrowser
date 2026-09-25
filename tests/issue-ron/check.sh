#!/bin/bash
# Start server.mjs first. Requires the agent-browser CLI and installed Chromium.
set -euo pipefail
ab() { agent-browser --session issue-ron-regression "$@"; }
trap 'ab close >/dev/null 2>&1 || true' EXIT
ab open http://127.0.0.1:5188/__issue-ron
ab wait --text 'Ask Ron to work on this issue.'
ab find label 'Message task Ron' fill 'Private task A message'
ab find role button click --name 'Send to Ron' --exact
ab wait --text 'Stop run'
ab find role button click --name 'Toggle pane' --exact
ab find role button click --name 'Toggle pane' --exact
ab wait --text 'Stop run'
ab find role button click --name 'Stop run' --exact
ab wait --text 'Ron · canceled'
echo 'PASS run start, remount persistence, cancellation'
ab find role button click --name 'Switch issue' --exact
ab wait --text 'Ask Ron to work on this issue.'
ab eval 'if(document.body.textContent.includes("Private task A message")) throw Error("Cross-task history leaked"); "PASS task isolation"'
ab find role button click --name 'Switch issue' --exact
ab wait --text 'Ron · canceled'
ab find role button click --name 'Switch account' --exact
ab wait --text 'Ask Ron to work on this issue.'
ab eval 'if(document.body.textContent.includes("Private task A message")) throw Error("Cross-account history leaked"); "PASS account isolation"'
ab find label 'Message task Ron' fill 'Retain pending send across tabs'
ab eval 'window.smoke.defer=true; window.smoke.fail=true'
ab find role button click --name 'Send to Ron' --exact
ab wait --fn 'window.smoke.release !== null'
ab eval 'if(!document.querySelector("textarea").disabled) throw Error("Composer editable during send"); "PASS pending composer guard"'
ab find role button click --name 'Toggle pane' --exact
ab eval 'window.smoke.release(); window.smoke.defer=false'
ab wait --fn 'window.smoke.release === null'
ab find role button click --name 'Toggle pane' --exact
ab wait --text 'Ask Ron to work on this issue.'
ab eval 'if(document.querySelector("textarea").value !== "Retain pending send across tabs") throw Error("Draft lost"); if(![...document.querySelectorAll("button")].find(b=>b.textContent==="Send to Ron").disabled) throw Error("Unmount during send lost retry gate"); "PASS pending-send retry gate survives unmount"'
ab eval 'window.smoke.fail=false; window.smoke.failRead=true'
ab find role button click --name 'Refresh conversation' --exact
ab wait --text 'Synthetic read failure'
ab eval 'if(![...document.querySelectorAll("button")].find(b=>b.textContent==="Send to Ron").disabled) throw Error("Failed refresh ungated retry"); "PASS failed refresh guard"'
ab eval 'window.smoke.failRead=false'
ab find role button click --name 'Refresh conversation' --exact
ab wait --fn '[...document.querySelectorAll("button")].some(b=>b.textContent==="Send to Ron" && !b.disabled)'
ab find role button click --name 'Toggle dirty' --exact
ab eval 'if(![...document.querySelectorAll("button")].find(b=>b.textContent==="Send to Ron").disabled) throw Error("Dirty draft sent"); "PASS dirty guard"'
ab set viewport 390 844
ab eval 'if(document.documentElement.scrollWidth > innerWidth) throw Error("Horizontal overflow"); "PASS mobile layout"'
ab errors
echo 'BROWSER_SMOKE_PASS'