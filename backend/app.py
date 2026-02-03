import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl
from supabase import create_client

from compare import compare_images_ssim

MAX_ATTEMPTS = 10
BUCKET_NAME = os.getenv("SUPABASE_BUCKET", "medicine-images")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

app = FastAPI()

supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class CompareRequest(BaseModel):
    reference_image_url: HttpUrl
    test_image_url: HttpUrl
    patient_id: str
    medicine_id: str


class CompareResponse(BaseModel):
    similarity_score: float
    match: bool
    attempts_used: int
    attempts_left: int
    approved: bool


def _count_attempts(patient_id: str, medicine_id: str) -> int:
    if not supabase:
        return 0
    attempts_path = f"patient/{patient_id}/{medicine_id}/attempts"
    response = supabase.storage.from_(BUCKET_NAME).list(attempts_path)
    return len(response or [])


@app.post("/compare", response_model=CompareResponse)
async def compare_images(payload: CompareRequest) -> CompareResponse:
    attempts_used = _count_attempts(payload.patient_id, payload.medicine_id)
    attempts_left = max(0, MAX_ATTEMPTS - attempts_used)

    if attempts_left == 0:
        return CompareResponse(
            similarity_score=0.0,
            match=False,
            attempts_used=attempts_used,
            attempts_left=attempts_left,
            approved=False,
        )

    try:
        similarity_score, match = compare_images_ssim(
            reference_image_url=str(payload.reference_image_url),
            test_image_url=str(payload.test_image_url),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Comparison failed: {exc}")

    approved = bool(match)

    return CompareResponse(
        similarity_score=similarity_score,
        match=bool(match),
        attempts_used=attempts_used,
        attempts_left=attempts_left,
        approved=approved,
    )
