# -*- coding: utf-8 -*-
"""
FHIR Terminology Copilot (Strands Agents tool module)

Drop this file into your Strands Agents project and load it as a module-based tool:

    from strands import Agent
    agent = Agent(tools=["./strands_fhir_terminology_copilot.py"])

This tool focuses on TERMINOLOGY tasks (ValueSets/CodeSystems/SNOMED) and is designed
to be safe-by-default:
- It never caches or logs free-text clinical narratives (only public terminology artifacts).
- It can be configured with strict URL allow-lists to prevent SSRF / data exfiltration.
- It can run without SNOMED if you don't have a licensed Snowstorm instance.

Actions supported (see TOOL_SPEC for input schema):
- list_bindings
- binding_info
- search
- lookup
- validate
- suggest
- record_usage
- audit_resource_terminology
- propose_terminology_patches
- generate_valueset
- generate_conceptmap
- generate_ecl
- snomed_concept_graph
- health

Notes / Ethics:
- This tool is NOT clinical decision support and does not provide medical advice.
- Terminology suggestions are "best-effort"; they must be reviewed by qualified staff.
- SNOMED CT content is licensed in many jurisdictions. Ensure you have the right to use it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from functools import reduce
from typing import Any, Callable, Dict, Iterable, List, Literal, Optional, Sequence, Tuple, TypedDict
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from strands import tool as strands_tool
except Exception:  # pragma: no cover - allows import in non-Strands environments
    def strands_tool(func: Callable[..., Any] | None = None, **kwargs: Any):
        """Fallback no-op decorator used when strands is unavailable."""

        def decorator(inner: Callable[..., Any]) -> Callable[..., Any]:
            setattr(
                inner,
                "__strands_tool__",
                {
                    "name": kwargs.get("name"),
                    "description": kwargs.get("description"),
                },
            )
            return inner

        if func is None:
            return decorator
        return decorator(func)

# ---- Optional dependencies (SNOMED via infherno) ----
_INFHERNO_AVAILABLE = False
try:
    from infherno.defaults import determine_snowstorm_url, determine_snowstorm_branch
    from infherno.tools.fhircodes.instance import GenericSnomedInstance, getECLfromConceptRoots

    _INFHERNO_AVAILABLE = True
except Exception:
    # Tool can still work for HL7-only value sets.
    determine_snowstorm_url = None
    determine_snowstorm_branch = None
    GenericSnomedInstance = None
    getECLfromConceptRoots = None

# ---- Strands types (optional for runtime; tool works without static typing) ----
try:
    from strands.types.tools import ToolResult, ToolUse
except Exception:  # pragma: no cover
    ToolResult = Dict[str, Any]  # type: ignore
    ToolUse = Dict[str, Any]  # type: ignore

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("FHIR_TERMINOLOGY_LOG_LEVEL", "INFO").upper())


# =============================================================================
# Configuration
# =============================================================================

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except Exception:
        return default


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name, "")
    if val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "y", "on")


@dataclass(frozen=True)
class TerminologyConfig:
    """
    Runtime configuration for terminology operations.

    All network access goes through a URL allow-list to reduce SSRF risk.
    """
    cache_dir: str = field(default_factory=lambda: os.environ.get(
        "FHIR_TERMINOLOGY_CACHE_DIR",
        os.path.join(os.path.expanduser("~"), ".cache", "fhir_terminology_copilot"),
    ))
    http_timeout_s: float = float(os.environ.get("FHIR_TERMINOLOGY_HTTP_TIMEOUT_S", "20"))
    http_ttl_s: int = _env_int("FHIR_TERMINOLOGY_HTTP_TTL_S", 60 * 60 * 24 * 7)  # 7 days
    store_threshold: int = _env_int("FHIR_TERMINOLOGY_STORE_THRESHOLD", 2000)

    # Optional external FHIR Terminology Server base URL for $expand/$validate-code support.
    # Examples: https://tx.fhir.org/r4, https://tx.ontoserver.csiro.au/fhir
    fhir_tx_server: Optional[str] = os.environ.get("FHIR_TERMINOLOGY_TX_SERVER") or None

    # SNOMED settings
    snomed_enabled: bool = _env_bool("FHIR_TERMINOLOGY_SNOMED_ENABLED", True)
    snomed_license_ack_env: str = os.environ.get("FHIR_TERMINOLOGY_SNOMED_LICENSE_ENV", "SNOMED_LICENSED")
    snowstorm_url: Optional[str] = os.environ.get("FHIR_TERMINOLOGY_SNOWSTORM_URL") or None
    snowstorm_branch: Optional[str] = os.environ.get("FHIR_TERMINOLOGY_SNOWSTORM_BRANCH") or None

    # Network safety controls
    # Default allow-list covers HL7 and one known workaround domain from the source program.
    allowed_domains: Tuple[str, ...] = tuple(
        d.strip()
        for d in (os.environ.get(
            "FHIR_TERMINOLOGY_ALLOWED_DOMAINS",
            "hl7.org,terminology.hl7.org,myweb.rz.uni-augsburg.de,snomed.info",
        ).split(","))
        if d.strip()
    )
    allow_private_networks: bool = _env_bool("FHIR_TERMINOLOGY_ALLOW_PRIVATE_NETWORKS", False)

    # Operational controls
    max_query_chars: int = _env_int("FHIR_TERMINOLOGY_MAX_QUERY_CHARS", 256)
    max_results_limit: int = _env_int("FHIR_TERMINOLOGY_MAX_RESULTS_LIMIT", 200)
    debug: bool = _env_bool("FHIR_TERMINOLOGY_DEBUG", False)


def _snomed_license_acknowledged(cfg: TerminologyConfig) -> bool:
    """Return True if the operator has acknowledged SNOMED licensing via env var."""
    return os.environ.get(cfg.snomed_license_ack_env, "").strip().lower() in (
        "1", "true", "yes", "y", "on"
    )


# =============================================================================
# Starting-point mappings (kept from the provided program)
# =============================================================================

_CODESYSTEM_REDIRECT: Dict[str, str] = {
    "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus": "http://terminology.hl7.org/4.0.0/CodeSystem-v3-MaritalStatus.json",
    "http://terminology.hl7.org/CodeSystem/v3-NullFlavor": "http://terminology.hl7.org/4.0.0/CodeSystem-v3-NullFlavor.json",
    "http://terminology.hl7.org/CodeSystem/condition-clinical": "http://hl7.org/fhir/R4/codesystem-condition-clinical.json",
    "http://terminology.hl7.org/CodeSystem/condition-ver-status": "http://hl7.org/fhir/R4/codesystem-condition-ver-status.json",
    "http://terminology.hl7.org/CodeSystem/dose-rate-type": "http://hl7.org/fhir/R4/codesystem-dose-rate-type.json",
    "http://terminology.hl7.org/CodeSystem/v3-TimingEvent": "http://terminology.hl7.org/4.0.0/CodeSystem-v3-TimingEvent.json",
    "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation": "http://terminology.hl7.org/4.0.0/CodeSystem-v3-GTSAbbreviation.json",
    # Fix for CodeSystem-allergyintolerance-clinical (broken concept JSON list)
    "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical": "https://myweb.rz.uni-augsburg.de/~freijoha/fhir/CodeSystem-allergyintolerance-clinical.json",
    "http://terminology.hl7.org/CodeSystem/medication-statement-category": "http://hl7.org/fhir/R4/codesystem-medication-statement-category.json",
}

# NOTE: This is the same mapping as the program you provided (kept inline for drop-in use).
# You can extend/override it by setting FHIR_TERMINOLOGY_BINDINGS_JSON to a JSON object.
_DEFAULT_BINDINGS: Dict[str, Dict[str, str]] = {
    # Patient
    "Patient.name.use": {"vs": "http://hl7.org/fhir/R4/valueset-name-use.json", "type": "code"},
    "Patient.contact.system": {"vs": "http://hl7.org/fhir/R4/valueset-contact-point-system.json", "type": "code"},
    "Patient.contact.use": {"vs": "http://hl7.org/fhir/R4/valueset-contact-point-use.json", "type": "code"},
    "Patient.gender": {"vs": "http://hl7.org/fhir/R4/valueset-administrative-gender.json", "type": "code"},
    "Patient.address.use": {"vs": "http://hl7.org/fhir/R4/valueset-address-use.json", "type": "code"},
    "Patient.address.type": {"vs": "http://hl7.org/fhir/R4/valueset-address-type.json", "type": "code"},
    "Patient.maritalStatus": {"vs": "http://hl7.org/fhir/R4/valueset-marital-status.json", "type": "coding"},
    "Patient.contact.relationship": {"vs": "http://hl7.org/fhir/R4/valueset-relationship.json", "type": "coding"},
    # Condition
    "Condition.clinicalStatus": {"vs": "http://hl7.org/fhir/R4/valueset-condition-clinical.json", "type": "coding"},
    "Condition.verificationStatus": {"vs": "http://hl7.org/fhir/R4/valueset-condition-ver-status.json", "type": "coding"},
    "Condition.category": {"vs": "http://hl7.org/fhir/R4/valueset-condition-category.json", "type": "coding"},
    "Condition.severity": {"vs": "http://hl7.org/fhir/R4/valueset-condition-severity.json", "type": "coding"},
    "Condition.code": {"vs": "http://hl7.org/fhir/R4/valueset-condition-code.json", "type": "coding"},
    "Condition.bodySite": {"vs": "http://hl7.org/fhir/R4/valueset-body-site.json", "type": "coding"},
    "Condition.stage.summary": {"vs": "http://hl7.org/fhir/R4/valueset-condition-stage.json", "type": "coding"},
    "Condition.stage.type": {"vs": "http://hl7.org/fhir/R4/valueset-condition-stage-type.json", "type": "coding"},
    "Condition.evidence": {"vs": "http://hl7.org/fhir/R4/valueset-clinical-findings.json", "type": "coding"},
    # MedicationStatement
    "MedicationStatement.status": {"vs": "http://hl7.org/fhir/R4/valueset-medication-statement-status.json", "type": "code"},
    "MedicationStatement.statusReason": {"vs": "https://hl7.org/fhir/R4/valueset-reason-medication-status-codes.json", "type": "coding"},
    "MedicationStatement.category": {"vs": "http://hl7.org/fhir/R4/valueset-medication-statement-category.json", "type": "coding"},
    "MedicationStatement.medication": {"vs": "http://hl7.org/fhir/R4/valueset-medication-codes.json", "type": "coding"},
    "MedicationStatement.medicationCodeableConcept": {"vs": "http://hl7.org/fhir/R4/valueset-medication-codes.json", "type": "coding"},
    "MedicationStatement.reasonCode": {"vs": "http://hl7.org/fhir/R4/valueset-condition-code.json", "type": "coding"},
    "MedicationStatement.dosage.additionalInstruction": {"vs": "http://hl7.org/fhir/R4/valueset-additional-instruction-codes.json", "type": "coding"},
    "MedicationStatement.dosage.timing.repeat.dayOfWeek": {"vs": "http://hl7.org/fhir/R4/valueset-days-of-week.json", "type": "code"},
    "MedicationStatement.dosage.timing.repeat.when": {"vs": "http://hl7.org/fhir/R4/valueset-event-timing.json", "type": "code"},
    "MedicationStatement.dosage.timing.code": {"vs": "http://hl7.org/fhir/R4/valueset-timing-abbreviation.json", "type": "coding"},
    "MedicationStatement.dosage.asNeeded": {"vs": "http://hl7.org/fhir/R4/valueset-medication-as-needed-reason.json", "type": "coding"},
    "MedicationStatement.dosage.asNeededCodeableConcept": {"vs": "http://hl7.org/fhir/R4/valueset-medication-as-needed-reason.json", "type": "coding"},
    "MedicationStatement.dosage.site": {"vs": "http://hl7.org/fhir/R4/valueset-approach-site-codes.json", "type": "coding"},
    "MedicationStatement.dosage.route": {"vs": "http://hl7.org/fhir/R4/valueset-route-codes.json", "type": "coding"},
    "MedicationStatement.dosage.method": {"vs": "http://hl7.org/fhir/R4/valueset-administration-method-codes.json", "type": "coding"},
    "MedicationStatement.dosage.doseAndRate.type": {"vs": "http://hl7.org/fhir/R4/valueset-dose-rate-type.json", "type": "coding"},
    # Procedure
    "Procedure.status": {"vs": "http://hl7.org/fhir/R4/valueset-event-status.json", "type": "code"},
    "Procedure.statusReason": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-not-performed-reason.json", "type": "coding"},
    "Procedure.category": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-category.json", "type": "coding"},
    "Procedure.code": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-code.json", "type": "coding"},
    "Procedure.performer.function": {"vs": "http://hl7.org/fhir/R4/valueset-performer-role.json", "type": "coding"},
    "Procedure.reasonCode": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-reason.json", "type": "coding"},
    "Procedure.bodySite": {"vs": "http://hl7.org/fhir/R4/valueset-body-site.json", "type": "coding"},
    "Procedure.outcome": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-outcome.json", "type": "coding"},
    "Procedure.complications": {"vs": "http://hl7.org/fhir/R4/valueset-condition-code.json", "type": "coding"},
    "Procedure.followUp": {"vs": "http://hl7.org/fhir/R4/valueset-procedure-followup.json", "type": "coding"},
    "Procedure.focalDevice.action": {"vs": "http://hl7.org/fhir/R4/valueset-device-action.json", "type": "coding"},
    "Procedure.usedCode": {"vs": "http://hl7.org/fhir/R4/valueset-device-kind.json", "type": "coding"},
    # Observation
    "Observation.status": {"vs": "http://hl7.org/fhir/R4/valueset-observation-status.json", "type": "code"},
    "Observation.category": {"vs": "http://hl7.org/fhir/R4/valueset-observation-category.json", "type": "coding"},
    "Observation.code": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.effectiveTiming.repeat.dayOfWeek": {"vs": "http://hl7.org/fhir/R4/valueset-days-of-week.json", "type": "code"},
    "Observation.effectiveTiming.repeat.when": {"vs": "http://hl7.org/fhir/R4/valueset-event-timing.json", "type": "code"},
    "Observation.effectiveTiming.code": {"vs": "http://hl7.org/fhir/R4/valueset-timing-abbreviation.json", "type": "coding"},
    "Observation.value": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.valueCodeableConcept": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.dataAbsentReason": {"vs": "http://hl7.org/fhir/R4/valueset-data-absent-reason.json", "type": "coding"},
    "Observation.interpretation": {"vs": "http://hl7.org/fhir/R4/valueset-observation-interpretation.json", "type": "coding"},
    "Observation.bodySite": {"vs": "http://hl7.org/fhir/R4/valueset-body-site.json", "type": "coding"},
    "Observation.method": {"vs": "http://hl7.org/fhir/R4/valueset-observation-methods.json", "type": "coding"},
    "Observation.referenceRange.type": {"vs": "http://hl7.org/fhir/R4/valueset-referencerange-meaning.json", "type": "coding"},
    "Observation.component.code": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.component.value": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.component.valueCodeableConcept": {"vs": "http://hl7.org/fhir/R4/valueset-observation-codes.json", "type": "coding"},
    "Observation.component.dataAbsentReason": {"vs": "http://hl7.org/fhir/R4/valueset-data-absent-reason.json", "type": "coding"},
    "Observation.component.interpretation": {"vs": "http://hl7.org/fhir/R4/valueset-observation-interpretation.json", "type": "coding"},
    # Encounter
    "Encounter.status": {"vs": "http://hl7.org/fhir/R4/valueset-encounter-status.json", "type": "code"},
    # AllergyIntolerance
    "AllergyIntolerance.clinicalStatus": {"vs": "http://hl7.org/fhir/R4/valueset-allergyintolerance-clinical.json", "type": "coding"},
    "AllergyIntolerance.verificationStatus": {"vs": "http://hl7.org/fhir/R4/valueset-allergyintolerance-verification.json", "type": "coding"},
    "AllergyIntolerance.type": {"vs": "http://hl7.org/fhir/R4/valueset-allergy-intolerance-type.json", "type": "code"},
    "AllergyIntolerance.category": {"vs": "http://hl7.org/fhir/R4/valueset-allergy-intolerance-category.json", "type": "code"},
    "AllergyIntolerance.criticality": {"vs": "http://hl7.org/fhir/R4/valueset-allergy-intolerance-criticality.json", "type": "code"},
    "AllergyIntolerance.code": {"vs": "http://hl7.org/fhir/R4/valueset-allergyintolerance-code.json", "type": "coding"},
    "AllergyIntolerance.bodySite": {"vs": "http://hl7.org/fhir/R4/valueset-body-site.json", "type": "coding"},
    "AllergyIntolerance.reaction.substance": {"vs": "http://hl7.org/fhir/R4/valueset-clinical-findings.json", "type": "coding"},
    "AllergyIntolerance.reaction.manifestation": {"vs": "http://hl7.org/fhir/R4/valueset-clinical-findings.json", "type": "coding"},
    "AllergyIntolerance.reaction.severity": {"vs": "http://hl7.org/fhir/R4/valueset-reaction-event-severity.json", "type": "code"},
    "AllergyIntolerance.reaction.exposureRoute": {"vs": "http://hl7.org/fhir/R4/valueset-route-codes.json", "type": "coding"},
    # Immunization
    "Immunization.status": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-status.json", "type": "code"},
    "Immunization.statusReason": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-status-reason.json", "type": "coding"},
    "Immunization.recordOrigin": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-origin.json", "type": "coding"},
    "Immunization.site": {"vs": "http://hl7.org/fhir/R4/valueset-approach-site-codes.json", "type": "coding"},
    "Immunization.route": {"vs": "http://hl7.org/fhir/R4/valueset-route-codes.json", "type": "coding"},
    "Immunization.performer.function": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-function.json", "type": "coding"},
    "Immunization.reasonCode": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-reason.json", "type": "coding"},
    "Immunization.subpotentReason": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-subpotent-reason.json", "type": "coding"},
    "Immunization.programEligibility": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-program-eligibility.json", "type": "coding"},
    "Immunization.fundingSource": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-funding-source.json", "type": "coding"},
    "Immunization.protocolApplied.targetDisease": {"vs": "http://hl7.org/fhir/R4/valueset-immunization-target-disease.json", "type": "coding"},
}


def _load_bindings() -> Dict[str, Dict[str, str]]:
    """
    Load binding mapping; supports override via env var.

    FHIR_TERMINOLOGY_BINDINGS_JSON should be a JSON object:
        {"Patient.gender": {"vs": "...", "type": "code"}, ...}
    """
    override = os.environ.get("FHIR_TERMINOLOGY_BINDINGS_JSON", "").strip()
    if not override:
        return dict(_DEFAULT_BINDINGS)
    try:
        obj = json.loads(override)
        if not isinstance(obj, dict):
            raise ValueError("FHIR_TERMINOLOGY_BINDINGS_JSON must be a JSON object")
        merged = dict(_DEFAULT_BINDINGS)
        merged.update(obj)
        return merged
    except Exception as e:
        logger.warning("Failed to parse FHIR_TERMINOLOGY_BINDINGS_JSON; using defaults. error=%s", e)
        return dict(_DEFAULT_BINDINGS)


# =============================================================================
# Safety helpers
# =============================================================================

_PRIVATE_NET_RE = re.compile(
    r"^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)"
)


def _netloc(host: str) -> str:
    return host.split(":")[0].strip().lower()


def _is_private_host(host: str) -> bool:
    host = _netloc(host)
    return bool(_PRIVATE_NET_RE.match(host))


def _is_url_allowed(url: str, cfg: TerminologyConfig) -> bool:
    """
    Enforce a coarse allow-list to reduce SSRF-style abuse from LLM prompts.

    - Allows: domains ending in any cfg.allowed_domains, or exact match.
    - Blocks: private network hosts unless cfg.allow_private_networks=True.
    """
    try:
        parsed = urlparse(url)
        host = parsed.netloc
        if not host:
            return False
        host_l = _netloc(host)
        if not cfg.allow_private_networks and _is_private_host(host_l):
            return False
        for d in cfg.allowed_domains:
            d_l = d.lower()
            if host_l == d_l or host_l.endswith("." + d_l):
                return True
        # If user explicitly configured a terminology server / snowstorm, allow those too.
        for extra in (cfg.fhir_tx_server, cfg.snowstorm_url):
            if extra:
                extra_host = _netloc(urlparse(extra).netloc)
                if host_l == extra_host:
                    return True
        return False
    except Exception:
        return False


def _truncate(s: Optional[str], n: int) -> Optional[str]:
    if s is None:
        return None
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


# =============================================================================
# HTTP client + disk cache (public terminology artifacts only)
# =============================================================================

class JsonDiskCache:
    """
    Small JSON cache keyed by URL hash. Stores ONLY public terminology artifacts.

    Caches are stored under:
        <cache_dir>/http/<sha256(url)>.json
        <cache_dir>/http/<sha256(url)>.meta.json
    """

    def __init__(self, cache_dir: str) -> None:
        self.cache_dir = cache_dir
        self.http_dir = os.path.join(cache_dir, "http")
        os.makedirs(self.http_dir, exist_ok=True)
        self._lock = threading.Lock()

    def _key(self, url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _paths(self, url: str) -> Tuple[str, str]:
        k = self._key(url)
        return (
            os.path.join(self.http_dir, f"{k}.json"),
            os.path.join(self.http_dir, f"{k}.meta.json"),
        )

    def get(self, url: str, ttl_s: int) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        data_path, meta_path = self._paths(url)
        with self._lock:
            if not (os.path.exists(data_path) and os.path.exists(meta_path)):
                return None, {}
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                fetched_at = float(meta.get("fetched_at", 0.0))
                age = time.time() - fetched_at
                if age > ttl_s:
                    return None, meta
                with open(data_path, "r", encoding="utf-8") as f:
                    return json.load(f), meta
            except Exception:
                return None, {}

    def set(self, url: str, obj: Dict[str, Any], meta: Dict[str, Any]) -> None:
        data_path, meta_path = self._paths(url)
        with self._lock:
            with open(data_path, "w", encoding="utf-8") as f:
                json.dump(obj, f)
            meta2 = dict(meta)
            meta2["url"] = url
            meta2["fetched_at"] = time.time()
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta2, f)


class HttpJsonClient:
    def __init__(self, cfg: TerminologyConfig) -> None:
        self.cfg = cfg
        self.cache = JsonDiskCache(cfg.cache_dir)
        self.session = requests.Session()

        retry = Retry(
            total=3,
            connect=3,
            read=3,
            backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

        self.session.headers.update(
            {
                "Accept": "application/json, */*",
                "User-Agent": os.environ.get(
                    "FHIR_TERMINOLOGY_USER_AGENT",
                    "FHIR-Terminology-Copilot/1.0 (+https://strandsagents.com)",
                ),
            }
        )

    def get_json(self, url: str) -> Dict[str, Any]:
        # Apply known redirects
        url = _CODESYSTEM_REDIRECT.get(url, url)

        if not _is_url_allowed(url, self.cfg):
            raise ValueError(f"URL not allowed by policy: {url}")

        cached, meta = self.cache.get(url, ttl_s=self.cfg.http_ttl_s)
        if cached is not None:
            return cached

        headers: Dict[str, str] = {}
        etag = meta.get("etag")
        last_modified = meta.get("last_modified")
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        resp = self.session.get(url, headers=headers, timeout=self.cfg.http_timeout_s)
        if resp.status_code == 304 and meta.get("url") == url:
            # Not modified: load stale cache (it existed but was too old), then refresh meta timestamp.
            cached2, meta2 = self.cache.get(url, ttl_s=10**9)
            if cached2 is not None:
                meta2["etag"] = meta.get("etag")
                meta2["last_modified"] = meta.get("last_modified")
                self.cache.set(url, cached2, meta2)
                return cached2

        if resp.status_code >= 400:
            raise RuntimeError(f"HTTP error {resp.status_code} for {url}")

        try:
            obj = resp.json()
        except Exception as e:
            raise RuntimeError(f"Non-JSON response from {url}: {e}") from e

        self.cache.set(
            url,
            obj=obj,
            meta={
                "status_code": resp.status_code,
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
            },
        )
        return obj


# =============================================================================
# Terminology loaders
# =============================================================================

class Concept(TypedDict, total=False):
    code: str
    system: str
    description: Optional[str]
    display: Optional[str]
    actual_system_url: Optional[str]
    score: Optional[float]


def _clean_search_text(text: str) -> str:
    # Keep alphanum + whitespace only
    return re.sub(r"[^0-9a-zA-Z\s]+", " ", text).lower().strip()


def _flatten_fhir_concepts(concepts: Sequence[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    """
    Flatten nested FHIR CodeSystem.concept trees into a flat stream.
    """
    for c in concepts:
        yield c
        kids = c.get("concept")
        if isinstance(kids, list):
            yield from _flatten_fhir_concepts(kids)


class CodeSystemStaticLoader:
    """
    Loads a CodeSystem resource that includes a concept list.

    Implementation notes:
    - Builds a small in-memory SQLite table for fast substring search.
    - Suitable for HL7 code systems with a manageable number of concepts.
    """

    def __init__(self, concepts: List[Concept]) -> None:
        self.concepts = concepts

        self.db = sqlite3.connect(":memory:")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS concept ("
            "code TEXT NOT NULL, system TEXT NOT NULL, description TEXT NOT NULL, "
            "search TEXT NOT NULL, PRIMARY KEY(code, system)"
            ");"
        )
        rows = []
        for c in self.concepts:
            code = c.get("code", "")
            system = c.get("system", "")
            desc = c.get("description") or ""
            search = _clean_search_text(code + "\n" + desc)
            rows.append((code, system, desc, search))
        self.db.executemany("INSERT OR REPLACE INTO concept VALUES (?, ?, ?, ?)", rows)
        self.db.commit()

    def count(self) -> int:
        return len(self.concepts)

    def isStored(self) -> bool:
        return True

    def getConcepts(self, query: Optional[str] = None, limit: Optional[int] = None) -> List[Concept]:
        if query is None:
            return self.concepts[: (limit or len(self.concepts))]
        return self.search(query=query, limit=limit)

    def search(self, query: Optional[str] = None, limit: Optional[int] = None) -> List[Concept]:
        if not query:
            return self.getConcepts(limit=limit)
        query_words = [_clean_search_text(q) for q in query.split()]
        query_words = [q for q in query_words if q]
        if not query_words:
            return self.getConcepts(limit=limit)

        # Build a safe SQL statement (query_words only contains alphanum + spaces).
        sub = " AND ".join([f"instr(search, '{w}')" for w in query_words])
        stmd = "SELECT code, system, description, search FROM concept WHERE " + sub
        if limit:
            stmd += f" LIMIT {int(limit)}"
        cur = self.db.execute(stmd)
        out: List[Concept] = []
        for code, system, desc, search in cur.fetchall():
            out.append({"code": code, "system": system, "description": desc})
        return out

    def getByCode(self, code: str, system: Optional[str] = None) -> Optional[Concept]:
        code = str(code)
        if system:
            system = _CODESYSTEM_REDIRECT.get(system, system)
        cur = self.db.execute(
            "SELECT code, system, description FROM concept WHERE code = ? " + ("AND system = ?" if system else ""),
            (code, system) if system else (code,),
        )
        row = cur.fetchone()
        if row:
            return {"code": row[0], "system": row[1], "description": row[2]}
        # fallback: try any system (helps if caller omitted system)
        if system is None:
            cur2 = self.db.execute("SELECT code, system, description FROM concept WHERE code = ? LIMIT 2", (code,))
            rows = cur2.fetchall()
            if len(rows) == 1:
                return {"code": rows[0][0], "system": rows[0][1], "description": rows[0][2]}
        return None

    @classmethod
    def from_url(cls, http: HttpJsonClient, system_url: str, filter_type: str, filter_info: Any) -> "CodeSystemStaticLoader":
        cs_doc = http.get_json(system_url)
        if cs_doc.get("resourceType") != "CodeSystem":
            # Some endpoints return a JSON that isn't an actual CodeSystem resource; handle best-effort.
            logger.debug("Non-CodeSystem JSON at %s; attempting to parse as CodeSystem-like.", system_url)

        advertised_url = cs_doc.get("url") or system_url
        raw_concepts = cs_doc.get("concept") or []
        flat = list(_flatten_fhir_concepts(raw_concepts)) if isinstance(raw_concepts, list) else []

        all_concepts: List[Concept] = [
            {
                "code": str(concept.get("code", "")),
                "system": advertised_url,
                "actual_system_url": system_url,
                "description": concept.get("definition") or concept.get("display"),
            }
            for concept in flat
            if concept.get("code") is not None
        ]

        if filter_type == "all":
            concepts = all_concepts
        elif filter_type == "explicit":
            allowed_codes = [str(fi.get("code")) for fi in (filter_info or []) if fi.get("code") is not None]
            allowed_set = set(allowed_codes)
            concepts = [c for c in all_concepts if c["code"] in allowed_set]
        elif filter_type == "filter":
            # Generic CodeSystem filtering isn't supported locally.
            # Use a FHIR Terminology server if configured (handled higher up), else return empty.
            concepts = []
        else:
            concepts = []

        return CodeSystemStaticLoader(concepts)


class CodeSystemSNOMEDLoader:
    """
    Lazy SNOMED CodeSystem loader backed by Snowstorm search.

    It does NOT enumerate the full concept set (which is massive) unless it is small enough
    under store_threshold.
    """

    system = "http://snomed.info/sct"

    def __init__(self, n_counts: int, ecl: Optional[str], snomed_instance: Any) -> None:
        self.n_counts = int(n_counts)
        self.ecl = ecl
        self.snomed_instance = snomed_instance

    def count(self) -> int:
        return self.n_counts

    def getConcepts(self, query: Optional[str] = None, limit: Optional[int] = None) -> List[Concept]:
        return self.search(query=query, limit=limit)

    def search(self, query: Optional[str] = None, limit: Optional[int] = None) -> List[Concept]:
        res = self.snomed_instance.search_by_concepts(query, ecl=self.ecl, limit=limit)
        out: List[Concept] = []
        for concept in res:
            out.append({"code": str(concept.get("id")), "system": self.system, "description": concept.get("term")})
        return out

    def getByCode(self, code: str, system: Optional[str] = None) -> Optional[Concept]:
        if system and _CODESYSTEM_REDIRECT.get(system, system) != self.system:
            return None
        res = self.snomed_instance.search_by_concepts(None, conceptIds=[str(code)], limit=1)
        if not res:
            return None
        c = res[0]
        return {"code": str(c.get("id")), "system": self.system, "description": c.get("term")}

    @classmethod
    def from_snomed(
        cls,
        store_threshold: int,
        snomed_instance: Any,
        filter_type: str = "all",
        filter_info: Any = None,
    ) -> Optional[object]:
        """
        Returns either:
        - CodeSystemStaticLoader if the result set is small enough (stored explicitly), or
        - CodeSystemSNOMEDLoader if it is large (lazy), or
        - None if SNOMED isn't available.
        """
        if snomed_instance is None:
            return None

        filter_ecl: Optional[str] = None
        n_counts: Optional[int] = None
        concepts: Optional[List[Dict[str, Any]]] = None

        if filter_type == "all":
            raw = snomed_instance.search_by_concepts(getRawResponse=True, limit=1)
            n_counts = int(raw.get("total", 0))
            if n_counts <= store_threshold:
                concepts = snomed_instance.search_by_concepts(limit=None)
        elif filter_type == "filter":
            if not filter_info:
                return None
            # Expect FHIR ValueSet SNOMED "concept is-a <id>" filters (same as starting program)
            ok = [
                f
                for f in filter_info
                if f.get("op") == "is-a" and f.get("property") == "concept" and f.get("value") is not None
            ]
            if len(ok) != len(filter_info):
                logger.warning("Unsupported SNOMED filter format: %s", _truncate(str(filter_info), 200))
                return None

            roots = [str(f["value"]) for f in ok]
            try:
                if getECLfromConceptRoots:
                    filter_ecl = getECLfromConceptRoots(roots)
                else:
                    # Best-effort ECL union
                    filter_ecl = " OR ".join([f"<{r}" for r in roots])
                raw = snomed_instance.search_by_concepts(getRawResponse=True, limit=1, ecl=filter_ecl)
                n_counts = int(raw.get("total", 0))
            except Exception as e:
                logger.warning("Failed to query SNOMED with ECL filter. error=%s ecl=%s", e, filter_ecl)
                return None

            if n_counts <= store_threshold:
                concepts = snomed_instance.search_by_concepts(limit=None, ecl=filter_ecl)
        elif filter_type == "explicit":
            if not filter_info:
                return None
            codes = [str(f.get("code")) for f in filter_info if f.get("code") is not None]
            n_counts = len(codes)
            concepts = snomed_instance.search_by_concepts(limit=None, conceptIds=codes)
        else:
            return None

        if concepts is not None:
            stored: List[Concept] = []
            for c in concepts:
                stored.append({"code": str(c.get("id")), "system": cls.system, "description": c.get("term")})
            return CodeSystemStaticLoader(concepts=stored)
        assert n_counts is not None
        return CodeSystemSNOMEDLoader(n_counts=n_counts, ecl=filter_ecl, snomed_instance=snomed_instance)


class ValueSetLoader:
    """
    Loads a ValueSet and provides search/lookup/validate across its included CodeSystems.

    If a FHIR Terminology server is configured, it can be used as a fallback for:
    - filters not supported locally
    - LOINC or other large code systems
    """

    def __init__(
        self,
        url: str,
        cs_loaders: List[object],
        *,
        http: HttpJsonClient,
        cfg: TerminologyConfig,
        contains_snomed: bool = False,
    ) -> None:
        self.url = url
        self.cs = cs_loaders
        self.http = http
        self.cfg = cfg
        self.contains_snomed = bool(contains_snomed)

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        store_threshold: int,
        snomed_instance: Any,
        http: HttpJsonClient,
        cfg: TerminologyConfig,
        _memo: Optional[Dict[Tuple[str, int], "ValueSetLoader"]] = None,
    ) -> "ValueSetLoader":
        if _memo is None:
            _memo = {}
        key = (url, store_threshold)
        if key in _memo:
            return _memo[key]

        vs_doc = http.get_json(url)
        cs_loaders: List[object] = []
        contains_snomed = False

        # If VS already contains an expansion, use it as a stored, explicit list.
        # (Many VS files don't include expansion; still safe to support.)
        if isinstance(vs_doc, dict) and isinstance(vs_doc.get("expansion"), dict):
            contains = vs_doc["expansion"].get("contains")
            if isinstance(contains, list) and contains:
                flat_contains = list(_flatten_fhir_concepts(contains))
                concepts: List[Concept] = []
                for item in flat_contains:
                    code = item.get("code")
                    system = item.get("system")
                    if code and system:
                        concepts.append(
                            {
                                "code": str(code),
                                "system": str(system),
                                "description": item.get("display") or item.get("definition"),
                            }
                        )
                loader = CodeSystemStaticLoader(concepts)
                contains_snomed = any(c.get('system') == 'http://snomed.info/sct' for c in concepts)
                vsl = ValueSetLoader(url, [loader], http=http, cfg=cfg, contains_snomed=contains_snomed)
                _memo[key] = vsl
                return vsl

        compose = (vs_doc or {}).get("compose") or {}
        include = compose.get("include") or []
        exclude = compose.get("exclude")
        if exclude:
            logger.info("ValueSet %s has compose.exclude; local loader ignores exclusions.", url)

        for inc in include:
            if not isinstance(inc, dict):
                continue
            if "system" in inc:
                ref_url = _CODESYSTEM_REDIRECT.get(str(inc["system"]), str(inc["system"]))

                filter_type = "all"
                filter_info = None
                if "filter" in inc:
                    filter_type = "filter"
                    filter_info = inc.get("filter")
                elif "concept" in inc:
                    filter_type = "explicit"
                    filter_info = inc.get("concept")

                if ref_url == "http://snomed.info/sct":
                    contains_snomed = True
                    if cfg.snomed_enabled and _INFHERNO_AVAILABLE and snomed_instance is not None:
                        cs_loader = CodeSystemSNOMEDLoader.from_snomed(
                            store_threshold=store_threshold,
                            snomed_instance=snomed_instance,
                            filter_type=filter_type,
                            filter_info=filter_info,
                        )
                        if cs_loader is not None:
                            cs_loaders.append(cs_loader)
                    else:
                        logger.info("SNOMED requested but disabled/unavailable. url=%s", url)
                elif urlparse(ref_url).netloc.endswith("hl7.org") or urlparse(ref_url).netloc.endswith(
                    "myweb.rz.uni-augsburg.de"
                ):
                    cs_loaders.append(CodeSystemStaticLoader.from_url(http, ref_url, filter_type, filter_info))
                elif urlparse(ref_url).netloc.endswith("loinc.org"):
                    # Local LOINC not supported; rely on optional terminology server.
                    logger.info("LOINC include found; local loader skips unless TX server is configured. vs=%s", url)
                else:
                    logger.warning("Unhandled CodeSystem URL in ValueSet include: %s", ref_url)
            elif "valueSet" in inc:
                for rec_vs_url in inc.get("valueSet") or []:
                    rec = _CODESYSTEM_REDIRECT.get(str(rec_vs_url), str(rec_vs_url))
                    rec_vsl = ValueSetLoader.from_url(
                        rec, store_threshold=store_threshold, snomed_instance=snomed_instance, http=http, cfg=cfg, _memo=_memo
                    )
                    cs_loaders.extend(rec_vsl.cs)
                    contains_snomed = contains_snomed or bool(getattr(rec_vsl, 'contains_snomed', False))
            else:
                logger.warning("Unhandled ValueSet compose.include item: %s", _truncate(str(inc), 200))

        vsl = ValueSetLoader(url, cs_loaders, http=http, cfg=cfg, contains_snomed=contains_snomed)
        _memo[key] = vsl
        return vsl

    def _tx_expand(self, query: Optional[str], limit: Optional[int]) -> Optional[List[Concept]]:
        if not self.cfg.fhir_tx_server:
            return None
        if getattr(self, 'contains_snomed', False):
            # Respect SNOMED enable/disable + license acknowledgement even when using a TX server.
            if not self.cfg.snomed_enabled:
                return None
            if not _snomed_license_acknowledged(self.cfg):
                raise PermissionError(
                    f"SNOMED access disabled until you set {self.cfg.snomed_license_ack_env}=true (license acknowledgement)."
                )
        base = self.cfg.fhir_tx_server.rstrip("/")
        params = {"url": self.url}
        if query:
            params["filter"] = query
        if limit:
            params["count"] = str(int(limit))
        # FHIR terminology servers typically accept GET for $expand
        resp = self.http.session.get(
            f"{base}/ValueSet/$expand",
            params=params,
            timeout=self.cfg.http_timeout_s,
        )
        if resp.status_code >= 400:
            logger.debug("TX $expand failed status=%s", resp.status_code)
            return None
        try:
            obj = resp.json()
        except Exception:
            return None
        contains = ((obj or {}).get("expansion") or {}).get("contains") or []
        if not isinstance(contains, list):
            return None
        flat = list(_flatten_fhir_concepts(contains))
        out: List[Concept] = []
        for item in flat:
            code = item.get("code")
            system = item.get("system")
            if code and system:
                out.append(
                    {
                        "code": str(code),
                        "system": str(system),
                        "description": item.get("display") or item.get("definition"),
                    }
                )
        return out

    def _tx_validate(self, code: str, system: Optional[str]) -> Optional[Dict[str, Any]]:
        if not self.cfg.fhir_tx_server:
            return None
        if getattr(self, 'contains_snomed', False):
            if not self.cfg.snomed_enabled:
                return None
            if not _snomed_license_acknowledged(self.cfg):
                raise PermissionError(
                    f"SNOMED access disabled until you set {self.cfg.snomed_license_ack_env}=true (license acknowledgement)."
                )
        base = self.cfg.fhir_tx_server.rstrip("/")
        params = {"url": self.url, "code": str(code)}
        if system:
            params["system"] = str(system)
        resp = self.http.session.get(
            f"{base}/ValueSet/$validate-code",
            params=params,
            timeout=self.cfg.http_timeout_s,
        )
        if resp.status_code >= 400:
            return None
        try:
            return resp.json()
        except Exception:
            return None

    def count(self) -> int:
        return reduce(lambda x, y: x + y, [int(getattr(cs, "count")()) for cs in self.cs], 0) if self.cs else 0

    def list_code_systems(self) -> List[str]:
        systems: List[str] = []
        for cs in self.cs:
            if isinstance(cs, CodeSystemSNOMEDLoader) or getattr(cs, "system", None) == "http://snomed.info/sct":
                systems.append("http://snomed.info/sct")
            else:
                # For static loader, each concept carries system url
                if hasattr(cs, "concepts") and cs.concepts:
                    systems.append(str(cs.concepts[0].get("system", "")))
        return sorted({s for s in systems if s})

    def search(self, query: Optional[str] = None, limit: Optional[int] = None) -> List[Concept]:
        limit = int(limit or 20)
        # local search
        results: List[Concept] = []
        for cs in self.cs:
            results.extend(getattr(cs, "search")(query, limit))
        # fallback to TX server if local yields nothing (or local is empty)
        if (not results) and self.cfg.fhir_tx_server:
            tx_res = self._tx_expand(query=query, limit=limit)
            if tx_res:
                results = tx_res

        # Deduplicate by (system, code) and lightly score
        return _rank_and_dedupe(results, query=query, limit=limit)

    def getByCode(self, code: str, system: Optional[str] = None) -> Optional[Concept]:
        candidates: List[Concept] = []
        for cs in self.cs:
            c = getattr(cs, "getByCode")(code, system)
            if c:
                candidates.append(c)

        if not candidates and self.cfg.fhir_tx_server:
            v = self._tx_validate(code=code, system=system)
            # TX validate-code doesn't always return the code details; try an expansion filtered to code.
            if v and bool(v.get("result")):
                exp = self._tx_expand(query=code, limit=5) or []
                for e in exp:
                    if e.get("code") == code and (system is None or e.get("system") == system):
                        return e

        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) == 0:
            return None
        # If ambiguous, pick exact system match if present
        if system:
            for c in candidates:
                if _CODESYSTEM_REDIRECT.get(c.get("system", ""), c.get("system", "")) == _CODESYSTEM_REDIRECT.get(system, system):
                    return c
        return candidates[0]

    def validate_code(self, code: str, system: Optional[str] = None) -> Dict[str, Any]:
        """
        Returns a dict describing validation result.
        """
        concept = self.getByCode(code, system)
        if concept:
            return {"ok": True, "concept": concept, "valueset": self.url}

        # If we have a TX server, ask it explicitly.
        if self.cfg.fhir_tx_server:
            v = self._tx_validate(code=code, system=system)
            if v and "result" in v:
                return {"ok": bool(v.get("result")), "details": v, "valueset": self.url}

        return {"ok": False, "valueset": self.url}


# =============================================================================
# Ranking + heuristics
# =============================================================================

def _tokenize(text: str) -> List[str]:
    return [t for t in _clean_search_text(text).split() if t]


def _jaccard(a: Sequence[str], b: Sequence[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _rank_and_dedupe(concepts: List[Concept], *, query: Optional[str], limit: int) -> List[Concept]:
    seen: set[Tuple[str, str]] = set()
    scored: List[Concept] = []
    q_tokens = _tokenize(query or "")
    for c in concepts:
        code = str(c.get("code", ""))
        system = str(c.get("system", ""))
        key = (system, code)
        if key in seen:
            continue
        seen.add(key)
        desc = str(c.get("description") or c.get("display") or "")
        if q_tokens:
            d_tokens = _tokenize(code + " " + desc)
            score = 0.70 * _jaccard(q_tokens, d_tokens)
            # mild boosts
            q_l = (query or "").lower()
            if desc.lower().startswith(q_l):
                score += 0.15
            if code.lower() == q_l:
                score += 0.25
            if q_l and q_l in desc.lower():
                score += 0.05
            c2 = dict(c)
            c2["score"] = round(float(score), 6)
            scored.append(c2)
        else:
            scored.append(dict(c))

    if q_tokens:
        scored.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
    return scored[: max(1, int(limit))]


# =============================================================================
# Engine (singleton)
# =============================================================================

class TerminologyEngine:
    def __init__(self, cfg: TerminologyConfig) -> None:
        self.cfg = cfg
        os.makedirs(cfg.cache_dir, exist_ok=True)
        self.http = HttpJsonClient(cfg)

        self._bindings = _load_bindings()
        self._memo_lock = threading.Lock()
        self._vsl_memo: Dict[Tuple[str, int], ValueSetLoader] = {}

        # Lazy init (SNOMED)
        self._snomed_lock = threading.Lock()
        self._snomed_instance: Any = None

        # Optional small "usage memory" (stores only codes, not PHI)
        self._usage_db_path = os.path.join(cfg.cache_dir, "usage.sqlite3")
        self._init_usage_db()

    def _init_usage_db(self) -> None:
        try:
            con = sqlite3.connect(self._usage_db_path)
            con.execute(
                "CREATE TABLE IF NOT EXISTS usage ("
                "fhirpath TEXT NOT NULL, system TEXT NOT NULL, code TEXT NOT NULL, "
                "display TEXT NOT NULL DEFAULT '', used_at REAL NOT NULL"
                ");"
            )
            con.execute("CREATE INDEX IF NOT EXISTS usage_idx ON usage(fhirpath, used_at);")
            con.commit()
            con.close()
        except Exception as e:
            logger.debug("Usage DB init failed: %s", e)

    def _record_usage(self, fhirpath: str, system: str, code: str, display: str = "") -> None:
        try:
            con = sqlite3.connect(self._usage_db_path)
            con.execute(
                "INSERT INTO usage(fhirpath, system, code, display, used_at) VALUES (?, ?, ?, ?, ?)",
                (fhirpath, system, code, display or "", time.time()),
            )
            con.commit()
            con.close()
        except Exception:
            pass

    def top_used(self, fhirpath: str, limit: int = 10) -> List[Dict[str, Any]]:
        try:
            con = sqlite3.connect(self._usage_db_path)
            cur = con.execute(
                "SELECT system, code, display, COUNT(*) as n FROM usage WHERE fhirpath=? "
                "GROUP BY system, code, display ORDER BY n DESC LIMIT ?",
                (fhirpath, int(limit)),
            )
            rows = cur.fetchall()
            con.close()
            return [{"system": s, "code": c, "display": d, "count": n} for s, c, d, n in rows]
        except Exception:
            return []

    def supported_fhirpaths(self) -> List[Dict[str, Any]]:
        out = []
        for fp, info in sorted(self._bindings.items()):
            out.append({"fhirpath": fp, "valueset": info.get("vs"), "type": info.get("type")})
        return out

    def binding_info(self, fhirpath: str) -> Dict[str, Any]:
        if fhirpath not in self._bindings:
            # attempt a helpful fuzzy hint
            suggestions = [k for k in self._bindings.keys() if k.lower().endswith(fhirpath.lower())][:10]
            raise ValueError(f"Unknown fhirpath '{fhirpath}'. Suggestions: {suggestions}")
        info = self._bindings[fhirpath]
        vsl = self._get_vsl(info["vs"])
        return {
            "fhirpath": fhirpath,
            "valueset": info["vs"],
            "type": info.get("type"),
            "count": vsl.count(),
            "codeSystems": vsl.list_code_systems(),
            "topUsed": self.top_used(fhirpath, limit=8),
            "txServer": self.cfg.fhir_tx_server,
            "snomedEnabled": bool(self.cfg.snomed_enabled and _INFHERNO_AVAILABLE),
        }

    def _get_snomed_instance(self) -> Any:
        if not (self.cfg.snomed_enabled and _INFHERNO_AVAILABLE):
            return None
        # License guardrail (opt-in)
        if not _snomed_license_acknowledged(self.cfg):
            raise PermissionError(
                f"SNOMED access disabled until you set {self.cfg.snomed_license_ack_env}=true (license acknowledgement)."
            )
        with self._snomed_lock:
            if self._snomed_instance is not None:
                return self._snomed_instance
            url = self.cfg.snowstorm_url or (determine_snowstorm_url() if determine_snowstorm_url else None)
            branch = self.cfg.snowstorm_branch or (determine_snowstorm_branch() if determine_snowstorm_branch else None)
            if not url:
                raise RuntimeError("Snowstorm URL not configured (set FHIR_TERMINOLOGY_SNOWSTORM_URL).")
            self._snomed_instance = GenericSnomedInstance(url, branch=branch)
            return self._snomed_instance

    def _get_vsl(self, valueset_url: str) -> ValueSetLoader:
        valueset_url = _CODESYSTEM_REDIRECT.get(valueset_url, valueset_url)
        key = (valueset_url, self.cfg.store_threshold)
        with self._memo_lock:
            if key in self._vsl_memo:
                return self._vsl_memo[key]
        snomed_instance = None
        if self.cfg.snomed_enabled and _INFHERNO_AVAILABLE:
            try:
                snomed_instance = self._get_snomed_instance()
            except Exception as e:
                # Do not fail completely if SNOMED isn't available
                logger.info("SNOMED unavailable: %s", e)
        vsl = ValueSetLoader.from_url(
            valueset_url,
            store_threshold=self.cfg.store_threshold,
            snomed_instance=snomed_instance,
            http=self.http,
            cfg=self.cfg,
        )
        with self._memo_lock:
            self._vsl_memo[key] = vsl
        return vsl

    def resolve_target(self, *, fhirpath: Optional[str], valueset_url: Optional[str]) -> Tuple[str, Optional[str], Optional[str]]:
        """
        Returns (valueset_url, binding_type, fhirpath)
        """
        if fhirpath:
            if fhirpath not in self._bindings:
                raise ValueError(f"Unknown fhirpath '{fhirpath}'. Use action=list_bindings.")
            info = self._bindings[fhirpath]
            return info["vs"], info.get("type"), fhirpath
        if valueset_url:
            return valueset_url, None, None
        raise ValueError("Provide either fhirpath or valueset_url.")

    def search(self, *, fhirpath: Optional[str], valueset_url: Optional[str], query: str, limit: int) -> Dict[str, Any]:
        if not query:
            raise ValueError("query must be non-empty")
        query = query[: self.cfg.max_query_chars]
        limit = max(1, min(int(limit), self.cfg.max_results_limit))

        vs_url, binding_type, fp = self.resolve_target(fhirpath=fhirpath, valueset_url=valueset_url)
        vsl = self._get_vsl(vs_url)
        results = vsl.search(query=query, limit=limit)
        return {
            "valueset": vs_url,
            "fhirpath": fp,
            "bindingType": binding_type,
            "query": query,
            "results": results,
            "resultCount": len(results),
        }

    def lookup(self, *, fhirpath: Optional[str], valueset_url: Optional[str], code: str, system: Optional[str]) -> Dict[str, Any]:
        vs_url, binding_type, fp = self.resolve_target(fhirpath=fhirpath, valueset_url=valueset_url)
        vsl = self._get_vsl(vs_url)
        concept = vsl.getByCode(code=code, system=system)
        return {"valueset": vs_url, "fhirpath": fp, "bindingType": binding_type, "concept": concept}

    def validate(self, *, fhirpath: Optional[str], valueset_url: Optional[str], coding: Dict[str, Any]) -> Dict[str, Any]:
        vs_url, binding_type, fp = self.resolve_target(fhirpath=fhirpath, valueset_url=valueset_url)
        vsl = self._get_vsl(vs_url)

        codings = _extract_codings(coding)
        if not codings:
            raise ValueError("No Coding found. Provide a Coding ({system, code}) or CodeableConcept ({coding:[...]})")
        checks = []
        ok_any = False
        for c in codings:
            code = str(c.get("code", ""))
            system = c.get("system")
            res = vsl.validate_code(code=code, system=system)
            ok = bool(res.get("ok"))
            ok_any = ok_any or ok
            checks.append(
                {
                    "input": {"system": system, "code": code, "display": c.get("display")},
                    "ok": ok,
                    "concept": res.get("concept"),
                    "details": res.get("details"),
                }
            )
            if ok and fp:
                self._record_usage(fp, system or (res.get("concept") or {}).get("system", ""), code, c.get("display") or "")

        return {
            "valueset": vs_url,
            "fhirpath": fp,
            "bindingType": binding_type,
            "ok": ok_any,
            "checks": checks,
        }

    def suggest(self, *, fhirpath: Optional[str], valueset_url: Optional[str], text: str, limit: int) -> Dict[str, Any]:
        """
        Suggest codings for a binding given free text.
        """
        text = (text or "")[: self.cfg.max_query_chars]
        if not text.strip():
            raise ValueError("text must be non-empty")
        limit = max(1, min(int(limit), self.cfg.max_results_limit))

        vs_url, binding_type, fp = self.resolve_target(fhirpath=fhirpath, valueset_url=valueset_url)
        vsl = self._get_vsl(vs_url)

        # 1) Use VS search
        candidates = vsl.search(query=text, limit=limit)

        # 2) If the VS is a small 'code' enum, propose exact matches for common synonyms
        heur = _heuristic_code_aliases(fp or "", text)
        if heur:
            for code in heur:
                c = vsl.getByCode(code=code, system=None)
                if c:
                    candidates.insert(0, dict(c, score=1.0))

        candidates = _rank_and_dedupe(candidates, query=text, limit=limit)

        return {
            "valueset": vs_url,
            "fhirpath": fp,
            "bindingType": binding_type,
            "text": text,
            "suggestions": candidates,
            "resultCount": len(candidates),
            "note": "Suggestions are best-effort and must be reviewed by a qualified reviewer.",
        }

    def record_usage(self, *, fhirpath: str, system: str, code: str, display: str = "") -> Dict[str, Any]:
        """
        Record a terminology choice for ranking boosts (stores only code-level metadata).
        """
        if fhirpath not in self._bindings:
            raise ValueError(f"Unknown fhirpath '{fhirpath}'. Use action=list_bindings.")
        code = str(code or "").strip()
        if not code:
            raise ValueError("code is required")
        self._record_usage(fhirpath, str(system or ""), code, str(display or ""))
        return {
            "fhirpath": fhirpath,
            "recorded": True,
            "topUsed": self.top_used(fhirpath, limit=10),
        }

    def audit_resource_terminology(
        self,
        *,
        resource: Dict[str, Any],
        include_suggestions: bool = True,
    ) -> Dict[str, Any]:
        """
        Audit a FHIR resource's bound terminology fields using configured bindings.
        """
        if not isinstance(resource, dict):
            raise ValueError("resource must be an object")
        resource_type = resource.get("resourceType")
        if not isinstance(resource_type, str) or not resource_type.strip():
            raise ValueError("resource.resourceType is required")

        checked = 0
        ok_count = 0
        issues: List[Dict[str, Any]] = []
        prefix = f"{resource_type}."

        for fhirpath, meta in sorted(self._bindings.items()):
            if not fhirpath.startswith(prefix):
                continue

            path_tail = fhirpath.split(".", 1)[1]
            segments = path_tail.split(".")
            matches = _extract_path_values(resource, segments, ptr="")
            expected_type = str(meta.get("type") or "")
            valueset = str(meta.get("vs") or "")

            for pointer, value in matches:
                checked += 1
                issue: Dict[str, Any] = {
                    "pointer": pointer,
                    "fhirpath": fhirpath,
                    "valueset": valueset,
                    "expectedType": expected_type,
                    "provided": _minimal_provided(value),
                    "ok": False,
                }

                if expected_type == "code":
                    if not isinstance(value, str):
                        issue["reason"] = "Expected a string code value."
                        issues.append(issue)
                        continue

                    result = self.validate(
                        fhirpath=fhirpath,
                        valueset_url=None,
                        coding={"code": value, "system": None},
                    )
                    ok = bool(result.get("ok"))
                    issue["ok"] = ok
                    issue["reason"] = (
                        "Code validated against ValueSet."
                        if ok
                        else "Code not found in ValueSet."
                    )
                    if ok:
                        ok_count += 1
                        issues.append(issue)
                        continue

                    if include_suggestions:
                        query = _extract_suggestion_query(value)
                        if query.strip():
                            suggestions = self.suggest(
                                fhirpath=fhirpath,
                                valueset_url=None,
                                text=query,
                                limit=3,
                            ).get("suggestions", [])
                            issue["suggestions"] = suggestions
                    issues.append(issue)
                    continue

                if expected_type == "coding":
                    if not isinstance(value, dict):
                        issue["reason"] = "Expected a Coding or CodeableConcept object."
                        issues.append(issue)
                        continue

                    issue["providedKind"] = (
                        "codeableconcept" if _is_codeable_concept(value) else "coding" if _is_coding(value) else "unknown"
                    )
                    result = self.validate(
                        fhirpath=fhirpath,
                        valueset_url=None,
                        coding=value,
                    )
                    ok = bool(result.get("ok"))
                    issue["ok"] = ok
                    issue["reason"] = (
                        "At least one coding validated against ValueSet."
                        if ok
                        else "No coding in value validated against ValueSet."
                    )
                    if ok:
                        ok_count += 1
                        issues.append(issue)
                        continue

                    if include_suggestions:
                        query = _extract_suggestion_query(value)
                        if query.strip():
                            suggestions = self.suggest(
                                fhirpath=fhirpath,
                                valueset_url=None,
                                text=query,
                                limit=3,
                            ).get("suggestions", [])
                            issue["suggestions"] = suggestions
                    issues.append(issue)
                    continue

        invalid_issues = [i for i in issues if not bool(i.get("ok"))]
        return {
            "resourceType": resource_type,
            "checked": checked,
            "ok": ok_count,
            "invalid": len(invalid_issues),
            "issues": invalid_issues,
            "note": "Issues include only invalid terminology bindings.",
        }

    def propose_terminology_patches(self, *, resource: Dict[str, Any], max_patches: int = 10) -> Dict[str, Any]:
        """
        Propose conservative JSON Patch operations for invalid terminology bindings.
        """
        max_patches = max(1, min(int(max_patches), 100))
        audit = self.audit_resource_terminology(resource=resource, include_suggestions=True)
        issues = audit.get("issues") or []
        patches: List[Dict[str, Any]] = []
        addressed: List[Dict[str, Any]] = []

        def _append_patch(op: Dict[str, Any]) -> bool:
            if len(patches) >= max_patches:
                return False
            patches.append(op)
            return True

        for issue in issues:
            if len(patches) >= max_patches:
                break
            suggestions = issue.get("suggestions") or []
            if not suggestions:
                continue
            best = suggestions[0]
            pointer = str(issue.get("pointer") or "")
            expected_type = str(issue.get("expectedType") or "")
            if not pointer.startswith("/"):
                continue

            if expected_type == "code":
                code = best.get("code")
                if code is None:
                    continue
                if not _append_patch({"op": "replace", "path": pointer, "value": str(code)}):
                    break
                addressed.append({"pointer": pointer, "from": issue.get("provided"), "to": best})
                continue

            if expected_type != "coding":
                continue

            found, target = _resolve_json_pointer(resource, pointer)
            if not found or not isinstance(target, dict):
                continue

            code = best.get("code")
            system = best.get("system")
            display = best.get("description")
            if code is None:
                continue

            if _is_codeable_concept(target):
                coding_list = target.get("coding")
                if isinstance(coding_list, list) and coding_list and isinstance(coding_list[0], dict):
                    first = coding_list[0]
                    if system is not None:
                        if not _append_patch(
                            {
                                "op": "replace" if "system" in first else "add",
                                "path": f"{pointer}/coding/0/system",
                                "value": str(system),
                            }
                        ):
                            break
                    if not _append_patch(
                        {
                            "op": "replace" if "code" in first else "add",
                            "path": f"{pointer}/coding/0/code",
                            "value": str(code),
                        }
                    ):
                        break
                    if display:
                        if not _append_patch(
                            {
                                "op": "replace" if "display" in first else "add",
                                "path": f"{pointer}/coding/0/display",
                                "value": str(display),
                            }
                        ):
                            break
                else:
                    new_coding: Dict[str, Any] = {"code": str(code)}
                    if system is not None:
                        new_coding["system"] = str(system)
                    if display:
                        new_coding["display"] = str(display)
                    if not _append_patch({"op": "add", "path": f"{pointer}/coding", "value": [new_coding]}):
                        break
                addressed.append({"pointer": pointer, "from": issue.get("provided"), "to": best})
                continue

            if _is_coding(target):
                if system is not None:
                    if not _append_patch(
                        {
                            "op": "replace" if "system" in target else "add",
                            "path": f"{pointer}/system",
                            "value": str(system),
                        }
                    ):
                        break
                if not _append_patch(
                    {
                        "op": "replace" if "code" in target else "add",
                        "path": f"{pointer}/code",
                        "value": str(code),
                    }
                ):
                    break
                if display:
                    if not _append_patch(
                        {
                            "op": "replace" if "display" in target else "add",
                            "path": f"{pointer}/display",
                            "value": str(display),
                        }
                    ):
                        break
                addressed.append({"pointer": pointer, "from": issue.get("provided"), "to": best})

        return {
            "resourceType": audit.get("resourceType"),
            "invalid": audit.get("invalid"),
            "patches": patches,
            "addressed": addressed,
            "note": "Patches are suggestions and should be reviewed before applying.",
        }

    def generate_valueset(
        self,
        *,
        name: str,
        description: str,
        url: Optional[str],
        concepts: Optional[List[Dict[str, Any]]],
        snomed_roots: Optional[List[str]],
    ) -> Dict[str, Any]:
        """
        Build a draft FHIR ValueSet resource.
        """
        if not name.strip():
            raise ValueError("name is required")
        if not description.strip():
            description = name

        compose_include: List[Dict[str, Any]] = []

        if concepts:
            # Group by system
            by_system: Dict[str, List[Dict[str, Any]]] = {}
            for c in concepts:
                code = c.get("code")
                system = c.get("system")
                if not code or not system:
                    continue
                by_system.setdefault(str(system), []).append({"code": str(code), "display": c.get("display")})
            for system, items in by_system.items():
                inc: Dict[str, Any] = {"system": system, "concept": []}
                for it in items:
                    cc = {"code": it["code"]}
                    if it.get("display"):
                        cc["display"] = it["display"]
                    inc["concept"].append(cc)
                compose_include.append(inc)

        if snomed_roots:
            # Standard FHIR-style SNOMED include with is-a concept filters.
            filters = [{"property": "concept", "op": "is-a", "value": str(r)} for r in snomed_roots if str(r).strip()]
            if filters:
                compose_include.append({"system": "http://snomed.info/sct", "filter": filters})

        if not compose_include:
            raise ValueError("Provide either concepts or snomed_roots.")

        vs: Dict[str, Any] = {
            "resourceType": "ValueSet",
            "status": "draft",
            "name": name,
            "description": description,
            "compose": {"include": compose_include},
        }
        if url:
            vs["url"] = url
        return vs

    def generate_conceptmap(
        self,
        *,
        name: str,
        description: str,
        source_system: str,
        target_system: str,
        mappings: List[Dict[str, Any]],
        url: Optional[str],
    ) -> Dict[str, Any]:
        """
        Build a draft FHIR ConceptMap resource.
        """
        if not name.strip():
            raise ValueError("name is required")
        if not mappings:
            raise ValueError("mappings is required")

        groups: List[Dict[str, Any]] = []
        group: Dict[str, Any] = {"source": source_system, "target": target_system, "element": []}
        for m in mappings:
            src = m.get("sourceCode")
            tgt = m.get("targetCode")
            if not src or not tgt:
                continue
            equivalence = m.get("equivalence") or "equivalent"
            comment = m.get("comment")
            element = {"code": str(src), "target": [{"code": str(tgt), "equivalence": str(equivalence)}]}
            if comment:
                element["target"][0]["comment"] = str(comment)
            group["element"].append(element)

        groups.append(group)

        cm: Dict[str, Any] = {
            "resourceType": "ConceptMap",
            "status": "draft",
            "name": name,
            "description": description or name,
            "group": groups,
        }
        if url:
            cm["url"] = url
        return cm

    def generate_ecl(self, roots: List[str]) -> str:
        roots = [str(r).strip() for r in roots if str(r).strip()]
        if not roots:
            raise ValueError("roots must be non-empty")
        if getECLfromConceptRoots:
            return str(getECLfromConceptRoots(roots))
        # Simple union of descendants
        return " OR ".join([f"<{r}" for r in roots])

    def snomed_concept_graph(self, concept_id: str, depth: int = 1) -> Dict[str, Any]:
        """
        Minimal concept graph using Snowstorm browser endpoints (if available).

        Uses cfg.snowstorm_url and cfg.snowstorm_branch (or infherno defaults).
        """
        if not (self.cfg.snomed_enabled and _INFHERNO_AVAILABLE):
            raise RuntimeError("SNOMED not enabled/unavailable.")
        if not _snomed_license_acknowledged(self.cfg):
            raise PermissionError(
                f"SNOMED access disabled until you set {self.cfg.snomed_license_ack_env}=true (license acknowledgement)."
            )

        url = self.cfg.snowstorm_url or (determine_snowstorm_url() if determine_snowstorm_url else None)
        branch = self.cfg.snowstorm_branch or (determine_snowstorm_branch() if determine_snowstorm_branch else "MAIN")
        if not url:
            raise RuntimeError("Snowstorm URL not configured.")
        base = url.rstrip("/")
        # Safety: allow snowstorm host even if it's not in allowed_domains (handled in _is_url_allowed by config)
        # For browser endpoints:
        concept_id = str(concept_id).strip()
        depth = max(1, min(int(depth), 5))

        def _get(path: str) -> Any:
            full = f"{base}{path}"
            if not _is_url_allowed(full, self.cfg):
                raise ValueError(f"URL not allowed by policy: {full}")
            r = self.http.session.get(full, timeout=self.cfg.http_timeout_s)
            r.raise_for_status()
            return r.json()

        # Browser endpoints documented in Snowstorm issues; actual availability depends on instance.
        node = _get(f"/browser/{branch}/concepts/{concept_id}")
        ancestors = _get(f"/browser/{branch}/concepts/{concept_id}/ancestors") if depth >= 1 else []
        children = _get(f"/browser/{branch}/concepts/{concept_id}/children") if depth >= 1 else []

        return {
            "concept": node,
            "ancestors": ancestors,
            "children": children,
            "note": "Graph results depend on Snowstorm configuration and branch content.",
        }

    def health(self) -> Dict[str, Any]:
        """
        Basic health / diagnostics report.
        """
        report: Dict[str, Any] = {
            "cacheDir": self.cfg.cache_dir,
            "httpTtlSeconds": self.cfg.http_ttl_s,
            "txServer": self.cfg.fhir_tx_server,
            "allowedDomains": list(self.cfg.allowed_domains),
            "allowPrivateNetworks": self.cfg.allow_private_networks,
            "snomedEnabled": bool(self.cfg.snomed_enabled),
            "infhernoAvailable": bool(_INFHERNO_AVAILABLE),
            "snowstormUrlConfigured": bool(self.cfg.snowstorm_url or determine_snowstorm_url),
            "snowstormBranch": self.cfg.snowstorm_branch or (determine_snowstorm_branch() if determine_snowstorm_branch else None),
        }

        # Quick connectivity checks (non-fatal)
        if self.cfg.fhir_tx_server:
            try:
                r = self.http.session.get(self.cfg.fhir_tx_server.rstrip("/") + "/metadata", timeout=5)
                report["txServerStatus"] = r.status_code
            except Exception as e:
                report["txServerStatus"] = f"error: {e}"

        if self.cfg.snomed_enabled and _INFHERNO_AVAILABLE:
            try:
                # Do not force SNOMED license ack here; just check URL parse.
                url = self.cfg.snowstorm_url or (determine_snowstorm_url() if determine_snowstorm_url else None)
                report["snowstormUrl"] = url
            except Exception as e:
                report["snowstormUrl"] = f"error: {e}"

        return report


_ENGINE: Optional[TerminologyEngine] = None
_ENGINE_LOCK = threading.Lock()


def get_engine() -> TerminologyEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            cfg = TerminologyConfig()
            _ENGINE = TerminologyEngine(cfg)
        return _ENGINE


# =============================================================================
# Input helpers (FHIR Coding / CodeableConcept)
# =============================================================================

def _extract_codings(obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Accept either:
      - Coding: {"system": "...", "code": "...", "display": "..."}
      - CodeableConcept: {"coding": [Coding, ...], "text": "..."}
    """
    if not isinstance(obj, dict):
        return []
    if "code" in obj and ("system" in obj or "display" in obj):
        return [obj]
    if "coding" in obj and isinstance(obj.get("coding"), list):
        return [c for c in obj["coding"] if isinstance(c, dict)]
    return []


