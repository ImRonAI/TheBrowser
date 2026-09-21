import yaml
import json
import re
from pathlib import Path

# Fix the openEMR YAML spec
spec_path = Path("/Users/timhunter/Library/Mobile Documents/com~apple~CloudDocs/ronbrowser/agent/tools/src/strands_tools/healthcare/openEMR.yml")

with open(spec_path, "r") as f:
    spec = yaml.safe_load(f)

# Fix mismatched path parameters
# Redocly reported:
# Path parameter `pid` is not used in the path `/api/patient/{puuid}/employer`.
# The operation does not define the path parameter `{puuid}` expected by path `/api/patient/{puuid}/employer`.

paths = spec.get("paths", {})
new_paths = {}

for path, methods in paths.items():
    
    # 1. Fix duplicated or confusing path variables:
    # If the path has {puuid}, but the parameters define 'pid', we should rename the parameter
    # to match the path.
    
    # Find all {var_name} in the path
    path_vars = re.findall(r'\{([^}]+)\}', path)
    
    for method, op in methods.items():
        if method in ["get", "post", "put", "delete", "patch"]:
            
            # Check the operation parameters
            if "parameters" in op:
                for param in op["parameters"]:
                    if param.get("in") == "path":
                        param_name = param.get("name")
                        
                        # If the defined parameter name is NOT in the path variables
                        if param_name and param_name not in path_vars:
                            # Heuristic: if path has {puuid} and param is 'pid', rename param to 'puuid'
                            if "puuid" in path_vars and param_name == "pid":
                                param["name"] = "puuid"
                            # Heuristic: if path has {pid} and param is 'puuid', rename param to 'pid'
                            elif "pid" in path_vars and param_name == "puuid":
                                param["name"] = "pid"
                            # Otherwise, if there is exactly 1 path variable, just rename the param to match it
                            elif len(path_vars) == 1:
                                param["name"] = path_vars[0]
            
            # 2. Check global path parameters (if any)
            # (OpenEMR doesn't seem to use them, but just in case)
            pass

    
    # Check for identical paths
    # /api/patient/{pid}/insurance and /api/patient/{puuid}/insurance are technically the same
    # We should normalize them. Let's convert all {puuid} to {pid} in paths to avoid collisions.
    normalized_path = path.replace("{puuid}", "{pid}")
    
    if normalized_path not in new_paths:
        new_paths[normalized_path] = methods
    else:
        # Merge methods if the path already exists
        for method, op in methods.items():
            if method not in new_paths[normalized_path]:
                new_paths[normalized_path][method] = op
            else:
                # Conflict! Keep the original one for now.
                pass

spec["paths"] = new_paths


# Save it back
with open(spec_path, "w") as f:
    yaml.dump(spec, f, sort_keys=False)

print("Finished fixing openEMR.yml (pass 2)")
