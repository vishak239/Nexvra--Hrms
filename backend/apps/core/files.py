"""Upload validation and private file responses."""

import os
import uuid

from django.conf import settings
from django.http import FileResponse
from django.utils.deconstruct import deconstructible
from rest_framework.exceptions import ValidationError

# extension -> (content type, magic-byte prefixes)
FILE_TYPES = {
    "pdf": ("application/pdf", (b"%PDF-",)),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        (b"PK\x03\x04",),
    ),
}
DOCUMENT_EXTENSIONS = ("pdf", "png", "jpg", "jpeg", "docx")
IMAGE_EXTENSIONS = ("png", "jpg", "jpeg")


def max_upload_bytes():
    from apps.organization.models import CompanySettings

    mb = CompanySettings.get_solo().max_upload_size_mb or settings.DEFAULT_MAX_UPLOAD_SIZE_MB
    return mb * 1024 * 1024


def validate_upload(file, allowed_extensions):
    """Validate extension, size and magic bytes. Returns (extension, content_type)."""
    name = file.name or ""
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    if ext not in allowed_extensions:
        raise ValidationError({"file": [f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}."]})
    limit = max_upload_bytes()
    if file.size > limit:
        raise ValidationError({"file": [f"File too large. Maximum size is {limit // (1024 * 1024)} MB."]})
    if file.size == 0:
        raise ValidationError({"file": ["File is empty."]})
    content_type, signatures = FILE_TYPES[ext]
    file.seek(0)
    head = file.read(16)
    file.seek(0)
    if not any(head.startswith(sig) for sig in signatures):
        raise ValidationError({"file": ["File content does not match its extension."]})
    return ext, content_type


@deconstructible
class RandomUploadPath:
    """Stores uploads under a random name; the original name is kept only as metadata."""

    def __init__(self, folder):
        self.folder = folder

    def __call__(self, instance, filename):
        ext = os.path.splitext(filename)[1].lower()
        return f"{self.folder}/{uuid.uuid4().hex}{ext}"

    def __eq__(self, other):
        return isinstance(other, RandomUploadPath) and other.folder == self.folder


def private_file_response(field_file, filename, content_type, inline=False):
    response = FileResponse(
        field_file.open("rb"), as_attachment=not inline, filename=filename, content_type=content_type
    )
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
