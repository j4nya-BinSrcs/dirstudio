"""
FastAPI REST API endpoints for DirStudio.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Path as PathParam, Depends
from sqlalchemy.orm import Session
from pathlib import Path
from datetime import datetime
import uuid
import sys
from pathlib import Path as PathLib

# Add parent directory to path for imports
_src_path = PathLib(__file__).parent.parent
if str(_src_path) not in sys.path:
    sys.path.insert(0, str(_src_path))

from .models import (
    ScanRequest, ScanResponse, ScanStatus, ScanOverview,
    DuplicateRequest, OrganizeRequest, TransformRequest
)
from services.scan import Scanner
from services.duplicate import DuplicateDetector
from services.organize import Organizer
from services.transform import Transformer
import config
import db.crud as crud
from db.database import get_db, db as global_db


# Router
router = APIRouter()


# Background task for scanning
def perform_scan_task(scan_id: str, request: ScanRequest):
    """Background task to perform directory scan."""
    
    try:
        # Create new session for background task
        with global_db.session_scope() as session:
            # Update status to running
            crud.update_scan_status(session, scan_id, 'running')
        
        # Create scanner
        scanner = Scanner(
            max_depth=request.max_depth,
            num_workers=request.num_workers or config.DEFAULT_WORKERS
        )
        
        # Perform scan
        tree = scanner.scan(
            path=request.path,
            compute_sha256=request.compute_sha256,
            compute_phash=request.compute_phash
        )
        
        # Save tree and stats to database
        with global_db.session_scope() as session:
            crud.save_scan_tree(session, scan_id, tree)
            
            # Also save individual files for querying
            scan_db = crud.get_scan(session, scan_id)
            if scan_db:
                files = list(tree.traverse())
                if files:
                    crud.bulk_create_files(session, scan_db.id, files)
        
    except Exception as e:
        # Handle error with traceback
        import traceback
        print(f"Error in background scan task:")
        traceback.print_exc()
        
        try:
            with global_db.session_scope() as session:
                crud.update_scan_status(session, scan_id, 'failed', error=str(e))
        except Exception as db_error:
            print(f"Failed to update scan status: {db_error}")


# Endpoints

@router.post("/scans", response_model=ScanResponse)
async def create_scan(
    request: ScanRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Create a new directory scan and return immediately."""
    # Validate path
    try:
        path = Path(request.path)
        if str(path).startswith('~'):
            path = path.expanduser()
        
        if not path.exists():
            raise HTTPException(status_code=400, detail=f"Path does not exist: {request.path}")
        if not path.is_dir():
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {request.path}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {str(e)}")
    
    # Generate scan ID
    scan_id = str(uuid.uuid4())
    
    # Create scan record in database
    scan = crud.create_scan(
        db,
        scan_id=scan_id,
        path=str(path.absolute()).replace('\\', '/')
    )
    
    # Start background scan (non-blocking)
    background_tasks.add_task(perform_scan_task, scan_id, request)
    
    # Return immediately
    return ScanResponse(
        scan_id=scan_id,
        status='pending',
        message=f"Scan started for {request.path}",
        created_at=datetime.utcnow().isoformat()
    )


