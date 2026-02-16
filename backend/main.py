from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

from compare import compare_images_ssim

# --------------------
# App setup
# --------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------
# Models
# --------------------
class CompareRequest(BaseModel):
    reference_image_url: HttpUrl
    test_image_url: HttpUrl
    patient_id: str
    medicine_id: str


class CompareResponse(BaseModel):
    similarity_score: float
    approved: bool
    attempts_used: int
    attempts_remaining: int


# --------------------
# Config
# --------------------
MAX_ATTEMPTS = 10


# --------------------
# API
# --------------------
@app.post("/compare", response_model=CompareResponse)
def compare_medicine(data: CompareRequest):
    """
    Compare reference medicine image with patient's image
    using SSIM (structural similarity).
    """

    try:
        similarity_score, match = compare_images_ssim(
            reference_image_url=str(data.reference_image_url),
            test_image_url=str(data.test_image_url),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    print("SSIM SCORE:", similarity_score)

    approved = bool(match)

    # TEMP: static attempts (you can wire Supabase later)
    attempts_used = 1
    attempts_remaining = MAX_ATTEMPTS - attempts_used

    return CompareResponse(
        similarity_score=round(similarity_score, 3),
        approved=approved,
        attempts_used=attempts_used,
        attempts_remaining=attempts_remaining,
    )
