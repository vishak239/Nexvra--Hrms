import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditLog
from apps.documents.models import EmployeeDocument
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n%test document\n"


def pdf(name="letter.pdf", content=PDF):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def upload(client, employee, file=None, **extra):
    data = {"employee": employee.id, "category": "OFFER_LETTER", "title": "Offer letter", "file": file or pdf()}
    data.update(extra)
    return client.post("/api/documents/", data, format="multipart")


def test_hr_uploads_and_employee_downloads(org, client_for):
    res = upload(client_for(org["hr"]), org["alice"])
    assert res.status_code == 201, res.data
    doc = EmployeeDocument.objects.get(pk=res.data["id"])
    assert doc.file.name.startswith("documents/") and "letter" not in doc.file.name  # randomised
    assert Notification.objects.filter(recipient=org["alice"].user, type="DOCUMENT_SHARED").exists()

    alice = client_for(org["alice"])
    listing = alice.get("/api/documents/")
    assert [d["id"] for d in listing.data["results"]] == [doc.id]
    dl = alice.get(f"/api/documents/{doc.id}/download/")
    assert dl.status_code == 200
    assert b"".join(dl.streaming_content) == PDF
    assert "attachment" in dl["Content-Disposition"]
    assert dl["Cache-Control"] == "private, no-store"
    assert AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED", entity_id=str(doc.id)).exists()


def test_other_employees_and_managers_cannot_access(org, client_for):
    doc_id = upload(client_for(org["hr"]), org["alice"]).data["id"]
    for who in ("bob", "carol", "manager"):
        client = client_for(org[who])
        assert client.get(f"/api/documents/{doc_id}/").status_code == 404, who
        assert client.get(f"/api/documents/{doc_id}/download/").status_code == 404, who


def test_hidden_document_not_visible_to_employee(org, client_for):
    doc_id = upload(client_for(org["hr"]), org["alice"], visible_to_employee=False).data["id"]
    alice = client_for(org["alice"])
    assert alice.get("/api/documents/").data["count"] == 0
    assert alice.get(f"/api/documents/{doc_id}/download/").status_code == 404


@pytest.mark.parametrize(
    "file",
    [
        SimpleUploadedFile("evil.exe", b"MZ\x90\x00", content_type="application/octet-stream"),
        SimpleUploadedFile("fake.pdf", b"<html><script>alert(1)</script>", content_type="application/pdf"),
        SimpleUploadedFile("empty.pdf", b"", content_type="application/pdf"),
        SimpleUploadedFile("page.html", b"<html></html>", content_type="text/html"),
    ],
)
def test_invalid_files_rejected(org, client_for, file):
    res = upload(client_for(org["hr"]), org["alice"], file=file)
    assert res.status_code == 400
    assert EmployeeDocument.objects.count() == 0


def test_size_limit_from_settings(org, client_for, configure):
    configure(max_upload_size_mb=1)
    big = pdf(content=PDF + b"0" * (1024 * 1024 + 1))
    assert upload(client_for(org["hr"]), org["alice"], file=big).status_code == 400


def test_employee_upload_disabled_by_default(org, client_for, configure):
    alice = client_for(org["alice"])
    assert upload(alice, org["alice"], category="CERTIFICATE").status_code == 403
    configure(employee_document_upload_enabled=True)
    assert upload(alice, org["alice"], category="CERTIFICATE").status_code == 201
    # never for someone else
    assert upload(alice, org["bob"], category="CERTIFICATE").status_code == 403


def test_only_hr_can_delete_and_update(org, client_for):
    hr = client_for(org["hr"])
    doc_id = upload(hr, org["alice"]).data["id"]
    alice = client_for(org["alice"])
    assert alice.delete(f"/api/documents/{doc_id}/").status_code == 403
    assert alice.patch(f"/api/documents/{doc_id}/", {"title": "x"}, format="json").status_code == 403
    assert hr.patch(f"/api/documents/{doc_id}/", {"visible_to_employee": False}, format="json").status_code == 200
    assert hr.delete(f"/api/documents/{doc_id}/").status_code == 204
    assert AuditLog.objects.filter(action="DOCUMENT_DELETED").exists()
