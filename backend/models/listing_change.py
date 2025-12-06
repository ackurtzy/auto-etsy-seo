"""Models describing listing optimization experiments."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence


class ListingChangeType(str, Enum):
    """Enumerates supported listing change experiment types."""

    TAGS = "tags"
    TITLE = "title"
    THUMBNAILS = "thumbnail"
    DESCRIPTION = "description"


class ExperimentState(str, Enum):
    """Lifecycle state for a listing experiment."""

    PROPOSED = "proposed"
    TESTING = "testing"
    FINISHED = "finished"
    REVERTED = "reverted"
    KEPT = "kept"


@dataclass
class ListingChange:
    """Base class for an Etsy listing experiment."""

    listing_id: int
    change_type: ListingChangeType = field(init=False)


@dataclass
class TagChange(ListingChange):
    """Tracks tag adjustments applied to a listing."""

    tags_to_remove: List[str] = field(default_factory=list)
    tags_to_add: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.change_type = ListingChangeType.TAGS


@dataclass
class TitleChange(ListingChange):
    """Represents a title rewrite experiment."""

    new_title: str = ""

    def __post_init__(self) -> None:
        self.change_type = ListingChangeType.TITLE


@dataclass
class ThumbnailImageChange(ListingChange):
    """Captures a change in thumbnail ordering."""

    new_ordering: Sequence[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.change_type = ListingChangeType.THUMBNAILS


@dataclass
class DescriptionChange(ListingChange):
    """Documents experimentation on listing descriptions."""

    new_description: str = ""

    def __post_init__(self) -> None:
        self.change_type = ListingChangeType.DESCRIPTION


@dataclass
class ListingExperiment:
    """Tracks metadata for a listing change experiment."""

    changes: List[ListingChange]
    start_date: date
    end_date: Optional[date] = None
    notes: Optional[str] = None
    original_listing: Dict[str, Any] = field(default_factory=dict)
    original_listing_images: Dict[str, Any] = field(default_factory=dict)
    state: ExperimentState = ExperimentState.PROPOSED
    listing_id: int = field(init=False)

    def __post_init__(self) -> None:
        if not self.changes:
            raise ValueError("ListingExperiment requires at least one change.")
        listing_ids = {change.listing_id for change in self.changes}
        if len(listing_ids) != 1:
            raise ValueError("All ListingChange instances must target the same listing.")
        self.listing_id = listing_ids.pop()

    @property
    def change_types(self) -> List[ListingChangeType]:
        """Returns the change types included in the experiment."""
        return [change.change_type for change in self.changes]

    @property
    def is_active(self) -> bool:
        """Returns True while the experiment is still running."""
        return self.end_date is None or self.end_date >= date.today()