def _heuristic_code_aliases(fhirpath: str, text: str) -> List[str]:
    """
    Tiny, safe heuristic map for 'code' enums where users often use abbreviations.

    This is intentionally narrow to avoid turning this tool into a diagnosis engine.
    """
    fp = fhirpath.lower().strip()
    t = text.lower().strip()

    if fp.endswith("patient.gender"):
        if t in ("m", "male", "man", "boy"):
            return ["male"]
        if t in ("f", "female", "woman", "girl"):
            return ["female"]
        if "nonbinary" in t or "non-binary" in t:
            return ["other"]
        if t in ("unknown", "unk", "u"):
            return ["unknown"]
    return []


def _json_pointer_escape(token: str) -> str:
    return str(token).replace("~", "~0").replace("/", "~1")


def _json_pointer_unescape(token: str) -> str:
    return str(token).replace("~1", "/").replace("~0", "~")


def _extract_path_values(obj: Any, segments: List[str], ptr: str = "") -> List[Tuple[str, Any]]:
    """
    Extract values matching a dotted path from dict/list structures.

    Returns a list of (json_pointer, value) pairs.
    """
    if not segments:
        return [(ptr or "/", obj)]

    seg = segments[0]
    rest = segments[1:]
    out: List[Tuple[str, Any]] = []

    if isinstance(obj, list):
        for i, item in enumerate(obj):
            out.extend(_extract_path_values(item, segments, f"{ptr}/{i}"))
        return out

    if isinstance(obj, dict):
        if seg not in obj:
            return []
        return _extract_path_values(obj.get(seg), rest, f"{ptr}/{_json_pointer_escape(seg)}")

    return []


