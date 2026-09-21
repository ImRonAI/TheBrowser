import yaml
import json
from pathlib import Path

# Fix the openEMR YAML spec
spec_path = Path("/Users/timhunter/Library/Mobile Documents/com~apple~CloudDocs/ronbrowser/agent/tools/src/strands_tools/healthcare/openEMR.yml")

with open(spec_path, "r") as f:
    spec = yaml.safe_load(f)

# The linter gave us two main errors: missing summary and bad security format
# [96] agent/tools/src/strands_tools/healthcare/openEMR.yml:1960:25 at #/paths/~1api~1patient~1{pid}~1medication~1{mid}/delete/security/0/openemr_auth
# Expected type `array` but got `object`.
# 1958 |   security:
# 1959 |     -
# 1960 |       openemr_auth: {  }
#
# [97] agent/tools/src/strands_tools/healthcare/openEMR.yml:2026:5 at #/paths/~1api~1patient~1{pid}~1message/post/summary
# Operation object should contain `summary` field.

paths = spec.get("paths", {})
for path, methods in paths.items():
    for method, op in methods.items():
        if method in ["get", "post", "put", "delete", "patch"]:
            # 1. Add summary if missing, using description or a default
            if "summary" not in op:
                op["summary"] = op.get("description", f"{method.upper()} {path}")
            
            # 2. Fix security format
            if "security" in op:
                new_sec = []
                for sec_req in op["security"]:
                    if "openemr_auth" in sec_req:
                        # Ensure it's an array, not a dict/object
                        if isinstance(sec_req["openemr_auth"], dict):
                            sec_req["openemr_auth"] = []
                            new_sec.append(sec_req)
                        else:
                            new_sec.append(sec_req)
                    else:
                        new_sec.append(sec_req)
                op["security"] = new_sec

# Save it back
with open(spec_path, "w") as f:
    yaml.dump(spec, f, sort_keys=False)

print("Finished fixing openEMR.yml")
