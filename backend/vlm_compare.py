import base64
import hashlib
import io
import json
import os
import re
from typing import Any, Dict, Optional

import requests
from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

HF_MODEL_URL = os.getenv(
    "HF_MODEL_URL",
    "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-VL-7B-Instruct",
)
HF_API_KEY = os.getenv("HF_API_KEY") or os.getenv("HF_TOKEN")
REQUEST_TIMEOUT_SECONDS = int(os.getenv("HF_REQUEST_TIMEOUT_SECONDS", "60"))
MATCH_THRESHOLD = float(os.getenv("PILL_MATCH_THRESHOLD", "0.6"))
COMPOSITION_WEIGHT = float(os.getenv("COMPOSITION_WEIGHT", "0.2"))
HF_EMBEDDING_MODEL_URL = os.getenv(
    "HF_EMBEDDING_MODEL_URL",
    "https://api-inference.huggingface.co/pipeline/feature-extraction/openai/clip-vit-base-patch32",
)


class VLMCompareError(Exception):
    pass


def _clamp_score(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(0.0, min(1.0, parsed))


def _download_image_bytes(image_url: str) -> bytes:
    try:
        response = requests.get(image_url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise VLMCompareError(f"Failed to download image: {exc}") from exc
    return response.content


def _as_base64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def _average_hash_bits(image: Image.Image) -> list[int]:
    grayscale = image.convert("L").resize((8, 8))
    pixels = list(grayscale.getdata())
    mean = sum(pixels) / len(pixels)
    return [1 if value >= mean else 0 for value in pixels]


def _tokenize(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.lower()) if len(token) >= 3}


def _jaccard_similarity(left: str, right: str) -> float:
    left_tokens = _tokenize(left)
    right_tokens = _tokenize(right)
    if not left_tokens and not right_tokens:
        return 0.0
    union = left_tokens | right_tokens
    if not union:
        return 0.0
    return _clamp_score(len(left_tokens & right_tokens) / len(union))


def _safe_string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _flatten_embedding(payload: Any) -> list[float]:
    if isinstance(payload, list):
        if payload and isinstance(payload[0], list):
            return _flatten_embedding(payload[0])
        values: list[float] = []
        for item in payload:
            try:
                values.append(float(item))
            except (TypeError, ValueError):
                continue
        return values
    return []


def _cosine_similarity(left: list[float], right: list[float]) -> Optional[float]:
    if not left or not right:
        return None
    size = min(len(left), len(right))
    if size == 0:
        return None
    l = left[:size]
    r = right[:size]
    dot = sum(a * b for a, b in zip(l, r))
    left_norm = sum(a * a for a in l) ** 0.5
    right_norm = sum(b * b for b in r) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return None
    cosine = dot / (left_norm * right_norm)
    # CLIP cosine is typically in [-1, 1], normalize to [0, 1]
    return _clamp_score((cosine + 1.0) / 2.0)


def _extract_image_embedding(image_bytes: bytes, api_key: str) -> Optional[list[float]]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/octet-stream",
    }
    try:
        response = requests.post(
            HF_EMBEDDING_MODEL_URL,
            headers=headers,
            data=image_bytes,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None

    return _flatten_embedding(payload)


def _compute_embedding_similarity(reference_bytes: bytes, test_bytes: bytes, api_key: str) -> Optional[float]:
    reference_embedding = _extract_image_embedding(reference_bytes, api_key)
    test_embedding = _extract_image_embedding(test_bytes, api_key)
    return _cosine_similarity(reference_embedding or [], test_embedding or [])


def _load_composition_hints() -> Dict[str, list[str]]:
    raw = os.getenv("MEDICINE_COMPOSITION_HINTS", "")
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    result: Dict[str, list[str]] = {}
    for key, terms in parsed.items():
        if not isinstance(key, str):
            continue
        if isinstance(terms, list):
            result[key.strip().lower()] = [str(term).strip().lower() for term in terms if str(term).strip()]
    return result


def _compute_pair_similarity(reference_image: Image.Image, test_image: Image.Image) -> float:
    def _normalize_canvas(image: Image.Image, size: int = 256) -> Image.Image:
        # Preserve aspect ratio to avoid distortion-driven false negatives.
        canvas = Image.new("RGB", (size, size), (255, 255, 255))
        contained = ImageOps.contain(image, (size, size))
        offset = ((size - contained.width) // 2, (size - contained.height) // 2)
        canvas.paste(contained, offset)
        return canvas

    ref_resized = _normalize_canvas(reference_image, 256)
    test_resized = _normalize_canvas(test_image, 256)
    diff_image = ImageChops.difference(ref_resized, test_resized)
    channel_means = ImageStat.Stat(diff_image).mean
    mean_diff = sum(channel_means) / len(channel_means)
    pixel_similarity = _clamp_score(1.0 - (mean_diff / 255.0))

    ref_gray = reference_image.resize((256, 256)).convert("L")
    test_gray = test_image.resize((256, 256)).convert("L")
    ref_hist = ref_gray.histogram()
    test_hist = test_gray.histogram()
    hist_overlap = sum(min(left, right) for left, right in zip(ref_hist, test_hist))
    hist_total = max(1, sum(ref_hist))
    histogram_similarity = _clamp_score(hist_overlap / hist_total)

    ref_edges = ref_gray.filter(ImageFilter.FIND_EDGES)
    test_edges = test_gray.filter(ImageFilter.FIND_EDGES)
    edge_diff = ImageChops.difference(ref_edges, test_edges)
    edge_mean = ImageStat.Stat(edge_diff).mean[0]
    edge_similarity = _clamp_score(1.0 - (edge_mean / 255.0))

    ref_hash = _average_hash_bits(reference_image)
    test_hash = _average_hash_bits(test_image)
    hamming = sum(1 for left, right in zip(ref_hash, test_hash) if left != right)
    hash_similarity = _clamp_score(1.0 - (hamming / 64.0))

    blended = (
        (0.35 * pixel_similarity)
        + (0.25 * histogram_similarity)
        + (0.20 * edge_similarity)
        + (0.20 * hash_similarity)
    )
    if blended >= 0.85:
        blended = min(1.0, blended + 0.08)
    return _clamp_score(blended)


def _compute_visual_similarity(reference_bytes: bytes, test_bytes: bytes) -> float:
    if hashlib.sha256(reference_bytes).hexdigest() == hashlib.sha256(test_bytes).hexdigest():
        return 1.0

    try:
        ref = ImageOps.exif_transpose(Image.open(io.BytesIO(reference_bytes))).convert("RGB")
        test = ImageOps.exif_transpose(Image.open(io.BytesIO(test_bytes))).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise VLMCompareError(f"Invalid image data: {exc}") from exc

    def _multi_crops(image: Image.Image) -> list[Image.Image]:
        w, h = image.size
        crops = [image]
        for ratio in (0.90, 0.75):
            cw = max(1, int(w * ratio))
            ch = max(1, int(h * ratio))
            left = max(0, (w - cw) // 2)
            top = max(0, (h - ch) // 2)
            crops.append(image.crop((left, top, left + cw, top + ch)))
        return crops

    ref_variants = _multi_crops(ref)
    test_base_variants = _multi_crops(test)
    test_variants: list[Image.Image] = []
    for base in test_base_variants:
        for angle in (0, 90, 180, 270):
            test_variants.append(base.rotate(angle, expand=True))

    variant_scores = [
        _compute_pair_similarity(ref_variant, test_variant)
        for ref_variant in ref_variants
        for test_variant in test_variants
    ]
    return _clamp_score(max(variant_scores))


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        raise VLMCompareError("Model returned empty text.")

    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if not match:
        raise VLMCompareError("Model response did not contain JSON.")

    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise VLMCompareError(f"Invalid JSON from model: {exc}") from exc


def _parse_response_payload(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        if "error" in payload:
            raise VLMCompareError(str(payload["error"]))
        if any(key in payload for key in ["image_similarity", "text_similarity", "final_score", "match"]):
            return payload
        generated = payload.get("generated_text")
        if isinstance(generated, str):
            return _extract_json_object(generated)

    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            if "generated_text" in first and isinstance(first["generated_text"], str):
                return _extract_json_object(first["generated_text"])
            if any(key in first for key in ["image_similarity", "text_similarity", "final_score", "match"]):
                return first

    raise VLMCompareError("Unexpected model response format.")


def compare_pills_vlm(
    reference_image_url: str,
    test_image_url: str,
    medicine_id: Optional[str] = None,
) -> Dict[str, Any]:
    reference_bytes = _download_image_bytes(reference_image_url)
    test_bytes = _download_image_bytes(test_image_url)
    visual_similarity = _compute_visual_similarity(reference_bytes, test_bytes)

    api_key = HF_API_KEY
    if not api_key:
        return {
            "image_similarity": visual_similarity,
            "text_similarity": None,
            "final_score": visual_similarity,
            "match": visual_similarity >= MATCH_THRESHOLD,
            "reason": "Fallback similarity used (HF API key missing).",
        }

    embedding_similarity = _compute_embedding_similarity(reference_bytes, test_bytes, api_key)
    if embedding_similarity is not None:
        visual_similarity = _clamp_score(max(visual_similarity, embedding_similarity))

    prompt = (
        "You are a medical pill verification system. Compare the two pill images and return only valid JSON with "
        "keys: image_similarity (0..1), text_similarity (0..1 or null), final_score (0..1), match (boolean), "
        "detected_text_reference (string), detected_text_test (string), active_ingredient (string or null), "
        "strength (string or null), reason (short string). "
        f"Expected medicine identifier: {medicine_id or 'unknown'}."
    )

    payload = {
        "inputs": {
            "images": [
                {"image": _as_base64(reference_bytes)},
                {"image": _as_base64(test_bytes)},
            ],
            "text": prompt,
        }
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            HF_MODEL_URL,
            headers=headers,
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return {
            "image_similarity": visual_similarity,
            "text_similarity": None,
            "final_score": visual_similarity,
            "match": visual_similarity >= MATCH_THRESHOLD,
            "reason": f"Fallback similarity used (VLM request failed: {exc}).",
        }

    try:
        raw_payload = response.json()
    except ValueError as exc:
        return {
            "image_similarity": visual_similarity,
            "text_similarity": None,
            "final_score": visual_similarity,
            "match": visual_similarity >= MATCH_THRESHOLD,
            "reason": "Fallback similarity used (model response was not JSON).",
        }

    try:
        parsed = _parse_response_payload(raw_payload)
    except VLMCompareError:
        return {
            "image_similarity": visual_similarity,
            "text_similarity": None,
            "final_score": visual_similarity,
            "match": visual_similarity >= MATCH_THRESHOLD,
            "reason": "Fallback similarity used (unexpected model payload).",
        }

    image_similarity = _clamp_score(
        parsed.get("image_similarity", parsed.get("similarity_score", visual_similarity)),
        fallback=visual_similarity,
    )

    raw_text_similarity = parsed.get("text_similarity")
    detected_text_reference = _safe_string(parsed.get("detected_text_reference"))
    detected_text_test = _safe_string(parsed.get("detected_text_test"))
    extracted_text_similarity = _jaccard_similarity(detected_text_reference, detected_text_test)

    if raw_text_similarity is None:
        text_similarity = extracted_text_similarity if extracted_text_similarity > 0 else None
    else:
        text_similarity = _clamp_score(raw_text_similarity)
        if extracted_text_similarity > 0:
            text_similarity = _clamp_score(max(text_similarity, extracted_text_similarity))

    if "final_score" in parsed or "final_similarity_score" in parsed:
        vlm_final = _clamp_score(
            parsed.get("final_score", parsed.get("final_similarity_score", image_similarity)),
            fallback=image_similarity,
        )
    elif text_similarity is None:
        vlm_final = image_similarity
    else:
        vlm_final = _clamp_score((image_similarity + text_similarity) / 2.0, fallback=image_similarity)

    composition_hints = _load_composition_hints()
    expected_terms = set(_tokenize(medicine_id or ""))
    expected_terms.update(_tokenize(_safe_string(parsed.get("active_ingredient"))))
    expected_terms.update(_tokenize(_safe_string(parsed.get("strength"))))
    expected_terms.update(
        _tokenize(" ".join(composition_hints.get((medicine_id or "").strip().lower(), [])))
    )

    detected_union = f"{detected_text_reference} {detected_text_test} {_safe_string(parsed.get('active_ingredient'))} {_safe_string(parsed.get('strength'))}"
    detected_tokens = _tokenize(detected_union)
    if expected_terms:
        composition_similarity = _clamp_score(len(expected_terms & detected_tokens) / len(expected_terms))
    else:
        composition_similarity = 0.0

    # Preserve strong visual agreement, then lift by composition consistency when available.
    base_score = _clamp_score(max(vlm_final, visual_similarity))
    final_score = _clamp_score(base_score + (COMPOSITION_WEIGHT * composition_similarity))
    match = final_score >= MATCH_THRESHOLD

    return {
        "image_similarity": _clamp_score(max(image_similarity, visual_similarity)),
        "text_similarity": text_similarity,
        "final_score": final_score,
        "match": match,
        "reason": parsed.get("reason", "VLM + visual similarity + composition consistency."),
    }
