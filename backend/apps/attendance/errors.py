"""Attendance errors with stable machine-readable codes (rendered as {"error": {"code": ...}})."""

from rest_framework import exceptions, status

from apps.core.exceptions import Conflict


class LocationRequired(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "location_required"
    default_detail = "Allow location access to check in at the workplace."


class LocationTooImprecise(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "location_too_imprecise"
    default_detail = "Your location is not precise enough to check in. Try again near a window or with GPS on."


class OutsideGeofence(exceptions.APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "outside_geofence"
    default_detail = "You are outside the workplace check-in area."


class WfhNotApproved(exceptions.APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "wfh_not_approved"
    default_detail = "You don't have an approved work-from-home request for today."


class BreakAllowanceUsed(Conflict):
    default_code = "break_allowance_used"
    default_detail = "Your break allowance for today is used up."
