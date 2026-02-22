import logging
import os
from pathlib import Path
from datetime import date
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field, HttpUrl
from supabase import create_client

from vlm_compare import VLMCompareError, compare_pills_vlm

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)

MAX_ATTEMPTS = 10
APPROVAL_SCORE_THRESHOLD = float(os.getenv("APPROVAL_SCORE_THRESHOLD", "0.65"))
TEXT_SCORE_MIN_THRESHOLD = float(os.getenv("TEXT_SCORE_MIN_THRESHOLD", "0.25"))
MAX_REFERENCE_IMAGES = int(os.getenv("MAX_REFERENCE_IMAGES", "5"))
BUCKET_NAME = os.getenv("SUPABASE_BUCKET", "medicine-images")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

logger = logging.getLogger("medicine-verification")
logging.basicConfig(level=logging.INFO)

app = FastAPI()

cors_origins_env = os.getenv("CORS_ALLOW_ORIGINS", "")
if cors_origins_env.strip():
    allow_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    allow_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class CompareRequest(BaseModel):
    reference_image_url: Optional[HttpUrl] = None
    test_image_url: HttpUrl
    patient_id: str
    medicine_id: str


class CompareResponse(BaseModel):
    similarity_score: float = Field(..., ge=0.0, le=1.0)
    text_similarity_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    final_similarity_score: float = Field(..., ge=0.0, le=1.0)
    match: bool
    attempts_used: int = Field(..., ge=0)
    attempts_remaining: int = Field(..., ge=0)
    approved: bool


def _has_supabase() -> bool:
    return supabase is not None


