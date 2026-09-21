"""Security utilities for Forge API."""

import json
import os
import re
from typing import Any


class PolicyEnforcer:
    """Enforce allowlist policies for API operations."""
    
    def __init__(self, policy_path: str):
        self.policy_path = policy_path
        self.policy = self._load_policy()
    
    def _load_policy(self) -> dict[str, Any]:
        """Load policy from file."""
        if not os.path.exists(self.policy_path):
            return {"allow": {"operationIds": [], "tags": [], "paths": []}}
        
        with open(self.policy_path, "r") as f:
            return json.load(f)
    
    def check_operations(self, endpoints: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Check if operations are allowed by policy.
        
        Returns:
            {"allowed": bool, "reason": str | None}
        """
        allow = self.policy.get("allow", {})
        allowed_ids = set(allow.get("operationIds", []))
        allowed_tags = set(allow.get("tags", []))
        
        for ep in endpoints:
            op_id = ep.get("operationId")
            tags = set(ep.get("tags", []))
            
            # Check if explicitly allowed
            if allowed_ids and op_id not in allowed_ids:
                return {"allowed": False, "reason": f"Operation {op_id} not in allowlist"}
            
            if allowed_tags and not tags.intersection(allowed_tags):
                return {"allowed": False, "reason": f"Operation {op_id} has no allowed tags"}
        
        return {"allowed": True, "reason": None}


class SecretRedactor:
    """Redact secrets from logs."""
    
    SENSITIVE_HEADERS = [
        "authorization",
        "x-api-key",
        "x-auth-token",
        "cookie",
        "set-cookie",
        "x-webhook-secret",
        "x-internal-token",
    ]
    
    SENSITIVE_PATTERNS = [
        re.compile(r'("secret"\\s*:\\s*")([^"]+)(")', re.IGNORECASE),
        re.compile(r'("token"\\s*:\\s*")([^"]+)(")', re.IGNORECASE),
        re.compile(r'("password"\\s*:\\s*")([^"]+)(")', re.IGNORECASE),
        re.compile(r'("api[_-]?key"\\s*:\\s*")([^"]+)(")', re.IGNORECASE),
        re.compile(r'(bearer\\s+)(\\S+)', re.IGNORECASE),
    ]
    
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
    
    def redact_headers(self, headers: dict[str, str]) -> dict[str, str]:
        """Redact sensitive headers."""
        if not self.enabled:
            return headers
        
        result = {}
        for key, value in headers.items():
            key_lower = key.lower()
            if any(sh in key_lower for sh in self.SENSITIVE_HEADERS):
                result[key] = "[REDACTED]"
            else:
                result[key] = value
        
        return result
    
    def redact_body(self, body: str) -> str:
        """Redact sensitive patterns from body."""
        if not self.enabled:
            return body
        
        result = body
        for pattern in self.SENSITIVE_PATTERNS:
            result = pattern.sub(r'\1[REDACTED]\3', result)
        
        return result
    
    def redact_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """Redact secrets from a dictionary recursively."""
        if not self.enabled:
            return data
        
        result: dict[str, Any] = {}
        for key, value in data.items():
            key_lower = key.lower()
            
            # Check if key indicates sensitive value
            if any(s in key_lower for s in ["secret", "token", "password", "api_key", "apikey"]):
                if isinstance(value, str):
                    result[key] = "[REDACTED]"
                else:
                    result[key] = value
            elif isinstance(value, dict):
                result[key] = self.redact_dict(value)
            elif isinstance(value, list):
                result[key] = [self.redact_dict(item) if isinstance(item, dict) else item for item in value]
            else:
                result[key] = value
        
        return result


def get_internal_token() -> str | None:
    """Get the internal token from environment."""
    return os.environ.get("FORGE_INTERNAL_TOKEN")


def verify_internal_token(provided: str | None) -> bool:
    """Verify the internal token."""
    expected = get_internal_token()
    
    # If no token configured, allow all
    if not expected:
        return True
    
    if not provided:
        return False
    
    # Use constant-time comparison
    import hmac
    return hmac.compare_digest(provided, expected)


def generate_internal_token() -> str:
    """Generate a secure internal token."""
    import secrets
    return secrets.token_urlsafe(32)
