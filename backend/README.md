# Medicine Image Verification Backend

FastAPI backend for caregiver-vs-patient pill image verification using a Hugging Face VLM pipeline.

## Requirements

- Python 3.10+
- Dependencies from `requirements.txt`

## Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BUCKET` (optional, default: `medicine-images`)
- `HF_API_KEY` or `HF_TOKEN`
- `HF_MODEL_URL` (optional)
- `HF_REQUEST_TIMEOUT_SECONDS` (optional, default: `60`)

## Install and Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## Endpoint

`POST /compare`

Payload:

```json
{
  "reference_image_url": "https://...",
  "test_image_url": "https://...",
  "patient_id": "...",
  "medicine_id": "..."
}
```

Response:

```json
{
  "similarity_score": 0.93,
  "text_similarity_score": 0.84,
  "final_similarity_score": 0.89,
  "match": true,
  "attempts_used": 2,
  "attempts_remaining": 8,
  "approved": true
}
```

## Notes

- Attempts are tracked per patient + medicine + day in `medicine_verification_attempts`.
- The backend resolves the latest caregiver reference image from Supabase Storage before comparison.
