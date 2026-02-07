"""
Pydantic models for API requests and responses.
"""
from pydantic import BaseModel, Field
from typing import Optional


class ScanRequest(BaseModel):
    """Request to create a new scan."""
    path: str = Field(
        ..., 
        description="Directory path to scan",
        examples=["C:/Users/username/Documents", "/home/user/documents", ".", "~/Documents"]
    )
    compute_sha256: bool = Field(default=True, description="Compute SHA-256 hashes")
    compute_phash: bool = Field(default=True, description="Compute perceptual hashes")
    max_depth: Optional[int] = Field(default=None, description="Maximum scan depth")
    num_workers: Optional[int] = Field(default=None, description="Number of worker threads")


class ScanResponse(BaseModel):
    """Response after creating scan."""
    scan_id: str
    status: str
    message: str
    created_at: str


class ScanStatus(BaseModel):
    """Scan status information."""
    scan_id: str
    status: str
    path: str
    progress: float
    created_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None


class ScanOverview(BaseModel):
    """Scan overview statistics."""
    scan_id: str
    total_files: int
    total_dirs: int
    total_size: int
    depth: int
    file_types: dict
    top_extensions: list


class DuplicateRequest(BaseModel):
    """Request to detect duplicates."""
    detect_exact: bool = Field(default=True, description="Detect exact duplicates")
    detect_near: bool = Field(default=True, description="Detect near duplicates")
    phash_threshold: Optional[int] = Field(default=None, description="Perceptual hash threshold")


class OrganizeRequest(BaseModel):
    """Request for organization suggestions."""
    base_path: Optional[str] = Field(default=None, description="Base path for organization")
    temperature: float = Field(default=0.7, description="LLM temperature (0.0-1.0)")


class TransformRequest(BaseModel):
    """Request for file transformation."""
    operation: str = Field(..., description="Operation: compress, convert, resize, move, copy, delete")
    file_paths: list[str] = Field(..., description="List of file paths")
    target_path: Optional[str] = Field(default=None, description="Target path or directory")
    dry_run: bool = Field(default=True, description="Dry run mode")
    params: Optional[dict] = Field(default=None, description="Additional parameters")