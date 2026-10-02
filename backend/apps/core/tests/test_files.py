import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import ValidationError

from apps.core.files import DOCUMENT_EXTENSIONS, MESSAGE_EXTENSIONS, validate_upload

pytestmark = pytest.mark.django_db


def docx_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w/>")
    return buf.getvalue()


def test_text_formats_validated_by_content():
    assert validate_upload(SimpleUploadedFile("a.csv", "naïve,1\n".encode()), MESSAGE_EXTENSIONS)[1] == "text/csv"
    with pytest.raises(ValidationError):
        validate_upload(SimpleUploadedFile("a.txt", b"\x00\x01binary"), MESSAGE_EXTENSIONS)


def test_office_open_xml_requires_real_package():
    assert validate_upload(SimpleUploadedFile("a.docx", docx_bytes()), DOCUMENT_EXTENSIONS)[0] == "docx"
    with pytest.raises(ValidationError):
        validate_upload(SimpleUploadedFile("a.docx", b"PK\x03\x04garbage"), DOCUMENT_EXTENSIONS)


def test_document_module_still_rejects_message_only_types():
    with pytest.raises(ValidationError):
        validate_upload(SimpleUploadedFile("a.csv", b"a,b\n"), DOCUMENT_EXTENSIONS)
