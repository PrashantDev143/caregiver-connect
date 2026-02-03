import io
import urllib.request
from typing import Tuple

import cv2
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim


DEFAULT_SSIM_THRESHOLD = 0.85


def _download_image(url: str) -> np.ndarray:
    with urllib.request.urlopen(url) as response:
        data = response.read()
    image = Image.open(io.BytesIO(data)).convert("RGB")
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def compare_images_ssim(
    reference_image_url: str,
    test_image_url: str,
    threshold: float = DEFAULT_SSIM_THRESHOLD,
) -> Tuple[float, bool]:
    reference_image = _download_image(reference_image_url)
    test_image = _download_image(test_image_url)

    reference_gray = cv2.cvtColor(reference_image, cv2.COLOR_BGR2GRAY)
    test_gray = cv2.cvtColor(test_image, cv2.COLOR_BGR2GRAY)

    if reference_gray.shape != test_gray.shape:
        test_gray = cv2.resize(test_gray, (reference_gray.shape[1], reference_gray.shape[0]))

    score = ssim(reference_gray, test_gray)
    return float(score), score >= threshold
