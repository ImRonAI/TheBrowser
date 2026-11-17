#!/bin/bash
# Temporary: runs the skills.sh find-skills search for each query in queries.txt.
cd "$(dirname "$0")"
export NO_COLOR=1 CI=1
out=find2.txt
: > "$out"
while IFS= read -r q; do
  [ -z "$q" ] && continue
  echo "######## $q" >> "$out"
  npx -y skills find $q 2>&1 | sed $'s/\x1b\\[[0-9;]*[a-zA-Z]//g' | grep -v '^[[:space:]]*$' | grep -v '[█╗╔╝╚═║]' >> "$out"
done < queries.txt
echo DONE >> "$out"
