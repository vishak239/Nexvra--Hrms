"""Upload validation and private file responses."""

import os
import uuid
import zipfile

from django.conf import settings
from django.http import FileResponse
from django.utils.deconstruct import deconstructible
from rest_framework.exceptions import ValidationError

OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy Office (.doc / .xls)
ZIP = b"PK\x03\x04"  # Office Open XML (.docx / .xlsx)

# extension -> (content type, magic-byte prefixes). Text formats have no signature and are
# checked by `_looks_like_text` instead.
FILE_TYPES = {
    "pdf": ("application/pdf", (b"%PDF-",)),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        (ZIP,),
    ),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (ZIP,)),
    "doc": ("application/msword", (OLE2,)),
    "xls": ("application/vnd.ms-excel", (OLE2,)),
    "csv": ("text/csv", ()),
    "txt": ("text/plain", ()),
}
DOCUMENT_EXTENSIONS = ("pdf", "png", "jpg", "jpeg", "docx")
IMAGE_EXTENSIONS = ("png", "jpg", "jpeg")
MESSAGE_EXTENSIONS = ("pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "png", "jpg", "jpeg")

# Office Open XML packages must contain these parts (a renamed arbitrary .zip does not).
_OOXML_PARTS = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml"}


def _looks_like_text(file):
    """Text uploads must decode as UTF-8 (or Windows-1252) and contain no NUL/control bytes."""
    file.seek(0)
    sample = file.read(64 * 1024)
    file.seek(0)
    if b"\x00" in sample:
        return False
    for encoding in ("utf-8", "cp1252"):
        try:
            text = sample.decode(encoding)
        except UnicodeDecodeError:
            continue
        return not any(ord(c) < 32 and c not in "\r\n\t\f" for c in text)
    return False


def _valid_ooxml(file, ext):
    try:
        file.seek(0)
        with zipfile.ZipFile(file) as archive:
            names = set(archive.namelist())
        return "[Content_Types].xml" in names and _OOXML_PARTS[ext] in names
    except (zipfile.BadZipFile, OSError, ValueError):
        return False
    finally:
        file.seek(0)


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
    if signatures:
        valid = any(head.startswith(sig) for sig in signatures)
        if valid and ext in _OOXML_PARTS:
            valid = _valid_ooxml(file, ext)
    else:
        valid = _looks_like_text(file)
    if not valid:
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
