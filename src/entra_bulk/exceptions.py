"""Exception hierarchy for entra-bulk."""

from __future__ import annotations


class EntraBulkError(Exception):
    """Base exception for entra-bulk."""


class FatalError(EntraBulkError):
    """Unrecoverable error — exit code 2."""


class UserNotFoundError(EntraBulkError):
    """User could not be resolved."""


class GroupNotFoundError(EntraBulkError):
    """Group could not be resolved."""


class AmbiguousGroupError(EntraBulkError):
    """Multiple groups matched the displayName."""


class AlreadyMemberWarning(EntraBulkError):
    """User is already a member of the group."""


class NotMemberWarning(EntraBulkError):
    """User is not a member of the group."""


class GraphApiError(EntraBulkError):
    """Generic Graph API failure (403, 429, 5xx)."""