def _normalize_score(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    if parsed < 0.0:
        return 0.0
    if parsed > 1.0:
        return 1.0
    return parsed


def _count_attempts(patient_id: str, medicine_id: str, attempt_date: date) -> int:
    if not _has_supabase():
        return 0
    try:
        response = (
            supabase.table("medicine_verification_attempts")
            .select("id", count="exact")
            .eq("patient_id", patient_id)
            .eq("medicine_id", medicine_id)
            .eq("attempt_date", attempt_date.isoformat())
            .execute()
        )
    except APIError as exc:
        logger.error("Supabase auth/query error while counting attempts: %s", str(exc))
        return 0
    return int(response.count or 0)


def _get_caregiver_id(patient_id: str) -> Optional[str]:
    if not _has_supabase():
        return None
    try:
        response = (
            supabase.table("patients")
            .select("caregiver_id")
            .eq("id", patient_id)
            .single()
            .execute()
        )
    except APIError as exc:
        logger.error("Supabase auth/query error while resolving caregiver: %s", str(exc))
        return None
    data = response.data or {}
    caregiver_id = data.get("caregiver_id")
    return str(caregiver_id) if caregiver_id else None


def _resolve_reference_urls(patient_id: str, medicine_id: str) -> list[str]:
    if not _has_supabase():
        return []
    caregiver_id = _get_caregiver_id(patient_id)
    if not caregiver_id:
        return []

    reference_path = f"caregiver/{caregiver_id}/{patient_id}/{medicine_id}/reference"
    try:
        objects = supabase.storage.from_(BUCKET_NAME).list(reference_path) or []
    except APIError as exc:
        logger.error("Supabase storage error while listing references: %s", str(exc))
        return []
    if not objects:
        return []

    sorted_objects = sorted(
        objects,
        key=lambda item: item.get("updated_at") or item.get("created_at") or "",
        reverse=True,
    )

    urls: list[str] = []
    for obj in sorted_objects[: max(1, MAX_REFERENCE_IMAGES)]:
        object_name = obj.get("name")
        if not object_name:
            continue
        object_path = f"{reference_path}/{object_name}"
        try:
            signed = supabase.storage.from_(BUCKET_NAME).create_signed_url(object_path, 60)
        except APIError as exc:
            logger.error("Supabase storage error while creating signed URL: %s", str(exc))
            continue
        url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
        if url:
            urls.append(url)
    return urls


def _record_attempt(
    patient_id: str,
    medicine_id: str,
    reference_image_url: str,
    test_image_url: str,
    similarity_score: float,
    text_similarity_score: Optional[float],
    final_similarity_score: float,
    match: bool,
    approved: bool,
    attempt_date: date,
) -> None:
    if not _has_supabase():
        return
    try:
        supabase.table("medicine_verification_attempts").insert(
            {
                "patient_id": patient_id,
                "medicine_id": medicine_id,
                "reference_image_url": reference_image_url,
                "test_image_url": test_image_url,
                "similarity_score": similarity_score,
                "text_similarity_score": text_similarity_score,
                "final_similarity_score": final_similarity_score,
                "match": bool(match),
                "approved": bool(approved),
                "attempt_date": attempt_date.isoformat(),
            }
        ).execute()
    except APIError as exc:
        logger.error("Supabase auth/query error while recording attempt: %s", str(exc))


@app.post("/compare", response_model=CompareResponse)
async def compare_images(payload: CompareRequest) -> CompareResponse:
    attempt_date = date.today()
    attempts_used = _count_attempts(payload.patient_id, payload.medicine_id, attempt_date)
    attempts_remaining = max(0, MAX_ATTEMPTS - attempts_used)

    if attempts_remaining == 0:
        return CompareResponse(
            similarity_score=0.0,
            text_similarity_score=None,
            final_similarity_score=0.0,
            match=False,
            attempts_used=attempts_used,
            attempts_remaining=attempts_remaining,
            approved=False,
        )

    reference_urls: list[str] = []
    if payload.reference_image_url:
        reference_urls.append(str(payload.reference_image_url))
    reference_urls.extend(_resolve_reference_urls(payload.patient_id, payload.medicine_id))
    # preserve order while removing duplicates
    reference_urls = list(dict.fromkeys(reference_urls))

    if not reference_urls:
        raise HTTPException(status_code=404, detail="Reference image not found for this medicine.")

    reference_url = reference_urls[0]
    similarity_score = 0.0
    text_similarity_score: Optional[float] = None
    final_similarity_score = 0.0
    match = False
    approved = False

    try:
        best_payload: Optional[dict[str, Any]] = None
        best_reference_url = reference_url
        best_score = -1.0

        for candidate_reference_url in reference_urls:
            candidate = compare_pills_vlm(
                reference_image_url=candidate_reference_url,
                test_image_url=str(payload.test_image_url),
                medicine_id=payload.medicine_id,
            )
            candidate_score = _normalize_score(
                candidate.get("final_score", candidate.get("final_similarity_score", 0.0))
            )
            if candidate_score > best_score:
                best_score = candidate_score
                best_payload = candidate
                best_reference_url = candidate_reference_url

        if best_payload is None:
            raise VLMCompareError("No comparison result generated.")

        reference_url = best_reference_url
        similarity_score = _normalize_score(
            best_payload.get("image_similarity", best_payload.get("similarity_score", 0.0))
        )

        raw_text_score = best_payload.get("text_similarity")
        text_similarity_score = None if raw_text_score is None else _normalize_score(raw_text_score)

        if "final_score" in best_payload or "final_similarity_score" in best_payload:
            final_similarity_score = _normalize_score(
                best_payload.get("final_score", best_payload.get("final_similarity_score", similarity_score))
            )
        elif text_similarity_score is None:
            final_similarity_score = similarity_score
        else:
            final_similarity_score = _normalize_score((similarity_score + text_similarity_score) / 2.0)

        score_gate = final_similarity_score >= APPROVAL_SCORE_THRESHOLD
        text_gate = (
            similarity_score >= 0.9
            or text_similarity_score is None
            or text_similarity_score >= TEXT_SCORE_MIN_THRESHOLD
        )
        match = bool(score_gate and text_gate)
        approved = match

    except VLMCompareError as exc:
        logger.error("VLM comparison failed: %s", str(exc))
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected compare failure: %s", str(exc))

    try:
        _record_attempt(
            patient_id=payload.patient_id,
            medicine_id=payload.medicine_id,
            reference_image_url=reference_url,
            test_image_url=str(payload.test_image_url),
            similarity_score=similarity_score,
            text_similarity_score=text_similarity_score,
            final_similarity_score=final_similarity_score,
            match=match,
            approved=approved,
            attempt_date=attempt_date,
        )
    except Exception as exc:  # pragma: no cover
        logger.error("Failed to record verification attempt: %s", str(exc))

    attempts_used += 1
    attempts_remaining = max(0, MAX_ATTEMPTS - attempts_used)

    return CompareResponse(
        similarity_score=similarity_score,
        text_similarity_score=text_similarity_score,
        final_similarity_score=final_similarity_score,
        match=match,
        attempts_used=attempts_used,
        attempts_remaining=attempts_remaining,
        approved=approved,
    )
