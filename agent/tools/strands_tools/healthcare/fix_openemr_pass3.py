import yaml
import json
import re
from pathlib import Path

# Fix the openEMR YAML spec
spec_path = Path("/Users/timhunter/Library/Mobile Documents/com~apple~CloudDocs/ronbrowser/agent/tools/src/strands_tools/healthcare/openEMR.yml")

with open(spec_path, "r") as f:
    spec = yaml.safe_load(f)

# Fix mismatched path parameters
paths = spec.get("paths", {})
new_paths = {}
sig_map = {}

for path, methods in paths.items():
    
    # Generic normalization for conflict detection
    # Replace all {...} with {}
    sig = re.sub(r'\{[^}]+\}', '{}', path)
    
    path_vars = re.findall(r'\{([^}]+)\}', path)
    
    # Pre-process the parameters arrays to fix naming before we merge
    for method, op in methods.items():
        if method in ["get", "post", "put", "delete", "patch"]:
            
            # Check the operation parameters
            if "parameters" in op:
                defined_path_params = []
                for param in op["parameters"]:
                    if param.get("in") == "path":
                        param_name = param.get("name")
                        defined_path_params.append(param_name)
                        
                        # If the defined parameter name is NOT in the path variables
                        if param_name and param_name not in path_vars:
                            if "puuid" in path_vars and param_name == "pid":
                                param["name"] = "puuid"
                            elif "pid" in path_vars and param_name == "puuid":
                                param["name"] = "pid"
                            elif "uuid" in path_vars and param_name == "insuranceUuid":
                                param["name"] = "uuid"
                            elif len(path_vars) == 1:
                                param["name"] = path_vars[0]

                # Now check the reverse: are there path variables missing from parameters?
                current_defined = [p.get("name") for p in op["parameters"] if p.get("in") == "path"]
                for p_var in path_vars:
                    if p_var not in current_defined:
                        op["parameters"].append({
                            "name": p_var,
                            "in": "path",
                            "description": f"The {p_var} identifier.",
                            "required": True,
                            "schema": {"type": "string"}
                        })
                        
    # Identical paths conflict resolution
    if sig not in sig_map:
        new_paths[path] = methods
        sig_map[sig] = path
    else:
        # Conflict! A path with this signature already exists.
        existing_path = sig_map[sig]
        print(f"Skipping identical path: {path} (merging into {existing_path})")
        # Go through methods in the duplicate path, and see if we can merge them into the existing path.
        # Note: if we merge them, the existing path's path_vars apply to the operation. 
        # But we already fixed the parameter names for the duplicate path base on ITS path_vars. 
        # So we should probably rename its parameters one last time to match the existing path's vars.
        
        existing_path_vars = re.findall(r'\{([^}]+)\}', existing_path)
        
        for method, op in methods.items():
            if method not in new_paths[existing_path]:
                # Force rename the parameters to match the existing path if we're merging it
                if "parameters" in op:
                    path_params = [p for p in op["parameters"] if p.get("in") == "path"]
                    # If the number of variables match, rename them sequentially
                    if len(path_params) == len(existing_path_vars):
                        for i, p in enumerate(path_params):
                            p["name"] = existing_path_vars[i]
                            
                new_paths[existing_path][method] = op

spec["paths"] = new_paths

# Save it back
with open(spec_path, "w") as f:
    yaml.dump(spec, f, sort_keys=False)

print("Finished fixing openEMR.yml (pass 3)")
