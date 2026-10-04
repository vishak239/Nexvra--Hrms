"""Geofence maths. The server always computes distances itself from raw coordinates; any
"inside" flag or distance sent by a browser is ignored."""

import math

EARTH_RADIUS_M = 6_371_008.8  # mean Earth radius (IUGG)


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres between two WGS-84 points."""
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = phi2 - phi1
    dlmb = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def within_radius(distance_m, radius_m):
    """Check-in rule: the boundary itself counts as inside (distance <= radius)."""
    return distance_m <= radius_m


def has_clearly_left(distance_m, accuracy_m, radius_m):
    """Geofence exit rule for automatic check-out: only when even the most favourable reading
    (distance minus the reported accuracy) is outside the radius, so GPS jitter near the
    boundary never checks anyone out."""
    return distance_m - accuracy_m > radius_m
