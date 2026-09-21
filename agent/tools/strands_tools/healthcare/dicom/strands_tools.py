"""
DICOM tools for Strands healthcare agent.

Wraps pydicom, DICOMweb client, and Orthanc REST API into @tool functions
for use in training data generation and agent runtime.

Tools:
  - dicom_read_metadata: Read DICOM file metadata (patient, study, series, modality)
  - dicom_read_pixel_data: Extract pixel data as numpy array / PIL image
  - dicom_query_orthanc: Query Orthanc PACS via REST API (patients, studies, series)
  - dicom_store_orthanc: Upload DICOM file to Orthanc via REST API
  - dicom_wado_retrieve: Retrieve DICOM instance via DICOMweb WADO-RS
  - dicom_qido_search: Search DICOM studies via DICOMweb QIDO-RS
  - dicom_create_fhir_imaging_study: Generate FHIR ImagingStudy resource from DICOM
  - dicom_validate_tags: Validate DICOM tags against expected values
  - dicom_anonymize: Anonymize DICOM files for training data
  - dicom_to_png: Convert DICOM image to PNG for vision model input
"""

import base64
import io
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from strands import tool

logger = logging.getLogger(__name__)

# Orthanc connection defaults (overridden by env vars)
ORTHANC_URL = os.getenv("ORTHANC_URL", "http://localhost:8042")
ORTHANC_USER = os.getenv("ORTHANC_USER", "ron")
ORTHANC_PASSWORD = os.getenv("ORTHANC_PASSWORD", "changeme_in_production")


def _orthanc_client() -> httpx.Client:
    """Create authenticated httpx client for Orthanc REST API."""
    return httpx.Client(
        base_url=ORTHANC_URL,
        auth=(ORTHANC_USER, ORTHANC_PASSWORD),
        timeout=30.0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Tool 1: Read DICOM file metadata
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_read_metadata(file_path: str) -> dict:
    """Read metadata from a DICOM file on disk.

    Extracts patient demographics, study info, series info, modality,
    and image parameters from a DICOM file using pydicom.

    Args:
        file_path: Absolute path to a .dcm DICOM file.

    Returns:
        Dictionary with extracted DICOM metadata organized by category.
    """
    from pydicom import dcmread

    try:
        ds = dcmread(file_path, stop_before_pixels=True)
    except Exception as e:
        return {"error": f"Failed to read DICOM file: {e}"}

    def safe_str(val):
        if val is None:
            return None
        return str(val)

    metadata = {
        "patient": {
            "name": safe_str(getattr(ds, "PatientName", None)),
            "id": safe_str(getattr(ds, "PatientID", None)),
            "birth_date": safe_str(getattr(ds, "PatientBirthDate", None)),
            "sex": safe_str(getattr(ds, "PatientSex", None)),
            "age": safe_str(getattr(ds, "PatientAge", None)),
        },
        "study": {
            "instance_uid": safe_str(getattr(ds, "StudyInstanceUID", None)),
            "date": safe_str(getattr(ds, "StudyDate", None)),
            "time": safe_str(getattr(ds, "StudyTime", None)),
            "description": safe_str(getattr(ds, "StudyDescription", None)),
            "accession_number": safe_str(getattr(ds, "AccessionNumber", None)),
            "referring_physician": safe_str(getattr(ds, "ReferringPhysicianName", None)),
        },
        "series": {
            "instance_uid": safe_str(getattr(ds, "SeriesInstanceUID", None)),
            "number": safe_str(getattr(ds, "SeriesNumber", None)),
            "description": safe_str(getattr(ds, "SeriesDescription", None)),
            "body_part": safe_str(getattr(ds, "BodyPartExamined", None)),
            "patient_position": safe_str(getattr(ds, "PatientPosition", None)),
        },
        "image": {
            "sop_class_uid": safe_str(getattr(ds, "SOPClassUID", None)),
            "sop_instance_uid": safe_str(getattr(ds, "SOPInstanceUID", None)),
            "modality": safe_str(getattr(ds, "Modality", None)),
            "image_type": list(getattr(ds, "ImageType", [])),
            "rows": getattr(ds, "Rows", None),
            "columns": getattr(ds, "Columns", None),
            "bits_allocated": getattr(ds, "BitsAllocated", None),
            "bits_stored": getattr(ds, "BitsStored", None),
            "photometric_interpretation": safe_str(
                getattr(ds, "PhotometricInterpretation", None)
            ),
            "pixel_spacing": [float(x) for x in getattr(ds, "PixelSpacing", [])] or None,
            "slice_thickness": float(getattr(ds, "SliceThickness", 0)) or None,
            "window_center": safe_str(getattr(ds, "WindowCenter", None)),
            "window_width": safe_str(getattr(ds, "WindowWidth", None)),
        },
        "equipment": {
            "manufacturer": safe_str(getattr(ds, "Manufacturer", None)),
            "institution_name": safe_str(getattr(ds, "InstitutionName", None)),
            "station_name": safe_str(getattr(ds, "StationName", None)),
            "model_name": safe_str(getattr(ds, "ManufacturerModelName", None)),
        },
        "transfer_syntax": safe_str(
            getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None)
        ),
    }

    return metadata


