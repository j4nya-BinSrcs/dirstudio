"""
services/snapshots.py — Directory snapshot management for DirStudio.

A snapshot captures the full metadata state (paths, sizes, mtimes, hashes)
of a scanned directory at a point in time. Diffs compare two snapshots to
report added, removed, modified, and renamed files.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class SnapshotFile:
    """Lightweight record of a single file at snapshot time."""
    path: str
    size: int
    sha256: Optional[str] = None
    mtime: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SnapshotFile":
        return cls(**d)


@dataclass
class Snapshot:
    """Point-in-time record of a directory's state."""
    snapshot_id: str
    scan_id: str
    label: str
    path: str
    created_at: str
    file_count: int
    total_size: int
    files: list[SnapshotFile] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["files"] = [f.to_dict() for f in self.files]
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Snapshot":
        files = [SnapshotFile.from_dict(f) for f in d.pop("files", [])]
        return cls(**d, files=files)

    def to_summary_dict(self) -> dict:
        """Return metadata without the (potentially large) file list."""
        return {
            "snapshot_id": self.snapshot_id,
            "scan_id": self.scan_id,
            "label": self.label,
            "path": self.path,
            "created_at": self.created_at,
            "file_count": self.file_count,
            "total_size": self.total_size,
            "notes": self.notes,
        }


@dataclass
class DiffEntry:
    """One changed file in a snapshot diff."""
    change: str   # "added" | "removed" | "modified" | "renamed"
    path: str
    old_path: Optional[str] = None   # for renames
    old_size: Optional[int] = None
    new_size: Optional[int] = None
    size_delta: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SnapshotDiff:
    """Result of comparing two snapshots."""
    snapshot_a_id: str
    snapshot_b_id: str
    snapshot_a_label: str
    snapshot_b_label: str
    added: list[DiffEntry] = field(default_factory=list)
    removed: list[DiffEntry] = field(default_factory=list)
    modified: list[DiffEntry] = field(default_factory=list)
    renamed: list[DiffEntry] = field(default_factory=list)

    @property
    def total_changes(self) -> int:
        return len(self.added) + len(self.removed) + len(self.modified) + len(self.renamed)

    @property
    def size_delta(self) -> int:
        delta = sum(e.size_delta or 0 for e in self.added + self.modified + self.renamed)
        delta -= sum(e.old_size or 0 for e in self.removed)
        return delta

    def to_dict(self) -> dict:
        return {
            "snapshot_a_id": self.snapshot_a_id,
            "snapshot_b_id": self.snapshot_b_id,
            "snapshot_a_label": self.snapshot_a_label,
            "snapshot_b_label": self.snapshot_b_label,
            "summary": {
                "total_changes": self.total_changes,
                "added": len(self.added),
                "removed": len(self.removed),
                "modified": len(self.modified),
                "renamed": len(self.renamed),
                "size_delta_bytes": self.size_delta,
            },
            "added":    [e.to_dict() for e in self.added],
            "removed":  [e.to_dict() for e in self.removed],
            "modified": [e.to_dict() for e in self.modified],
            "renamed":  [e.to_dict() for e in self.renamed],
        }


# ---------------------------------------------------------------------------
# SnapshotManager
# ---------------------------------------------------------------------------

class SnapshotManager:
    """
    Creates and diffs snapshots from FilesystemTree objects.
    Storage is handled externally (DB layer); this class is pure logic.
    """

    @staticmethod
    def create_snapshot(
        scan_id: str,
        tree,                        # FilesystemTree from core.filesystem
        label: str = "",
        notes: str = "",
    ) -> Snapshot:
        """
        Build a Snapshot from a completed scan tree.

        Args:
            scan_id:  ID of the parent scan.
            tree:     FilesystemTree returned by Scanner.
            label:    Human-readable label (e.g. "Before cleanup").
            notes:    Optional free-text notes.

        Returns:
            Snapshot object (not yet persisted).
        """
        snapshot_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        files: list[SnapshotFile] = []
        total_size = 0

        for file_node in tree.traverse():
            sf = SnapshotFile(
                path=str(file_node.path),
                size=file_node.size,
                sha256=file_node.hashes.get("sha256"),
                mtime=(
                    file_node.metadata.time.get("MODIFIED")
                    if file_node.metadata and file_node.metadata.time
                    else None
                ),
            )
            files.append(sf)
            total_size += file_node.size

        stats = tree.compute_stats()

        return Snapshot(
            snapshot_id=snapshot_id,
            scan_id=scan_id,
            label=label or f"Snapshot {now[:10]}",
            path=stats.get("path", ""),
            created_at=now,
            file_count=len(files),
            total_size=total_size,
            files=files,
            notes=notes,
        )

    @staticmethod
    def diff(snap_a: Snapshot, snap_b: Snapshot) -> SnapshotDiff:
        """
        Compute the difference between two snapshots.

        Strategy:
        - Build path→file maps for both snapshots.
        - Build sha256→[paths] maps for rename detection.
        - Walk all paths to classify as added / removed / modified.
        - Detect renames: file removed in A and added in B with same sha256.
        """
        map_a: dict[str, SnapshotFile] = {f.path: f for f in snap_a.files}
        map_b: dict[str, SnapshotFile] = {f.path: f for f in snap_b.files}

        paths_a = set(map_a)
        paths_b = set(map_b)

        # Sha → paths lookup for rename detection (only for files with hashes)
        sha_to_b: dict[str, list[str]] = {}
        for f in snap_b.files:
            if f.sha256:
                sha_to_b.setdefault(f.sha256, []).append(f.path)

        diff = SnapshotDiff(
            snapshot_a_id=snap_a.snapshot_id,
            snapshot_b_id=snap_b.snapshot_id,
            snapshot_a_label=snap_a.label,
            snapshot_b_label=snap_b.label,
        )

        matched_new_paths: set[str] = set()

        # Removed or renamed
        for path in paths_a - paths_b:
            fa = map_a[path]
            # Rename detection: same hash exists at a new path in B
            if fa.sha256 and fa.sha256 in sha_to_b:
                new_paths = [p for p in sha_to_b[fa.sha256] if p not in paths_a]
                if new_paths:
                    new_path = new_paths[0]
                    fb = map_b[new_path]
                    matched_new_paths.add(new_path)
                    diff.renamed.append(DiffEntry(
                        change="renamed",
                        path=new_path,
                        old_path=path,
                        old_size=fa.size,
                        new_size=fb.size,
                        size_delta=fb.size - fa.size,
                    ))
                    continue

            diff.removed.append(DiffEntry(
                change="removed",
                path=path,
                old_size=fa.size,
            ))

        # Added
        for path in paths_b - paths_a:
            if path in matched_new_paths:
                continue
            fb = map_b[path]
            diff.added.append(DiffEntry(
                change="added",
                path=path,
                new_size=fb.size,
                size_delta=fb.size,
            ))

        # Modified (same path, different content)
        for path in paths_a & paths_b:
            fa, fb = map_a[path], map_b[path]
            changed = False
            if fa.sha256 and fb.sha256 and fa.sha256 != fb.sha256:
                changed = True
            elif fa.size != fb.size:
                changed = True
            elif fa.mtime and fb.mtime and fa.mtime != fb.mtime:
                changed = True

            if changed:
                diff.modified.append(DiffEntry(
                    change="modified",
                    path=path,
                    old_size=fa.size,
                    new_size=fb.size,
                    size_delta=fb.size - fa.size,
                ))

        return diff