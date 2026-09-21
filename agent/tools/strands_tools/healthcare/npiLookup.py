"""
NPI Registry lookup/search tool using CMS NPPES Read API v2.1 (no auth required).
"""

import logging
import os
from typing import Any

import requests
from strands import tool

logger = logging.getLogger(__name__)
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

NPPES_API_URL = "https://npiregistry.cms.hhs.gov/api/"
NPPES_VERSION = "2.1"
MAX_LIMIT = 200
MAX_SKIP = 1000
MAX_RECORDS = 1200

_ENUMERATION_TYPES = {"NPI-1", "NPI-2"}
_NAME_PURPOSES = {"AO", "PROVIDER"}
_ADDRESS_PURPOSES = {"LOCATION", "MAILING", "PRIMARY", "SECONDARY"}


def _normalize_bool_flag(value: bool | str | None, field: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "True" if value else "False"

    normalized = value.strip().lower()
    if normalized in {"true", "t", "1", "yes", "y"}:
        return "True"
    if normalized in {"false", "f", "0", "no", "n"}:
        return "False"
    raise ValueError(f"Invalid {field}: {value}. Use true/false.")


def _normalize_enum(value: str | None, allowed: set[str], field: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized not in allowed:
        raise ValueError(f"Invalid {field}: {value}. Allowed values: {sorted(allowed)}")
    return normalized


def _clean_params(params: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _validate_criteria(params: dict[str, Any]) -> None:
    number = params.get("number")
    if number is not None:
        number_text = str(number).strip()
        if len(number_text) != 10 or not number_text.isdigit():
            raise ValueError("number must be a 10-digit NPI.")

    limit = params.get("limit", 10)
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_LIMIT}.")

    skip = params.get("skip", 0)
    if skip < 0 or skip > MAX_SKIP:
        raise ValueError(f"skip must be between 0 and {MAX_SKIP}.")

    non_meta_fields = {
        "number",
        "enumeration_type",
        "taxonomy_description",
        "name_purpose",
        "first_name",
        "last_name",
        "organization_name",
        "address_purpose",
        "city",
        "state",
        "postal_code",
        "country_code",
    }
    provided = [field for field in non_meta_fields if params.get(field) not in (None, "")]

    if params.get("enumeration_type") and len(provided) == 1:
        raise ValueError("enumeration_type requires at least one additional search criterion.")

    if params.get("state"):
        state_supporting = {
            "number",
            "taxonomy_description",
            "first_name",
            "last_name",
            "organization_name",
            "city",
            "postal_code",
            "address_purpose",
            "name_purpose",
        }
        has_supporting = any(params.get(field) not in (None, "") for field in state_supporting)
        if not has_supporting:
            raise ValueError(
                "state requires additional search criteria (beyond enumeration_type/country_code)."
            )

    only_country = len(provided) == 1 and provided[0] == "country_code"
    if only_country and str(params.get("country_code", "")).strip().upper() == "US":
        raise ValueError("country_code=US cannot be the only search criterion.")


def _build_params(
    *,
    number: str | None = None,
    enumeration_type: str | None = None,
    taxonomy_description: str | None = None,
    name_purpose: str | None = None,
    first_name: str | None = None,
    use_first_name_alias: bool | str | None = True,
    last_name: str | None = None,
    organization_name: str | None = None,
    address_purpose: str | None = None,
    city: str | None = None,
    state: str | None = None,
    postal_code: str | None = None,
    country_code: str | None = None,
    limit: int = 10,
    skip: int = 0,
    pretty: bool = False,
) -> dict[str, Any]:
    normalized_name_purpose = None
    if name_purpose is not None:
        name_value = name_purpose.strip().upper()
        if name_value == "PROVIDER":
            normalized_name_purpose = "Provider"
        else:
            normalized_name_purpose = _normalize_enum(name_purpose, _NAME_PURPOSES, "name_purpose")

    params = _clean_params(
        {
            "version": NPPES_VERSION,
            "number": number,
            "enumeration_type": _normalize_enum(enumeration_type, _ENUMERATION_TYPES, "enumeration_type"),
            "taxonomy_description": taxonomy_description,
            "name_purpose": normalized_name_purpose,
            "first_name": first_name,
            "use_first_name_alias": _normalize_bool_flag(use_first_name_alias, "use_first_name_alias"),
            "last_name": last_name,
            "organization_name": organization_name,
            "address_purpose": _normalize_enum(address_purpose, _ADDRESS_PURPOSES, "address_purpose"),
            "city": city,
            "state": state,
            "postal_code": postal_code,
            "country_code": country_code,
            "limit": limit,
            "skip": skip,
            "pretty": "true" if pretty else None,
        }
    )

    _validate_criteria(params)
    return params


def _request_nppes(params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(NPPES_API_URL, params=params, timeout=API_TOOL_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


@tool
def npiLookup(
    number: str | None = None,
    enumeration_type: str | None = None,
    taxonomy_description: str | None = None,
    name_purpose: str | None = None,
    first_name: str | None = None,
    use_first_name_alias: bool | str | None = True,
    last_name: str | None = None,
    organization_name: str | None = None,
    address_purpose: str | None = None,
    city: str | None = None,
    state: str | None = None,
    postal_code: str | None = None,
    country_code: str | None = None,
    limit: int = 10,
    skip: int = 0,
    max_records: int | None = None,
    pretty: bool = False,
) -> dict[str, Any]:
    """
    Query NPI provider records from the public CMS NPPES Read API (v2.1).

    Args:
        number: Exact 10-digit NPI for single-provider lookup.
        enumeration_type: Provider type filter (`NPI-1` or `NPI-2`).
        taxonomy_description: Taxonomy description text.
        name_purpose: `AO` for authorized official or `Provider` for provider names.
        first_name: Individual first name.
        use_first_name_alias: Include first-name aliases (`True`/`False`).
        last_name: Individual last name.
        organization_name: Organization name criterion.
        address_purpose: `LOCATION`, `MAILING`, `PRIMARY`, or `SECONDARY`.
        city: City criterion.
        state: State criterion (requires additional criteria).
        postal_code: Postal code criterion.
        country_code: Country code criterion.
        limit: Number of rows per request (1-200).
        skip: Starting offset (0-1000).
        max_records: Optional aggregate target across pages (1-1200).
        pretty: Request pretty JSON formatting from API.

    Returns:
        Dictionary containing:
        - success: Whether query succeeded without API errors.
        - api_version: API version used.
        - query: Final request criteria.
        - requests_made: Number of API requests performed.
        - api_result_count: CMS result_count from first request.
        - result_count: Number of records returned in this response.
        - results: Provider records.
        - errors: API errors, if any.
    """
    try:
        effective_limit = 1 if number else limit
        effective_skip = 0 if number else skip

        if max_records is None:
            max_records = effective_limit

        if max_records < 1 or max_records > MAX_RECORDS:
            raise ValueError(f"max_records must be between 1 and {MAX_RECORDS}.")

        params = _build_params(
            number=number,
            enumeration_type=enumeration_type,
            taxonomy_description=taxonomy_description,
            name_purpose=name_purpose,
            first_name=first_name,
            use_first_name_alias=use_first_name_alias,
            last_name=last_name,
            organization_name=organization_name,
            address_purpose=address_purpose,
            city=city,
            state=state,
            postal_code=postal_code,
            country_code=country_code,
            limit=effective_limit,
            skip=effective_skip,
            pretty=pretty,
        )

        payload = _request_nppes(params)
        results = list(payload.get("results", []))
        errors = list(payload.get("Errors", []))
        api_result_count = payload.get("result_count", len(results))
        requests_made = 1

        if not errors and not number and max_records > len(results) and effective_limit > 0:
            current_skip = effective_skip + effective_limit
            while len(results) < max_records and current_skip <= MAX_SKIP:
                page_limit = min(effective_limit, max_records - len(results))
                page_params = dict(params)
                page_params["skip"] = current_skip
                page_params["limit"] = page_limit

                page_payload = _request_nppes(page_params)
                requests_made += 1

                page_errors = page_payload.get("Errors", [])
                if page_errors:
                    errors.extend(page_errors)
                    break

                page_results = page_payload.get("results", [])
                if not page_results:
                    break

                results.extend(page_results)

                if len(page_results) < page_limit:
                    break

                current_skip += page_limit

        return {
            "success": len(errors) == 0,
            "api_version": NPPES_VERSION,
            "query": params,
            "requests_made": requests_made,
            "api_result_count": api_result_count,
            "result_count": len(results),
            "results": results,
            "errors": errors,
        }
    except Exception as e:
        logger.error("npiLookup failed: %s", e)
        return {
            "success": False,
            "error": str(e),
            "api_version": NPPES_VERSION,
        }
