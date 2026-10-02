import pytest

pytestmark = pytest.mark.django_db


def test_health_is_public_and_checks_database(anon):
    res = anon.get("/api/health/")
    assert res.status_code == 200
    assert res.data == {"service": "nexvra-hrms-api", "status": "ok", "database": "ok"}


def test_backend_root_redirects_to_the_app(anon, settings):
    settings.FRONTEND_URL = "http://localhost:3000"
    res = anon.get("/")
    assert res.status_code == 302
    assert res["Location"] == "http://localhost:3000"