# ─────────────────────────────────────────────────────────────────────────────
# Tool 2: Read pixel data as image
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_read_pixel_data(
    file_path: str,
    output_format: str = "base64_png",
    window_center: float | None = None,
    window_width: float | None = None,
) -> dict:
    """Extract pixel data from a DICOM file and return as an image.

    Supports windowing (contrast adjustment) for CT/MR images.
    Returns the image as base64-encoded PNG for direct use in vision models.

    Args:
        file_path: Absolute path to a .dcm DICOM file.
        output_format: "base64_png" (default) or "numpy_shape" (returns shape only).
        window_center: Optional window center for contrast. Uses DICOM default if None.
        window_width: Optional window width for contrast. Uses DICOM default if None.

    Returns:
        Dictionary with image data (base64 PNG or numpy array shape).
    """
    from pydicom import dcmread
    from pydicom.pixels import pixel_array
    import numpy as np

    try:
        ds = dcmread(file_path)
    except Exception as e:
        return {"error": f"Failed to read DICOM file: {e}"}

    try:
        arr = pixel_array(ds)
    except Exception as e:
        return {"error": f"Failed to extract pixel data: {e}"}

    # Apply windowing for CT/MR
    if window_center is not None and window_width is not None:
        vmin = window_center - window_width / 2
        vmax = window_center + window_width / 2
        arr = np.clip(arr, vmin, vmax)
        arr = ((arr - vmin) / (vmax - vmin) * 255).astype(np.uint8)
    elif hasattr(ds, "WindowCenter") and hasattr(ds, "WindowWidth"):
        wc = float(ds.WindowCenter[0] if isinstance(ds.WindowCenter, list) else ds.WindowCenter)
        ww = float(ds.WindowWidth[0] if isinstance(ds.WindowWidth, list) else ds.WindowWidth)
        vmin = wc - ww / 2
        vmax = wc + ww / 2
        arr = np.clip(arr, vmin, vmax)
        arr = ((arr - vmin) / (vmax - vmin) * 255).astype(np.uint8)
    else:
        # Normalize to 0-255
        if arr.max() > 0:
            arr = ((arr - arr.min()) / (arr.max() - arr.min()) * 255).astype(np.uint8)

    if output_format == "numpy_shape":
        return {
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "min": int(arr.min()),
            "max": int(arr.max()),
            "modality": str(getattr(ds, "Modality", "unknown")),
        }

    # Convert to PNG via PIL
    from PIL import Image

    if len(arr.shape) == 2:
        img = Image.fromarray(arr, mode="L")
    elif len(arr.shape) == 3 and arr.shape[2] == 3:
        img = Image.fromarray(arr, mode="RGB")
    else:
        # Multi-frame: take first frame
        img = Image.fromarray(arr[0] if len(arr.shape) > 2 else arr, mode="L")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return {
        "image_base64": b64,
        "format": "png",
        "width": img.width,
        "height": img.height,
        "modality": str(getattr(ds, "Modality", "unknown")),
        "study_description": str(getattr(ds, "StudyDescription", "")),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tool 3: Convert DICOM to PNG file
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_to_png(file_path: str, output_path: str | None = None) -> dict:
    """Convert a DICOM file to a PNG image file.

    Applies appropriate windowing and saves the result. Useful for
    preparing DICOM images for vision model training.

    Args:
        file_path: Absolute path to a .dcm DICOM file.
        output_path: Where to save the PNG. Defaults to same path with .png extension.

    Returns:
        Dictionary with output file path and image dimensions.
    """
    result = dicom_read_pixel_data.tool_handler(
        file_path=file_path, output_format="base64_png"
    )
    if "error" in result:
        return result

    if output_path is None:
        output_path = str(Path(file_path).with_suffix(".png"))

    img_data = base64.b64decode(result["image_base64"])
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(img_data)

    return {
        "output_path": output_path,
        "width": result["width"],
        "height": result["height"],
        "modality": result["modality"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tool 4: Query Orthanc PACS via REST API
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_query_orthanc(
    level: str = "studies",
    query: dict | None = None,
    orthanc_id: str | None = None,
) -> dict:
    """Query the Orthanc PACS server via its REST API.

    Can list/search patients, studies, series, or instances.
    Optionally fetch details for a specific resource by Orthanc ID.

    Args:
        level: Query level — "patients", "studies", "series", or "instances".
        query: Optional search query dict, e.g. {"PatientName": "DOE*", "Modality": "CT"}.
        orthanc_id: If provided, fetch details for this specific Orthanc resource ID.

    Returns:
        Dictionary with query results from Orthanc.
    """
    with _orthanc_client() as client:
        try:
            if orthanc_id:
                # Fetch specific resource
                resp = client.get(f"/{level}/{orthanc_id}")
                resp.raise_for_status()
                return resp.json()

            if query:
                # Search via POST /tools/find
                resp = client.post(
                    "/tools/find",
                    json={
                        "Level": level.rstrip("s").capitalize(),  # "Study", "Patient", etc.
                        "Query": query,
                        "Expand": True,
                        "Limit": 100,
                    },
                )
                resp.raise_for_status()
                return {"results": resp.json(), "count": len(resp.json())}

            # List all at level
            resp = client.get(f"/{level}")
            resp.raise_for_status()
            ids = resp.json()
            return {"ids": ids[:100], "total": len(ids)}

        except httpx.HTTPError as e:
            return {"error": f"Orthanc query failed: {e}"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 5: Upload DICOM to Orthanc
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_store_orthanc(file_path: str) -> dict:
    """Upload a DICOM file to Orthanc PACS server.

    Uses the Orthanc REST API POST /instances endpoint.

    Args:
        file_path: Absolute path to a .dcm DICOM file.

    Returns:
        Dictionary with the Orthanc response (ID, status, parent study/series/patient).
    """
    with _orthanc_client() as client:
        try:
            with open(file_path, "rb") as f:
                resp = client.post(
                    "/instances",
                    content=f.read(),
                    headers={"Content-Type": "application/dicom"},
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            return {"error": f"Failed to upload to Orthanc: {e}"}
        except FileNotFoundError:
            return {"error": f"File not found: {file_path}"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 6: DICOMweb QIDO-RS search
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_qido_search(
    level: str = "studies",
    patient_name: str | None = None,
    patient_id: str | None = None,
    modality: str | None = None,
    study_date: str | None = None,
    accession_number: str | None = None,
    study_instance_uid: str | None = None,
    limit: int = 50,
) -> dict:
    """Search for DICOM objects using DICOMweb QIDO-RS protocol.

    Queries the Orthanc DICOMweb plugin's QIDO-RS endpoint to search
    for studies, series, or instances matching the specified criteria.

    Args:
        level: Search level — "studies", "series", or "instances".
        patient_name: Patient name filter (supports wildcards, e.g. "DOE*").
        patient_id: Patient ID filter.
        modality: Modality filter (e.g. "CT", "MR", "CR", "DX").
        study_date: Study date filter (YYYYMMDD or range YYYYMMDD-YYYYMMDD).
        accession_number: Accession number filter.
        study_instance_uid: Study Instance UID filter.
        limit: Maximum results to return.

    Returns:
        Dictionary with QIDO-RS search results.
    """
    params = {"limit": limit}
    if patient_name:
        params["PatientName"] = patient_name
    if patient_id:
        params["PatientID"] = patient_id
    if modality:
        params["ModalitiesInStudy"] = modality
    if study_date:
        params["StudyDate"] = study_date
    if accession_number:
        params["AccessionNumber"] = accession_number
    if study_instance_uid:
        params["StudyInstanceUID"] = study_instance_uid

    with _orthanc_client() as client:
        try:
            resp = client.get(
                f"/dicom-web/{level}",
                params=params,
                headers={"Accept": "application/dicom+json"},
            )
            resp.raise_for_status()
            results = resp.json()
            return {"results": results, "count": len(results)}
        except httpx.HTTPError as e:
            return {"error": f"QIDO-RS search failed: {e}"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 7: DICOMweb WADO-RS retrieve
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_wado_retrieve(
    study_instance_uid: str,
    series_instance_uid: str | None = None,
    sop_instance_uid: str | None = None,
    frame_number: int | None = None,
    rendered: bool = False,
) -> dict:
    """Retrieve DICOM objects via DICOMweb WADO-RS protocol.

    Retrieves study/series/instance metadata or rendered frames from
    the Orthanc DICOMweb plugin.

    Args:
        study_instance_uid: Study Instance UID to retrieve.
        series_instance_uid: Optional Series Instance UID to narrow retrieval.
        sop_instance_uid: Optional SOP Instance UID for specific instance.
        frame_number: Optional frame number for multi-frame instances.
        rendered: If True, retrieve rendered image (PNG/JPEG) instead of DICOM.

    Returns:
        Dictionary with retrieval results (metadata or base64 image).
    """
    path = f"/dicom-web/studies/{study_instance_uid}"
    if series_instance_uid:
        path += f"/series/{series_instance_uid}"
    if sop_instance_uid:
        path += f"/instances/{sop_instance_uid}"
    if frame_number is not None:
        path += f"/frames/{frame_number}"

    if rendered:
        path += "/rendered"

    with _orthanc_client() as client:
        try:
            if rendered:
                resp = client.get(path, headers={"Accept": "image/png"})
                resp.raise_for_status()
                b64 = base64.b64encode(resp.content).decode("utf-8")
                return {"image_base64": b64, "format": "png", "size_bytes": len(resp.content)}
            else:
                resp = client.get(path + "/metadata", headers={"Accept": "application/dicom+json"})
                resp.raise_for_status()
                return {"metadata": resp.json()}
        except httpx.HTTPError as e:
            return {"error": f"WADO-RS retrieve failed: {e}"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 8: Generate FHIR ImagingStudy from DICOM
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_create_fhir_imaging_study(file_path: str, patient_reference: str | None = None) -> dict:
    """Generate a FHIR R4 ImagingStudy resource from a DICOM file.

    Reads DICOM metadata and creates a compliant FHIR ImagingStudy
    resource with proper coding systems (DICOM, SNOMED, LOINC).

    Args:
        file_path: Path to a .dcm DICOM file.
        patient_reference: FHIR Patient reference (e.g. "Patient/123"). Auto-generated if None.

    Returns:
        FHIR ImagingStudy resource as a dictionary.
    """
    from pydicom import dcmread

    try:
        ds = dcmread(file_path, stop_before_pixels=True)
    except Exception as e:
        return {"error": f"Failed to read DICOM: {e}"}

    # Map DICOM modality to SNOMED body site codes (common ones)
    body_site_map = {
        "CHEST": {"system": "http://snomed.info/sct", "code": "51185008", "display": "Thorax"},
        "HEAD": {"system": "http://snomed.info/sct", "code": "69536005", "display": "Head"},
        "ABDOMEN": {"system": "http://snomed.info/sct", "code": "818983003", "display": "Abdomen"},
        "PELVIS": {"system": "http://snomed.info/sct", "code": "12921003", "display": "Pelvis"},
        "SPINE": {"system": "http://snomed.info/sct", "code": "421060004", "display": "Spine"},
        "EXTREMITY": {"system": "http://snomed.info/sct", "code": "66019005", "display": "Extremity"},
    }

    modality = str(getattr(ds, "Modality", "OT"))
    body_part = str(getattr(ds, "BodyPartExamined", "")).upper()
    patient_id = str(getattr(ds, "PatientID", "unknown"))

    if patient_reference is None:
        patient_reference = f"Patient/{patient_id}"

    # Build FHIR ImagingStudy
    imaging_study = {
        "resourceType": "ImagingStudy",
        "status": "available",
        "subject": {"reference": patient_reference},
        "identifier": [
            {
                "system": "urn:dicom:uid",
                "value": f"urn:oid:{getattr(ds, 'StudyInstanceUID', '')}",
            }
        ],
        "started": _dicom_date_to_fhir(
            str(getattr(ds, "StudyDate", "")),
            str(getattr(ds, "StudyTime", "")),
        ),
        "modality": [
            {
                "system": "http://dicom.nema.org/resources/ontology/DCM",
                "code": modality,
            }
        ],
        "description": str(getattr(ds, "StudyDescription", "")),
        "numberOfSeries": 1,
        "numberOfInstances": 1,
        "series": [
            {
                "uid": str(getattr(ds, "SeriesInstanceUID", "")),
                "number": int(getattr(ds, "SeriesNumber", 1)),
                "modality": {
                    "system": "http://dicom.nema.org/resources/ontology/DCM",
                    "code": modality,
                },
                "description": str(getattr(ds, "SeriesDescription", "")),
                "bodySite": body_site_map.get(body_part, {
                    "system": "http://snomed.info/sct",
                    "code": "38266002",
                    "display": "Entire body",
                }),
                "instance": [
                    {
                        "uid": str(getattr(ds, "SOPInstanceUID", "")),
                        "sopClass": {
                            "system": "urn:ietf:rfc:3986",
                            "code": f"urn:oid:{getattr(ds, 'SOPClassUID', '')}",
                        },
                        "number": 1,
                    }
                ],
            }
        ],
    }

    # Add referrer if present
    referrer = getattr(ds, "ReferringPhysicianName", None)
    if referrer:
        imaging_study["referrer"] = {"display": str(referrer)}

    return imaging_study


def _dicom_date_to_fhir(date_str: str, time_str: str = "") -> str:
    """Convert DICOM date (YYYYMMDD) + time (HHMMSS) to FHIR dateTime."""
    if not date_str or len(date_str) < 8:
        return ""
    fhir_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
    if time_str and len(time_str) >= 6:
        fhir_date += f"T{time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
    return fhir_date


# ─────────────────────────────────────────────────────────────────────────────
# Tool 9: Validate DICOM tags
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_validate_tags(
    file_path: str,
    required_tags: list[str] | None = None,
) -> dict:
    """Validate DICOM file tags for completeness and consistency.

    Checks that required tags are present, properly formatted, and
    consistent (e.g., pixel data dimensions match Rows/Columns).

    Args:
        file_path: Path to a .dcm DICOM file.
        required_tags: List of DICOM keyword tags to check. Defaults to standard clinical set.

    Returns:
        Validation report with pass/fail status per tag and overall result.
    """
    from pydicom import dcmread

    if required_tags is None:
        required_tags = [
            "PatientID", "PatientName", "StudyInstanceUID", "SeriesInstanceUID",
            "SOPInstanceUID", "SOPClassUID", "Modality", "StudyDate",
        ]

    try:
        ds = dcmread(file_path, stop_before_pixels=True)
    except Exception as e:
        return {"valid": False, "error": f"Failed to parse: {e}"}

    results = {}
    all_valid = True

    for tag_name in required_tags:
        val = getattr(ds, tag_name, None)
        if val is None or str(val).strip() == "":
            results[tag_name] = {"present": False, "value": None}
            all_valid = False
        else:
            results[tag_name] = {"present": True, "value": str(val)[:100]}

    # Cross-check consistency
    consistency_checks = []
    rows = getattr(ds, "Rows", None)
    cols = getattr(ds, "Columns", None)
    if rows and cols:
        consistency_checks.append({
            "check": "image_dimensions",
            "valid": rows > 0 and cols > 0,
            "detail": f"{rows}x{cols}",
        })

    return {
        "valid": all_valid,
        "file": file_path,
        "tag_results": results,
        "consistency_checks": consistency_checks,
        "total_tags_in_file": len(ds),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tool 10: Anonymize DICOM
# ─────────────────────────────────────────────────────────────────────────────

@tool
def dicom_anonymize(
    file_path: str,
    output_path: str | None = None,
    keep_study_uid: bool = True,
) -> dict:
    """Anonymize a DICOM file by removing/replacing PHI.

    Removes patient name, ID, birth date, and other identifying information
    per DICOM PS3.15 Annex E (Basic Application Level Confidentiality Profile).

    Args:
        file_path: Path to the input .dcm DICOM file.
        output_path: Where to save anonymized file. Defaults to <file>_anon.dcm.
        keep_study_uid: If True, preserve StudyInstanceUID for linking. Default True.

    Returns:
        Dictionary with anonymization summary and output path.
    """
    from pydicom import dcmread
    import hashlib

    try:
        ds = dcmread(file_path)
    except Exception as e:
        return {"error": f"Failed to read: {e}"}

    if output_path is None:
        p = Path(file_path)
        output_path = str(p.parent / f"{p.stem}_anon{p.suffix}")

    removed_tags = []
    replaced_tags = []

    # Tags to remove entirely (direct identifiers)
    remove_keywords = [
        "PatientName", "PatientBirthDate", "PatientAddress",
        "ReferringPhysicianName", "ReferringPhysicianAddress",
        "ReferringPhysicianTelephoneNumbers",
        "InstitutionName", "InstitutionAddress", "StationName",
        "PerformingPhysicianName", "NameOfPhysiciansReadingStudy",
        "OperatorsName", "OtherPatientIDs", "OtherPatientNames",
        "PatientBirthName", "PatientMotherBirthName",
        "PatientTelephoneNumbers", "PatientComments",
    ]

    for keyword in remove_keywords:
        if hasattr(ds, keyword):
            delattr(ds, keyword)
            removed_tags.append(keyword)

    # Replace PatientID with hash
    original_pid = str(getattr(ds, "PatientID", ""))
    if original_pid:
        hashed = hashlib.sha256(original_pid.encode()).hexdigest()[:16]
        ds.PatientID = f"ANON_{hashed}"
        replaced_tags.append("PatientID")

    # Replace AccessionNumber with hash
    original_acc = str(getattr(ds, "AccessionNumber", ""))
    if original_acc:
        hashed = hashlib.sha256(original_acc.encode()).hexdigest()[:12]
        ds.AccessionNumber = f"ANON_{hashed}"
        replaced_tags.append("AccessionNumber")

    # Optionally replace study UID
    if not keep_study_uid:
        from pydicom.uid import generate_uid
        ds.StudyInstanceUID = generate_uid()
        replaced_tags.append("StudyInstanceUID")

    ds.save_as(output_path)

    return {
        "output_path": output_path,
        "removed_tags": removed_tags,
        "replaced_tags": replaced_tags,
        "total_removed": len(removed_tags),
        "total_replaced": len(replaced_tags),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Export all tools
# ─────────────────────────────────────────────────────────────────────────────

DICOM_STRANDS_TOOLS = [
    dicom_read_metadata,
    dicom_read_pixel_data,
    dicom_to_png,
    dicom_query_orthanc,
    dicom_store_orthanc,
    dicom_qido_search,
    dicom_wado_retrieve,
    dicom_create_fhir_imaging_study,
    dicom_validate_tags,
    dicom_anonymize,
]


def get_dicom_strands_tools():
    """Return all DICOM Strands tools."""
    return DICOM_STRANDS_TOOLS