def _resolve_json_pointer(doc: Any, pointer: str) -> Tuple[bool, Any]:
    """
    Resolve a JSON pointer against a document.

    Returns:
        (found, value)
    """
    if pointer in ("", "/"):
        return True, doc
    if not pointer.startswith("/"):
        return False, None

    cur: Any = doc
    for raw_token in pointer.split("/")[1:]:
        token = _json_pointer_unescape(raw_token)
        if isinstance(cur, list):
            try:
                idx = int(token)
            except Exception:
                return False, None
            if idx < 0 or idx >= len(cur):
                return False, None
            cur = cur[idx]
            continue
        if isinstance(cur, dict):
            if token not in cur:
                return False, None
            cur = cur[token]
            continue
        return False, None
    return True, cur


def _is_codeable_concept(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("coding"), list)


def _is_coding(value: Any) -> bool:
    return isinstance(value, dict) and "code" in value and not isinstance(value.get("coding"), list)


def _minimal_provided(value: Any) -> Dict[str, Any]:
    """
    Return a reduced representation safe for audit output.
    """
    if isinstance(value, str):
        return {"code": value}
    if _is_codeable_concept(value):
        codings = []
        for c in value.get("coding", []):
            if isinstance(c, dict):
                codings.append(
                    {
                        "system": c.get("system"),
                        "code": c.get("code"),
                        "display": c.get("display"),
                    }
                )
        out: Dict[str, Any] = {"coding": codings}
        if isinstance(value.get("text"), str) and value.get("text"):
            out["text"] = value.get("text")
        return out
    if _is_coding(value):
        return {
            "system": value.get("system"),
            "code": value.get("code"),
            "display": value.get("display"),
        }
    return {"valueType": type(value).__name__}


