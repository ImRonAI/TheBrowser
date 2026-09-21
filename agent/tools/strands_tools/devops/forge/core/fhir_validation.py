"""FHIR validation helpers for profile and terminology checks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


FHIR_R4_REQUIRED_FIELDS: dict[str, list[str]] = {
    "Patient": [],
    "Observation": ["status", "code"],
    "Encounter": ["status", "class"],
    "Condition": ["subject"],
    "MedicationRequest": ["status", "intent", "subject"],
    "Medication": [],
    "Bundle": ["type"],
}

FHIR_R4_ENUMS: dict[str, set[str]] = {
    "Patient.gender": {"male", "female", "other", "unknown"},
    "Observation.status": {
        "registered",
        "preliminary",
        "final",
        "amended",
        "corrected",
        "cancelled",
        "entered-in-error",
        "unknown",
    },
    "Encounter.status": {
        "planned",
        "arrived",
        "triaged",
        "in-progress",
        "onleave",
        "finished",
        "cancelled",
        "entered-in-error",
        "unknown",
    },
    "Condition.clinicalStatus": {
        "active",
        "recurrence",
        "relapse",
        "inactive",
        "remission",
        "resolved",
    },
    "Condition.verificationStatus": {
        "unconfirmed",
        "provisional",
        "differential",
        "confirmed",
        "refuted",
        "entered-in-error",
    },
    "MedicationRequest.status": {
        "active",
        "on-hold",
        "cancelled",
        "completed",
        "entered-in-error",
        "stopped",
        "draft",
        "unknown",
    },
    "MedicationRequest.intent": {
        "proposal",
        "plan",
        "order",
        "original-order",
        "reflex-order",
        "filler-order",
        "instance-order",
        "option",
    },
    "Bundle.type": {
        "document",
        "message",
        "transaction",
        "transaction-response",
        "batch",
        "batch-response",
        "history",
        "searchset",
        "collection",
    },
}

KNOWN_CODE_SYSTEMS: set[str] = {
    "http://loinc.org",
    "http://snomed.info/sct",
    "http://www.nlm.nih.gov/research/umls/rxnorm",
    "http://hl7.org/fhir/sid/icd-10",
    "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    "http://terminology.hl7.org/CodeSystem/observation-category",
    "http://terminology.hl7.org/CodeSystem/condition-clinical",
    "http://terminology.hl7.org/CodeSystem/condition-ver-status",
    "http://unitsofmeasure.org",
}

FHIR_RESOURCE_TYPE_PROFILES: dict[str, list[str]] = {
    "Patient": ["http://hl7.org/fhir/StructureDefinition/Patient"],
    "Observation": ["http://hl7.org/fhir/StructureDefinition/Observation"],
    "Encounter": ["http://hl7.org/fhir/StructureDefinition/Encounter"],
    "Condition": ["http://hl7.org/fhir/StructureDefinition/Condition"],
    "MedicationRequest": ["http://hl7.org/fhir/StructureDefinition/MedicationRequest"],
    "Medication": ["http://hl7.org/fhir/StructureDefinition/Medication"],
    "Bundle": ["http://hl7.org/fhir/StructureDefinition/Bundle"],
}

FIELD_SYSTEM_HINTS: list[tuple[str, set[str]]] = [
    ("Observation.code.coding", {"http://loinc.org"}),
    (
        "Condition.code.coding",
        {"http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10"},
    ),
    ("Encounter.class", {"http://terminology.hl7.org/CodeSystem/v3-ActCode"}),
    (
        "Medication.code.coding",
        {"http://www.nlm.nih.gov/research/umls/rxnorm"},
    ),
]


@dataclass
class ValidationIssue:
    severity: str
    code: str
    diagnostics: str
    expression: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "diagnostics": self.diagnostics,
            "expression": [self.expression] if self.expression else [],
        }


def validate_fhir_profile(
    resource: dict[str, Any],
    required_profiles: list[str] | None = None,
    required_fields_by_resource: dict[str, list[str]] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    """Validate core resource profile constraints and required fields."""
    issues: list[ValidationIssue] = []

    if not isinstance(resource, dict):
        issues.append(
            ValidationIssue(
                severity="error",
                code="structure",
                diagnostics="FHIR resource must be a JSON object",
                expression="",
            )
        )
        return _build_validation_result(issues, kind="profile")

    resource_type = resource.get("resourceType")
    if not isinstance(resource_type, str) or not resource_type:
        issues.append(
            ValidationIssue(
                severity="error",
                code="required",
                diagnostics="resourceType is required",
                expression="resourceType",
            )
        )
        return _build_validation_result(issues, kind="profile")

    required_fields_map = required_fields_by_resource or FHIR_R4_REQUIRED_FIELDS
    required_fields = required_fields_map.get(resource_type, [])
    for field_name in required_fields:
        if not _has_value(resource.get(field_name)):
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="required",
                    diagnostics=f"{resource_type}.{field_name} is required",
                    expression=field_name,
                )
            )

    _validate_known_enums(resource, resource_type, issues)
    _validate_profile_membership(resource, resource_type, required_profiles, strict, issues)

    return _build_validation_result(issues, kind="profile")


def validate_fhir_terminology(
    resource: dict[str, Any],
    allowed_systems: list[str] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    """Validate codings/code systems and basic terminology quality checks."""
    issues: list[ValidationIssue] = []

    if not isinstance(resource, dict):
        issues.append(
            ValidationIssue(
                severity="error",
                code="structure",
                diagnostics="FHIR resource must be a JSON object",
                expression="",
            )
        )
        return _build_validation_result(issues, kind="terminology")

    systems_allowlist = set(allowed_systems) if allowed_systems else KNOWN_CODE_SYSTEMS
    codings = _collect_codings(resource)

    for coding in codings:
        path = coding["path"]
        system = coding["system"]
        code = coding["code"]

        if system is None and code is not None and strict:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="required",
                    diagnostics="Coding.system is required when Coding.code is present in strict mode",
                    expression=path,
                )
            )

        if system is not None and code is None:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="required",
                    diagnostics="Coding.code is required when Coding.system is present",
                    expression=path,
                )
            )

        if system is not None and system not in systems_allowlist:
            severity = "error" if strict else "warning"
            issues.append(
                ValidationIssue(
                    severity=severity,
                    code="code-invalid",
                    diagnostics=f"Unknown code system: {system}",
                    expression=path,
                )
            )

        if system is not None:
            hint = _expected_systems_for_path(path)
            if hint is not None and system not in hint:
                severity = "error" if strict else "warning"
                issues.append(
                    ValidationIssue(
                        severity=severity,
                        code="business-rule",
                        diagnostics=(
                            f"Unexpected system '{system}' for {path}; expected one of {sorted(hint)}"
                        ),
                        expression=path,
                    )
                )

    return _build_validation_result(issues, kind="terminology")


def validate_fhir_resource(
    resource: dict[str, Any],
    required_profiles: list[str] | None = None,
    allowed_systems: list[str] | None = None,
    required_fields_by_resource: dict[str, list[str]] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    """
    Combined FHIR profile + terminology validation with OperationOutcome output.
    """
    profile_result = validate_fhir_profile(
        resource=resource,
        required_profiles=required_profiles,
        required_fields_by_resource=required_fields_by_resource,
        strict=strict,
    )
    terminology_result = validate_fhir_terminology(
        resource=resource,
        allowed_systems=allowed_systems,
        strict=strict,
    )

    all_issues = profile_result["issues"] + terminology_result["issues"]
    errors = sum(1 for issue in all_issues if issue["severity"] == "error")
    warnings = sum(1 for issue in all_issues if issue["severity"] == "warning")
    compliance_score = max(0, 100 - (errors * 20) - (warnings * 5))

    return {
        "ok": errors == 0,
        "kind": "fhir",
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "information": sum(1 for issue in all_issues if issue["severity"] == "information"),
            "complianceScore": compliance_score,
        },
        "profile": profile_result,
        "terminology": terminology_result,
        "issues": all_issues,
        "operationOutcome": _to_operation_outcome(all_issues),
    }


def _validate_known_enums(
    resource: dict[str, Any],
    resource_type: str,
    issues: list[ValidationIssue],
) -> None:
    for field_key, allowed_values in FHIR_R4_ENUMS.items():
        enum_resource, field_name = field_key.split(".", 1)
        if enum_resource != resource_type:
            continue
        value = resource.get(field_name)
        if value is None:
            continue

        # Allow CodeableConcept for some fields by looking for nested coding.code values.
        if isinstance(value, dict) and "coding" in value:
            codes = []
            coding = value.get("coding")
            if isinstance(coding, list):
                for item in coding:
                    if isinstance(item, dict) and isinstance(item.get("code"), str):
                        codes.append(item["code"])
            for code in codes:
                if code not in allowed_values:
                    issues.append(
                        ValidationIssue(
                            severity="error",
                            code="value",
                            diagnostics=(
                                f"Invalid value '{code}' for {resource_type}.{field_name}; "
                                f"allowed: {sorted(allowed_values)}"
                            ),
                            expression=field_name,
                        )
                    )
            continue

        if isinstance(value, str) and value not in allowed_values:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="value",
                    diagnostics=(
                        f"Invalid value '{value}' for {resource_type}.{field_name}; "
                        f"allowed: {sorted(allowed_values)}"
                    ),
                    expression=field_name,
                )
            )


def _validate_profile_membership(
    resource: dict[str, Any],
    resource_type: str,
    required_profiles: list[str] | None,
    strict: bool,
    issues: list[ValidationIssue],
) -> None:
    meta = resource.get("meta")
    meta_profiles: list[str] = []
    if isinstance(meta, dict):
        profiles = meta.get("profile")
        if isinstance(profiles, list):
            meta_profiles = [p for p in profiles if isinstance(p, str)]

    expected_profiles = required_profiles
    if expected_profiles is None and strict:
        expected_profiles = FHIR_RESOURCE_TYPE_PROFILES.get(resource_type, [])

    if expected_profiles:
        for profile in expected_profiles:
            if profile not in meta_profiles:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        code="required",
                        diagnostics=f"Missing required profile: {profile}",
                        expression="meta.profile",
                    )
                )
    elif strict and not meta_profiles:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="business-rule",
                diagnostics="No meta.profile declared; strict mode recommends declaring canonical profile URLs",
                expression="meta.profile",
            )
        )


def _collect_codings(resource: Any) -> list[dict[str, Any]]:
    codings: list[dict[str, Any]] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            # direct coding object
            if any(key in node for key in ("system", "code")) and not isinstance(node.get("coding"), list):
                system = node.get("system")
                code = node.get("code")
                codings.append(
                    {
                        "path": path or "$",
                        "system": system if isinstance(system, str) else None,
                        "code": code if isinstance(code, str) else None,
                    }
                )

            for key, value in node.items():
                next_path = f"{path}.{key}" if path else key
                walk(value, next_path)
        elif isinstance(node, list):
            for idx, item in enumerate(node):
                next_path = f"{path}[{idx}]" if path else f"[{idx}]"
                walk(item, next_path)

    walk(resource, "")
    return codings


def _expected_systems_for_path(path: str) -> set[str] | None:
    normalized = path.replace("[", ".").replace("]", "")
    for hint_path, systems in FIELD_SYSTEM_HINTS:
        if hint_path in normalized:
            return systems
    return None


def _build_validation_result(issues: list[ValidationIssue], kind: str) -> dict[str, Any]:
    issue_dicts = [issue.as_dict() for issue in issues]
    errors = sum(1 for issue in issue_dicts if issue["severity"] == "error")
    warnings = sum(1 for issue in issue_dicts if issue["severity"] == "warning")
    return {
        "ok": errors == 0,
        "kind": kind,
        "issues": issue_dicts,
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "information": sum(1 for issue in issue_dicts if issue["severity"] == "information"),
        },
        "operationOutcome": _to_operation_outcome(issue_dicts),
    }


def _to_operation_outcome(issues: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "resourceType": "OperationOutcome",
        "issue": [
            {
                "severity": issue["severity"],
                "code": issue["code"],
                "diagnostics": issue["diagnostics"],
                "expression": issue.get("expression", []),
            }
            for issue in issues
        ],
    }


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True

