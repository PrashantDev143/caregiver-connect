# Medicine Image Verification Backend

This FastAPI service exposes a `/compare` endpoint that compares a caregiver reference image with a patient attempt image using SSIM.

## Requirements

- Python 3.10+
- Dependencies from `requirements.txt`

## Environment variables

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key for Storage listing
- `SUPABASE_BUCKET` — optional (defaults to `medicine-images`)

## Install + run

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
  "match": true,
  "attempts_used": 2,
  "attempts_left": 8,
  "approved": true
}
```