def _extract_suggestion_query(value: Any) -> str:
    if isinstance(value, str):
        return value
    if _is_codeable_concept(value):
        text = value.get("text")
        if isinstance(text, str) and text.strip():
            return text
        for c in value.get("coding", []):
            if isinstance(c, dict):
                if c.get("display"):
                    return str(c.get("display"))
                if c.get("code"):
                    return str(c.get("code"))
        return ""
    if _is_coding(value):
        if value.get("display"):
            return str(value.get("display"))
        if value.get("code"):
            return str(value.get("code"))
    return ""


# =============================================================================
# Strands module-based tool
# =============================================================================

TOOL_SPEC = {
    "name": "fhir_terminology_copilot",
    "description": (
        "FHIR Terminology Copilot: search/lookup/validate codings against HL7 ValueSets, "
        "optionally query SNOMED via Snowstorm, and generate draft ValueSet/ConceptMap/ECL artifacts. "
        "Safe-by-default: caches only public terminology resources and enforces URL allow-lists."
    ),
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Which operation to perform.",
                    "enum": [
                        "list_bindings",
                        "binding_info",
                        "search",
                        "lookup",
                        "validate",
                        "suggest",
                        "record_usage",
                        "audit_resource_terminology",
                        "propose_terminology_patches",
                        "generate_valueset",
                        "generate_conceptmap",
                        "generate_ecl",
                        "snomed_concept_graph",
                        "health",
                    ],
                },
                "fhirpath": {"type": "string", "description": "FHIRPath key such as 'Patient.gender'."},
                "valueset_url": {"type": "string", "description": "Canonical ValueSet URL (if not using fhirpath)."},
                "query": {"type": "string", "description": "Search query (free text)."},
                "code": {"type": "string", "description": "Code to lookup/validate."},
                "system": {"type": "string", "description": "CodeSystem URL (optional)."},
                "display": {"type": "string", "description": "Display text for validate fallback coding input."},
                "coding": {"type": "object", "description": "FHIR Coding or CodeableConcept object."},
                "text": {"type": "string", "description": "Free text to suggest a code for."},
                "resource": {"type": "object", "description": "FHIR resource payload for terminology audit/patch actions."},
                "include_suggestions": {
                    "type": "boolean",
                    "description": "Whether to include ranked terminology suggestions in audit output.",
                    "default": True,
                },
                "max_patches": {"type": "integer", "description": "Maximum number of suggested JSON patches.", "default": 10},
                "limit": {"type": "integer", "description": "Max number of results.", "default": 20},
                "name": {"type": "string", "description": "Name for generated artifacts (ValueSet/ConceptMap)."},
                "description": {"type": "string", "description": "Description for generated artifacts."},
                "url": {"type": "string", "description": "Canonical URL for generated artifacts (optional)."},
                "concepts": {
                    "type": "array",
                    "description": "Explicit concepts for ValueSet generation.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "system": {"type": "string"},
                            "code": {"type": "string"},
                            "display": {"type": "string"},
                        },
                        "required": ["system", "code"],
                    },
                },
                "snomed_roots": {
                    "type": "array",
                    "description": "SNOMED root concept IDs for ValueSet/ECL generation.",
                    "items": {"type": "string"},
                },
                "source_system": {"type": "string", "description": "ConceptMap source CodeSystem URL."},
                "target_system": {"type": "string", "description": "ConceptMap target CodeSystem URL."},
                "mappings": {
                    "type": "array",
                    "description": "ConceptMap mappings: {sourceCode,targetCode,equivalence?,comment?}.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "sourceCode": {"type": "string"},
                            "targetCode": {"type": "string"},
                            "equivalence": {"type": "string"},
                            "comment": {"type": "string"},
                        },
                        "required": ["sourceCode", "targetCode"],
                    },
                },
                "concept_id": {"type": "string", "description": "SNOMED conceptId for graph query."},
                "depth": {"type": "integer", "description": "Graph depth (1-5).", "default": 1},
            },
            "required": ["action"],
        }
    },
}


