"""Usernames are the public @handle used to find people (tasks, messages).

They are lowercase, 3–30 characters of a-z, 0-9, ".", "_" or "-", starting and ending with a
letter or digit. Relationships always use the internal user/employee id, never the username,
so renaming a user never breaks a task assignment or conversation.
"""

import re

from django.core.exceptions import ValidationError

USERNAME_MAX_LENGTH = 30
USERNAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$")


def normalize(value):
    value = (value or "").strip().lower()
    return value[1:] if value.startswith("@") else value


def validate_username(value):
    if not USERNAME_PATTERN.match(normalize(value)):
        raise ValidationError(
            "Use 3–30 characters: letters, digits, '.', '_' or '-', starting and ending with a letter or digit."
        )


def _base_from(email):
    local = (email or "").split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9._-]", "", local).strip("._-")[: USERNAME_MAX_LENGTH - 4].strip("._-")
    return base if len(base) >= 3 else f"user{base}"


def generate_unique(User, email, exclude_pk=None):
    """A free username derived from the email's local part (works with historical models)."""
    base = _base_from(email)
    candidate, n = base, 1
    while True:
        qs = User.objects.filter(username=candidate)
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        if not qs.exists():
            return candidate
        n += 1
        candidate = f"{base}{n}"
