"""Single JSON error envelope: {"error": {"code", "message", "fields"}}."""

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state of the resource."
    default_code = "conflict"


_CODES = {
    400: "validation_error",
    401: "not_authenticated",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    415: "unsupported_media_type",
    429: "throttled",
}


def _first_message(data):
    if isinstance(data, list) and data:
        return _first_message(data[0])
    if isinstance(data, dict) and data:
        return _first_message(next(iter(data.values())))
    return str(data)


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "error_dict") else {"non_field_errors": exc.messages}
        )
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = drf_exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"error": {"code": "server_error", "message": "An unexpected error occurred.", "fields": {}}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    if isinstance(exc, exceptions.ValidationError):
        code = "validation_error"
    elif isinstance(exc, exceptions.APIException):
        code = exc.default_code
    else:
        code = _CODES.get(response.status_code, "error")
    fields = {}
    if isinstance(exc, exceptions.ValidationError):
        if isinstance(data, dict):
            fields = {k: v for k, v in data.items() if k not in ("non_field_errors", "detail")}
            message = _first_message(data.get("non_field_errors") or data.get("detail") or data)
        else:
            message = _first_message(data)
    else:
        message = data.get("detail", "") if isinstance(data, dict) else _first_message(data)
    response.data = {"error": {"code": code, "message": str(message), "fields": fields}}
    return response