def _tool_success(tool_use_id: Optional[str], *, text: Optional[str] = None, json_obj: Optional[Dict[str, Any]] = None) -> ToolResult:
    content: List[Dict[str, Any]] = []
    if text is not None:
        content.append({"text": text})
    if json_obj is not None:
        content.append({"json": json_obj})
    out: ToolResult = {"status": "success", "content": content}
    if tool_use_id:
        out["toolUseId"] = tool_use_id
    return out


def _tool_error(tool_use_id: Optional[str], msg: str) -> ToolResult:
    out: ToolResult = {"status": "error", "content": [{"text": msg}]}
    if tool_use_id:
        out["toolUseId"] = tool_use_id
    return out


def fhir_terminology_copilot(tool: ToolUse, **kwargs: Any) -> ToolResult:
    """
    Strands module-based tool entrypoint. Dispatches based on action.
    """
    tool_use_id = tool.get("toolUseId")
    inp = tool.get("input") or {}
    debug_errors = _env_bool("FHIR_TERMINOLOGY_DEBUG", False)
    try:
        action = inp.get("action")
        engine = get_engine()
        debug_errors = bool(engine.cfg.debug)

        if action == "list_bindings":
            return _tool_success(tool_use_id, json_obj={"bindings": engine.supported_fhirpaths()})

        if action == "binding_info":
            fp = inp.get("fhirpath")
            if not fp:
                return _tool_error(tool_use_id, "binding_info requires fhirpath")
            return _tool_success(tool_use_id, json_obj=engine.binding_info(fp))

        if action == "search":
            limit = int(inp.get("limit", 20))
            q = inp.get("query") or ""
            res = engine.search(
                fhirpath=inp.get("fhirpath"),
                valueset_url=inp.get("valueset_url"),
                query=q,
                limit=limit,
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "lookup":
            code = inp.get("code")
            if not code:
                return _tool_error(tool_use_id, "lookup requires code")
            res = engine.lookup(
                fhirpath=inp.get("fhirpath"),
                valueset_url=inp.get("valueset_url"),
                code=str(code),
                system=inp.get("system"),
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "validate":
            coding = inp.get("coding")
            if not isinstance(coding, dict):
                # also accept {code, system} at top level
                if inp.get("code"):
                    coding = {"code": inp.get("code"), "system": inp.get("system"), "display": inp.get("display")}
                else:
                    return _tool_error(tool_use_id, "validate requires coding (Coding or CodeableConcept) or code/system.")
            res = engine.validate(
                fhirpath=inp.get("fhirpath"),
                valueset_url=inp.get("valueset_url"),
                coding=coding,
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "suggest":
            text = inp.get("text") or inp.get("query") or ""
            limit = int(inp.get("limit", 10))
            res = engine.suggest(
                fhirpath=inp.get("fhirpath"),
                valueset_url=inp.get("valueset_url"),
                text=text,
                limit=limit,
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "record_usage":
            fhirpath = inp.get("fhirpath")
            code = inp.get("code")
            if not fhirpath:
                return _tool_error(tool_use_id, "record_usage requires fhirpath")
            if not code:
                return _tool_error(tool_use_id, "record_usage requires code")
            res = engine.record_usage(
                fhirpath=str(fhirpath),
                system=str(inp.get("system") or ""),
                code=str(code),
                display=str(inp.get("display") or ""),
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "audit_resource_terminology":
            resource = inp.get("resource")
            if not isinstance(resource, dict):
                return _tool_error(tool_use_id, "audit_resource_terminology requires resource object")
            include_suggestions = bool(inp.get("include_suggestions", True))
            res = engine.audit_resource_terminology(
                resource=resource,
                include_suggestions=include_suggestions,
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "propose_terminology_patches":
            resource = inp.get("resource")
            if not isinstance(resource, dict):
                return _tool_error(tool_use_id, "propose_terminology_patches requires resource object")
            max_patches = int(inp.get("max_patches", 10))
            res = engine.propose_terminology_patches(
                resource=resource,
                max_patches=max_patches,
            )
            return _tool_success(tool_use_id, json_obj=res)

        if action == "generate_valueset":
            name = inp.get("name") or ""
            description = inp.get("description") or ""
            url = inp.get("url")
            concepts = inp.get("concepts")
            snomed_roots = inp.get("snomed_roots")
            if concepts is not None and not isinstance(concepts, list):
                return _tool_error(tool_use_id, "concepts must be an array")
            if snomed_roots is not None and not isinstance(snomed_roots, list):
                return _tool_error(tool_use_id, "snomed_roots must be an array")
            vs = engine.generate_valueset(
                name=str(name),
                description=str(description),
                url=str(url) if url else None,
                concepts=concepts,
                snomed_roots=snomed_roots,
            )
            return _tool_success(tool_use_id, json_obj={"valueset": vs})

        if action == "generate_conceptmap":
            name = inp.get("name") or ""
            description = inp.get("description") or ""
            source_system = inp.get("source_system") or ""
            target_system = inp.get("target_system") or ""
            mappings = inp.get("mappings") or []
            url = inp.get("url")
            if not isinstance(mappings, list):
                return _tool_error(tool_use_id, "mappings must be an array")
            cm = engine.generate_conceptmap(
                name=str(name),
                description=str(description),
                source_system=str(source_system),
                target_system=str(target_system),
                mappings=mappings,
                url=str(url) if url else None,
            )
            return _tool_success(tool_use_id, json_obj={"conceptmap": cm})

        if action == "generate_ecl":
            roots = inp.get("snomed_roots") or []
            if not isinstance(roots, list):
                return _tool_error(tool_use_id, "snomed_roots must be an array")
            ecl = engine.generate_ecl([str(r) for r in roots])
            return _tool_success(tool_use_id, json_obj={"ecl": ecl})

        if action == "snomed_concept_graph":
            concept_id = inp.get("concept_id")
            depth = int(inp.get("depth", 1))
            if not concept_id:
                return _tool_error(tool_use_id, "snomed_concept_graph requires concept_id")
            graph = engine.snomed_concept_graph(str(concept_id), depth=depth)
            return _tool_success(tool_use_id, json_obj=graph)

        if action == "health":
            return _tool_success(tool_use_id, json_obj=engine.health())

        return _tool_error(
            tool_use_id,
            f"Unknown action '{action}'. Allowed: {TOOL_SPEC['inputSchema']['json']['properties']['action']['enum']}",
        )
    except Exception as e:
        # Avoid leaking sensitive input; keep errors compact by default.
        msg = str(e) if debug_errors else f"{type(e).__name__}: {str(e)}"
        return _tool_error(tool_use_id, msg)


def _dispatch_terminology_action(
    action: Literal[
        "list_bindings",
        "binding_info",
        "search",
        "lookup",
        "validate",
        "suggest",
        "record_usage",
        "audit_resource_terminology",
        "propose_terminology_patches",
        "generate_valueset",
        "generate_conceptmap",
        "generate_ecl",
        "snomed_concept_graph",
        "health",
    ],
    *,
    fhirpath: str | None = None,
    valueset_url: str | None = None,
    query: str | None = None,
    code: str | None = None,
    system: str | None = None,
    display: str | None = None,
    coding: dict[str, Any] | None = None,
    text: str | None = None,
    resource: dict[str, Any] | None = None,
    include_suggestions: bool = True,
    max_patches: int = 10,
    limit: int = 20,
    name: str | None = None,
    description: str | None = None,
    url: str | None = None,
    concepts: list[dict[str, Any]] | None = None,
    snomed_roots: list[str] | None = None,
    source_system: str | None = None,
    target_system: str | None = None,
    mappings: list[dict[str, Any]] | None = None,
    concept_id: str | None = None,
    depth: int = 1,
) -> ToolResult:
    """Build module-style tool input and dispatch to the single implementation path."""
    tool_input: dict[str, Any] = {"action": action}
    optional_fields: dict[str, Any] = {
        "fhirpath": fhirpath,
        "valueset_url": valueset_url,
        "query": query,
        "code": code,
        "system": system,
        "display": display,
        "coding": coding,
        "text": text,
        "resource": resource,
        "name": name,
        "description": description,
        "url": url,
        "concepts": concepts,
        "snomed_roots": snomed_roots,
        "source_system": source_system,
        "target_system": target_system,
        "mappings": mappings,
        "concept_id": concept_id,
    }
    for key, value in optional_fields.items():
        if value is not None:
            tool_input[key] = value

    tool_input["limit"] = int(limit)
    tool_input["depth"] = int(depth)
    tool_input["include_suggestions"] = bool(include_suggestions)
    tool_input["max_patches"] = int(max_patches)

    return fhir_terminology_copilot({"input": tool_input})  # type: ignore[arg-type]


@strands_tool(
    name="fhir.terminology.dispatch",
    description=(
        "Dispatch endpoint for all FHIR Terminology Copilot actions. "
        "Use action-specific tools when available."
    ),
)
def fhir_terminology_copilot_tool(
    action: Literal[
        "list_bindings",
        "binding_info",
        "search",
        "lookup",
        "validate",
        "suggest",
        "record_usage",
        "audit_resource_terminology",
        "propose_terminology_patches",
        "generate_valueset",
        "generate_conceptmap",
        "generate_ecl",
        "snomed_concept_graph",
        "health",
    ],
    fhirpath: str | None = None,
    valueset_url: str | None = None,
    query: str | None = None,
    code: str | None = None,
    system: str | None = None,
    display: str | None = None,
    coding: dict[str, Any] | None = None,
    text: str | None = None,
    resource: dict[str, Any] | None = None,
    include_suggestions: bool = True,
    max_patches: int = 10,
    limit: int = 20,
    name: str | None = None,
    description: str | None = None,
    url: str | None = None,
    concepts: list[dict[str, Any]] | None = None,
    snomed_roots: list[str] | None = None,
    source_system: str | None = None,
    target_system: str | None = None,
    mappings: list[dict[str, Any]] | None = None,
    concept_id: str | None = None,
    depth: int = 1,
) -> ToolResult:
    """Run FHIR terminology actions as a Strands decorated tool.

    Args:
        action: Operation to execute (search/lookup/validate/suggest/generate/health).
        fhirpath: FHIRPath key such as ``Patient.gender``.
        valueset_url: Canonical ValueSet URL, used when ``fhirpath`` is not provided.
        query: Free-text query for search/suggest.
        code: Code to lookup or validate.
        system: CodeSystem URL for lookup/validate.
        display: Display text used with ``code`` during validate fallback.
        coding: FHIR Coding or CodeableConcept object.
        text: Free text input for suggestion generation.
        resource: FHIR resource payload for audit/patch actions.
        include_suggestions: Include suggested terminology candidates in audit output.
        max_patches: Maximum number of JSON patch operations to suggest.
        limit: Maximum number of returned results.
        name: Artifact name for ValueSet/ConceptMap generation.
        description: Artifact description for generation actions.
        url: Canonical URL for generated artifacts.
        concepts: Explicit concept rows for ValueSet generation.
        snomed_roots: SNOMED root concept IDs for ValueSet/ECL generation.
        source_system: Source CodeSystem URL for ConceptMap generation.
        target_system: Target CodeSystem URL for ConceptMap generation.
        mappings: ConceptMap mapping rows.
        concept_id: SNOMED concept ID for graph generation.
        depth: SNOMED graph traversal depth.

    Returns:
        ToolResult dictionary containing ``status`` and ``content``.
    """
    return _dispatch_terminology_action(
        action=action,
        fhirpath=fhirpath,
        valueset_url=valueset_url,
        query=query,
        code=code,
        system=system,
        display=display,
        coding=coding,
        text=text,
        resource=resource,
        include_suggestions=include_suggestions,
        max_patches=max_patches,
        name=name,
        description=description,
        url=url,
        concepts=concepts,
        snomed_roots=snomed_roots,
        source_system=source_system,
        target_system=target_system,
        mappings=mappings,
        concept_id=concept_id,
        limit=limit,
        depth=depth,
    )


@strands_tool(
    name="fhir.terminology.list_bindings",
    description="List all configured FHIRPath terminology bindings.",
)
def fhir_terminology_list_bindings_tool() -> ToolResult:
    return _dispatch_terminology_action("list_bindings")


@strands_tool(
    name="fhir.terminology.binding_info",
    description="Get binding metadata for one FHIRPath key.",
)
def fhir_terminology_binding_info_tool(fhirpath: str) -> ToolResult:
    return _dispatch_terminology_action("binding_info", fhirpath=fhirpath)


@strands_tool(
    name="fhir.terminology.search",
    description="Search ValueSet concepts by text for a binding or canonical ValueSet URL.",
)
def fhir_terminology_search_tool(
    query: str,
    fhirpath: str | None = None,
    valueset_url: str | None = None,
    limit: int = 20,
) -> ToolResult:
    return _dispatch_terminology_action(
        "search",
        query=query,
        fhirpath=fhirpath,
        valueset_url=valueset_url,
        limit=limit,
    )


@strands_tool(
    name="fhir.terminology.lookup",
    description="Lookup a code within a binding/ValueSet and return concept details.",
)
def fhir_terminology_lookup_tool(
    code: str,
    system: str | None = None,
    fhirpath: str | None = None,
    valueset_url: str | None = None,
) -> ToolResult:
    return _dispatch_terminology_action(
        "lookup",
        code=code,
        system=system,
        fhirpath=fhirpath,
        valueset_url=valueset_url,
    )


@strands_tool(
    name="fhir.terminology.validate",
    description="Validate Coding/CodeableConcept (or code/system) against terminology bindings.",
)
def fhir_terminology_validate_tool(
    coding: dict[str, Any] | None = None,
    code: str | None = None,
    system: str | None = None,
    display: str | None = None,
    fhirpath: str | None = None,
    valueset_url: str | None = None,
) -> ToolResult:
    return _dispatch_terminology_action(
        "validate",
        coding=coding,
        code=code,
        system=system,
        display=display,
        fhirpath=fhirpath,
        valueset_url=valueset_url,
    )


@strands_tool(
    name="fhir.terminology.suggest",
    description="Suggest likely terminology codes from free text.",
)
def fhir_terminology_suggest_tool(
    text: str | None = None,
    query: str | None = None,
    fhirpath: str | None = None,
    valueset_url: str | None = None,
    limit: int = 10,
) -> ToolResult:
    return _dispatch_terminology_action(
        "suggest",
        text=text,
        query=query,
        fhirpath=fhirpath,
        valueset_url=valueset_url,
        limit=limit,
    )


@strands_tool(
    name="fhir.terminology.record_usage",
    description="Record a selected binding code to boost future suggestion ranking.",
)
def fhir_terminology_record_usage_tool(
    fhirpath: str,
    code: str,
    system: str = "",
    display: str | None = None,
) -> ToolResult:
    return _dispatch_terminology_action(
        "record_usage",
        fhirpath=fhirpath,
        code=code,
        system=system,
        display=display,
    )


@strands_tool(
    name="fhir.terminology.audit_resource_terminology",
    description="Audit a FHIR resource for invalid terminology bindings.",
)
def fhir_terminology_audit_resource_terminology_tool(
    resource: dict[str, Any],
    include_suggestions: bool = True,
) -> ToolResult:
    return _dispatch_terminology_action(
        "audit_resource_terminology",
        resource=resource,
        include_suggestions=include_suggestions,
    )


@strands_tool(
    name="fhir.terminology.propose_terminology_patches",
    description="Propose conservative JSON Patch operations for invalid terminology fields.",
)
def fhir_terminology_propose_terminology_patches_tool(
    resource: dict[str, Any],
    max_patches: int = 10,
) -> ToolResult:
    return _dispatch_terminology_action(
        "propose_terminology_patches",
        resource=resource,
        max_patches=max_patches,
    )


@strands_tool(
    name="fhir.terminology.generate_valueset",
    description="Generate a draft FHIR ValueSet from explicit concepts and/or SNOMED roots.",
)
def fhir_terminology_generate_valueset_tool(
    name: str,
    description: str = "",
    url: str | None = None,
    concepts: list[dict[str, Any]] | None = None,
    snomed_roots: list[str] | None = None,
) -> ToolResult:
    return _dispatch_terminology_action(
        "generate_valueset",
        name=name,
        description=description,
        url=url,
        concepts=concepts,
        snomed_roots=snomed_roots,
    )


@strands_tool(
    name="fhir.terminology.generate_conceptmap",
    description="Generate a draft FHIR ConceptMap artifact.",
)
def fhir_terminology_generate_conceptmap_tool(
    name: str,
    source_system: str,
    target_system: str,
    mappings: list[dict[str, Any]],
    description: str = "",
    url: str | None = None,
) -> ToolResult:
    return _dispatch_terminology_action(
        "generate_conceptmap",
        name=name,
        source_system=source_system,
        target_system=target_system,
        mappings=mappings,
        description=description,
        url=url,
    )


@strands_tool(
    name="fhir.terminology.generate_ecl",
    description="Generate ECL expression from SNOMED root concept IDs.",
)
def fhir_terminology_generate_ecl_tool(snomed_roots: list[str]) -> ToolResult:
    return _dispatch_terminology_action("generate_ecl", snomed_roots=snomed_roots)


@strands_tool(
    name="fhir.terminology.snomed_concept_graph",
    description="Fetch SNOMED concept graph neighborhood for a concept ID.",
)
def fhir_terminology_snomed_concept_graph_tool(concept_id: str, depth: int = 1) -> ToolResult:
    return _dispatch_terminology_action("snomed_concept_graph", concept_id=concept_id, depth=depth)


@strands_tool(
    name="fhir.terminology.health",
    description="Health check for FHIR terminology engine and optional external dependencies.",
)
def fhir_terminology_health_tool() -> ToolResult:
    return _dispatch_terminology_action("health")


FHIR_TERMINOLOGY_STRANDS_TOOLS = [
    fhir_terminology_copilot_tool,
    fhir_terminology_list_bindings_tool,
    fhir_terminology_binding_info_tool,
    fhir_terminology_search_tool,
    fhir_terminology_lookup_tool,
    fhir_terminology_validate_tool,
    fhir_terminology_suggest_tool,
    fhir_terminology_record_usage_tool,
    fhir_terminology_audit_resource_terminology_tool,
    fhir_terminology_propose_terminology_patches_tool,
    fhir_terminology_generate_valueset_tool,
    fhir_terminology_generate_conceptmap_tool,
    fhir_terminology_generate_ecl_tool,
    fhir_terminology_snomed_concept_graph_tool,
    fhir_terminology_health_tool,
]


def get_fhir_terminology_strands_tools() -> list[Callable[..., Any]]:
    """Return all FHIR terminology Strands tools in a single list."""
    return FHIR_TERMINOLOGY_STRANDS_TOOLS.copy()


__all__ = [
    "TOOL_SPEC",
    "FHIR_TERMINOLOGY_STRANDS_TOOLS",
    "fhir_terminology_copilot",
    "fhir_terminology_copilot_tool",
    "fhir_terminology_list_bindings_tool",
    "fhir_terminology_binding_info_tool",
    "fhir_terminology_search_tool",
    "fhir_terminology_lookup_tool",
    "fhir_terminology_validate_tool",
    "fhir_terminology_suggest_tool",
    "fhir_terminology_record_usage_tool",
    "fhir_terminology_audit_resource_terminology_tool",
    "fhir_terminology_propose_terminology_patches_tool",
    "fhir_terminology_generate_valueset_tool",
    "fhir_terminology_generate_conceptmap_tool",
    "fhir_terminology_generate_ecl_tool",
    "fhir_terminology_snomed_concept_graph_tool",
    "fhir_terminology_health_tool",
    "get_fhir_terminology_strands_tools",
]
