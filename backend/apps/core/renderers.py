import decimal

from rest_framework import renderers
from rest_framework.utils.encoders import JSONEncoder


class DecimalAsStringEncoder(JSONEncoder):
    """Decimals (money, leave days) are always emitted as strings, never floats,
    matching DRF's DecimalField output."""

    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return str(obj)
        return super().default(obj)


class JSONRenderer(renderers.JSONRenderer):
    encoder_class = DecimalAsStringEncoder
