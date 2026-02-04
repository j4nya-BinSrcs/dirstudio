"""
CRUD operations for database.
Simplified - only essential operations.
"""
from sqlalchemy.orm import Session
from typing import Optional, List
import json

from .schema import Scan, File, DuplicateGroup
from core.filesystem import FileNode, FilesystemTree


# Scan Operations

def create_scan(db: Session, scan_id: str, path: str) -> Scan:
    """Create a new scan record."""
    scan = Scan(
        scan_id=scan_id,
        path=path,
        status='pending'
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan


def get_scan(db: Session, scan_id: str) -> Optional[Scan]:
    """Get scan by scan_id."""
    return db.query(Scan).filter(Scan.scan_id == scan_id).first()


def get_scans(db: Session, skip: int = 0, limit: int = 100) -> List[Scan]:
    """Get all scans."""
    return db.query(Scan).offset(skip).limit(limit).all()


def update_scan_status(db: Session, scan_id: str, status: str, error: Optional[str] = None) -> Optional[Scan]:
    """Update scan status."""
    scan = get_scan(db, scan_id)
    if not scan:
        return None
    
    scan.status = status
    if error:
        scan.error = error
    
    db.commit()
    db.refresh(scan)
    return scan


def save_scan_tree(db: Session, scan_id: str, tree: FilesystemTree) -> Optional[Scan]:
    """Save complete tree and stats to scan."""
    scan = get_scan(db, scan_id)
    if not scan:
        return None
    
    # Compute stats
    stats = tree.compute_stats()
    
    # Update scan
    scan.total_files = stats['total_files']
    scan.total_dirs = stats['total_dirs']
    scan.total_size = stats['total_size']
    scan.tree_depth = stats['depth']  # Changed from 'depth' to 'tree_depth'
    scan.tree_json = json.dumps(tree.to_dict(), default=str)
    scan.status = 'completed'
    
    db.commit()
    db.refresh(scan)
    return scan


def get_scan_tree(db: Session, scan_id: str) -> Optional[FilesystemTree]:
    """Retrieve tree from scan."""
    scan = get_scan(db, scan_id)
    if not scan or not scan.tree_json:
        return None
    
    tree_dict = json.loads(scan.tree_json)
    return FilesystemTree.from_dict(tree_dict)


def delete_scan(db: Session, scan_id: str) -> bool:
    """Delete a scan and all related data."""
    scan = get_scan(db, scan_id)
    if not scan:
        return False
    
    db.delete(scan)
    db.commit()
    return True


# File Operations

def create_file(db: Session, scan_id: int, file_node: FileNode) -> File:
    """Create a file record from FileNode."""
    file = File(
        scan_id=scan_id,
        path=str(file_node.path),
        name=file_node.name,
        extension=file_node.path.suffix,
        size=file_node.size,
        mime_type=file_node.metadata.mime,
        file_type=file_node.metadata.filetype.value,
        sha256=file_node.hashes.get('sha256'),
        phash=file_node.hashes.get('phash')
    )
    db.add(file)
    db.commit()
    db.refresh(file)
    return file


def bulk_create_files(db: Session, scan_id: int, file_nodes: List[FileNode]) -> int:
    """Bulk create file records."""
    files = []
    for file_node in file_nodes:
        file = File(
            scan_id=scan_id,
            path=str(file_node.path),
            name=file_node.name,
            extension=file_node.path.suffix,
            size=file_node.size,
            mime_type=file_node.metadata.mime,
            file_type=file_node.metadata.filetype.value,
            sha256=file_node.hashes.get('sha256'),
            phash=file_node.hashes.get('phash')
        )
        files.append(file)
    
    db.bulk_save_objects(files)
    db.commit()
    return len(files)


def get_files_by_scan(db: Session, scan_id: str) -> List[File]:
    """Get all files for a scan."""
    scan = get_scan(db, scan_id)
    if not scan:
        return []
    return db.query(File).filter(File.scan_id == scan.id).all()


# Duplicate Group Operations

def create_duplicate_group(
    db: Session,
    scan_id: int,
    group_id: str,
    duplicate_type: str,
    file_count: int,
    total_size: int,
    wastage: int
) -> DuplicateGroup:
    """Create a duplicate group record."""
    group = DuplicateGroup(
        scan_id=scan_id,
        group_id=group_id,
        duplicate_type=duplicate_type,
        file_count=file_count,
        total_size=total_size,
        wastage=wastage
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def get_duplicate_groups(db: Session, scan_id: str) -> List[DuplicateGroup]:
    """Get all duplicate groups for a scan."""
    scan = get_scan(db, scan_id)
    if not scan:
        return []
    return db.query(DuplicateGroup).filter(DuplicateGroup.scan_id == scan.id).all()