@router.get("/scans", response_model=list[ScanStatus])
async def list_scans(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """List all scans."""
    scans = crud.get_scans(db, skip=skip, limit=limit)
    
    return [
        ScanStatus(
            scan_id=scan.scan_id,
            status=scan.status,
            path=scan.path,
            progress=100.0 if scan.status == 'completed' else 0.0,
            created_at=datetime.utcnow().isoformat(),
            completed_at=datetime.utcnow().isoformat() if scan.status == 'completed' else None,
            error=scan.error
        )
        for scan in scans
    ]


@router.get("/scans/{scan_id}", response_model=ScanStatus)
async def get_scan_status(scan_id: str = PathParam(...), db: Session = Depends(get_db)):
    """Get scan status."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    return ScanStatus(
        scan_id=scan.scan_id,
        status=scan.status,
        path=scan.path,
        progress=100.0 if scan.status == 'completed' else 0.0,
        created_at=datetime.utcnow().isoformat(),
        completed_at=datetime.utcnow().isoformat() if scan.status == 'completed' else None,
        error=scan.error
    )


@router.get("/scans/{scan_id}/overview", response_model=ScanOverview)
async def get_scan_overview(scan_id: str = PathParam(...), db: Session = Depends(get_db)):
    """Get scan overview with statistics."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    if scan.status != 'completed':
        raise HTTPException(status_code=400, detail="Scan not completed")
    
    # Get tree from database
    tree = crud.get_scan_tree(db, scan_id)
    if not tree:
        raise HTTPException(status_code=500, detail="Scan tree not available")
    
    stats = tree.compute_stats()
    
    top_exts = sorted(stats['extensions'].items(), key=lambda x: x[1], reverse=True)[:10]
    
    return ScanOverview(
        scan_id=scan_id,
        total_files=stats['total_files'],
        total_dirs=stats['total_dirs'],
        total_size=stats['total_size'],
        depth=stats['depth'],  # Uses 'depth' from stats
        file_types=stats['file_types'],
        top_extensions=[{'ext': ext, 'count': count} for ext, count in top_exts]
    )


@router.get("/scans/{scan_id}/tree")
async def get_scan_tree(scan_id: str = PathParam(...), db: Session = Depends(get_db)):
    """Get complete filesystem tree."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    if scan.status != 'completed':
        raise HTTPException(status_code=400, detail="Scan not completed")
    
    # Get tree from database
    tree = crud.get_scan_tree(db, scan_id)
    if not tree:
        raise HTTPException(status_code=500, detail="Scan tree not available")
    
    return tree.to_dict()


@router.post("/scans/{scan_id}/duplicates")
async def detect_duplicates(
    request: DuplicateRequest,
    scan_id: str = PathParam(...),
    db: Session = Depends(get_db)
):
    """Detect duplicate files."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    if scan.status != 'completed':
        raise HTTPException(status_code=400, detail="Scan not completed")
    
    # Get tree from database
    tree = crud.get_scan_tree(db, scan_id)
    if not tree:
        raise HTTPException(status_code=500, detail="Scan tree not available")
    
    files = list(tree.traverse())
    
    # Detect duplicates
    detector = DuplicateDetector()
    for file_node in files:
        detector.add_file(file_node)
    
    results = {}
    
    if request.detect_exact:
        exact = detector.detect_exact_duplicates()
        results['exact_duplicates'] = {k: v.to_dict() for k, v in exact.items()}
        
        # Save to database
        for group in exact.values():
            crud.create_duplicate_group(
                db,
                scan_id=scan.id,
                group_id=group.group_id,
                duplicate_type=group.duplicate_type,
                file_count=len(group.files),
                total_size=group.total_size,
                wastage=group.wastage
            )
    
    if request.detect_near:
        near = detector.detect_near_duplicates(request.phash_threshold)
        results['near_duplicates'] = {k: v.to_dict() for k, v in near.items()}
        
        # Save to database
        for group in near.values():
            crud.create_duplicate_group(
                db,
                scan_id=scan.id,
                group_id=group.group_id,
                duplicate_type=group.duplicate_type,
                file_count=len(group.files),
                total_size=group.total_size,
                wastage=group.wastage
            )
    
    results['statistics'] = detector.get_statistics()
    
    return results


@router.post("/scans/{scan_id}/organize")
async def get_organization_suggestions(
    request: OrganizeRequest,
    scan_id: str = PathParam(...),
    db: Session = Depends(get_db)
):
    """Get organization suggestions (computed on-demand, not stored)."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    if scan.status != 'completed':
        raise HTTPException(status_code=400, detail="Scan not completed")
    
    # Get tree from database
    tree = crud.get_scan_tree(db, scan_id)
    if not tree:
        raise HTTPException(status_code=500, detail="Scan tree not available")
    
    files = list(tree.traverse())
    
    # Generate suggestions (not saved to DB)
    base_path = request.base_path or scan.path
    organizer = Organizer(base_path)
    organizer.create_default_rules()
    
    return organizer.generate_report(files)


@router.post("/scans/{scan_id}/transform")
async def transform_files(
    request: TransformRequest,
    scan_id: str = PathParam(...),
    db: Session = Depends(get_db)
):
    """Perform file transformations (not tracked in DB)."""
    scan = crud.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    if scan.status != 'completed':
        raise HTTPException(status_code=400, detail="Scan not completed")
    
    # Get tree from database
    tree = crud.get_scan_tree(db, scan_id)
    if not tree:
        raise HTTPException(status_code=500, detail="Scan tree not available")
    
    # Get file nodes
    all_files = {str(f.path): f for f in tree.traverse()}
    file_nodes = []
    for path in request.file_paths:
        if path not in all_files:
            raise HTTPException(status_code=400, detail=f"File not found: {path}")
        file_nodes.append(all_files[path])
    
    # Perform transformation
    transformer = Transformer(dry_run=request.dry_run)
    
    if request.operation == 'compress':
        params = request.params or {}
        format = params.get('format', 'zip')
        target = Path(request.target_path) if request.target_path else Path('archive.zip')
        result = transformer.compress_files(file_nodes, target, format)
        return result.to_dict()
    
    elif request.operation in ('move', 'copy', 'delete'):
        if request.operation == 'delete':
            results = transformer.delete_files(file_nodes)
        else:
            target = Path(request.target_path) if request.target_path else None
            if not target:
                raise HTTPException(status_code=400, detail="target_path required")
            
            if request.operation == 'move':
                results = transformer.move_files(file_nodes, target)
            else:
                results = transformer.copy_files(file_nodes, target)
        
        return {'results': [r.to_dict() for r in results]}
    
    elif request.operation in ('convert', 'resize'):
        params = request.params or {}
        output_dir = Path(request.target_path) if request.target_path else None
        results = []
        
        if request.operation == 'convert':
            format = params.get('format')
            if not format:
                raise HTTPException(status_code=400, detail="format required")
            
            for file_node in file_nodes:
                result = transformer.convert_image(file_node, format, output_dir)
                results.append(result)
        else:
            max_width = params.get('max_width', 1920)
            max_height = params.get('max_height', 1080)
            
            for file_node in file_nodes:
                result = transformer.resize_image(file_node, max_width, max_height, output_dir)
                results.append(result)
        
        return {'results': [r.to_dict() for r in results]}
    
    else:
        raise HTTPException(status_code=400, detail=f"Unknown operation: {request.operation}")


@router.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str = PathParam(...), db: Session = Depends(get_db)):
    """Delete a scan and all related data."""
    success = crud.delete_scan(db, scan_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")
    
    return {"message": f"Scan {scan_id} deleted"}


@router.get("/stats")
async def get_global_stats(db: Session = Depends(get_db)):
    """Get global statistics across all scans."""
    scans = crud.get_scans(db)
    completed = [s for s in scans if s.status == 'completed']
    
    total_files = sum(s.total_files for s in completed)
    total_size = sum(s.total_size for s in completed)
    
    return {
        'total_scans': len(scans),
        'completed_scans': len(completed),
        'total_files': total_files,
        'total_size': total_size,
        'total_size_gb': total_size / (1024**3) if total_size > 0 else 0
    }