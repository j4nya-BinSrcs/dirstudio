import asyncio
import logging
from pathlib import Path
from typing import Optional, Callable, List
from dataclasses import dataclass, field
from datetime import datetime

from core.filesystem import FilesystemTree
from core.worker import WorkerPool, ScanTask

logger = logging.getLogger(__name__)


@dataclass
class ScanProgress:
    """Track scanning progress"""
    total_files: int = 0
    processed_files: int = 0
    total_size: int = 0
    processed_size: int = 0
    current_path: str = ""
    start_time: datetime = field(default_factory=datetime.now)
    errors: List[dict[str, str]] = field(default_factory=list)
    
    @property
    def progress_percent(self) -> float:
        """Overall progress percentage"""
        if self.total_files == 0:
            return 0.0
        return (self.processed_files / self.total_files) * 100
    
    @property
    def elapsed_seconds(self) -> float:
        """Calculate elapsed time in seconds"""
        return (datetime.now() - self.start_time).total_seconds()
    
    @property
    def files_per_second(self) -> float:
        """Processing throughput"""
        elapsed = self.elapsed_seconds
        return self.processed_files / elapsed if elapsed > 0 else 0.0
    
    def to_dict(self) -> dict:
        """Serialize progress for API responses"""
        return {
            'total_files': self.total_files,
            'processed_files': self.processed_files,
            'total_size': self.total_size,
            'processed_size': self.processed_size,
            'total_size_gb': round(self.total_size / (1024**3), 2),
            'processed_size_gb': round(self.processed_size / (1024**3), 2),
            'current_path': self.current_path,
            'progress_percent': round(self.progress_percent, 2),
            'elapsed_seconds': round(self.elapsed_seconds, 2),
            'files_per_second': round(self.files_per_second, 2),
            'errors_count': len(self.errors),
        }


class DirectoryScanner:
    """
    Async directory scanner - discovers and processes files in one pass.
    """
    
    def __init__(
        self,
        root_path: str,
        num_workers: int = 4,
        max_queue_size: int = 1000,
        extract_props: bool = False,
        progress_callback: Optional[Callable[[ScanProgress], None]] = None
    ):
        """
        Initialize directory scanner.
        
        Args:
            root_path: Root directory to scan
            num_workers: Number of concurrent worker tasks
            max_queue_size: Maximum size of task queue
            extract_props: Whether to extract expensive file properties
            progress_callback: Optional callback for progress updates
        """
        self.root_path = Path(root_path).resolve()
        self.num_workers = num_workers
        self.max_queue_size = max_queue_size
        self.extract_props = extract_props
        self.progress_callback = progress_callback
        
        # Progress tracking
        self.progress = ScanProgress()
        
        # Worker pool
        self.worker_pool: Optional[WorkerPool] = None
        
        # Final result
        self.result_tree: Optional[FilesystemTree] = None
        
        # Scan filters
        self.exclude_patterns: List[str] = [
            '*.tmp', '*.temp', '*.cache',
            '__pycache__', '.git', '.svn', 'node_modules',
            '.venv', 'venv', '.DS_Store', 'Thumbs.db'
        ]
        self.exclude_dirs: set[str] = {
            '.git', '.svn', '.hg', '__pycache__',
            'node_modules', '.venv', 'venv'
        }
        self.max_file_size: Optional[int] = None  # None = no limit
        self.min_file_size: int = 0  # Skip empty files by default
    
    def should_exclude(self, path: Path) -> bool:
        """Check if path should be excluded from scan."""
        # Check if directory should be excluded
        if path.is_dir() and path.name in self.exclude_dirs:
            return True
        
        # Check exclude patterns
        for pattern in self.exclude_patterns:
            if path.match(pattern):
                return True
        
        return False
    
    async def scan(self) -> FilesystemTree:
        """
        Execute scan: discover files and process them concurrently.
        Single-pass discovery with concurrent processing.
        
        Returns:
            Complete FilesystemTree with all scanned files
        """
        logger.info(f"Starting scan of {self.root_path}")
        self.progress.start_time = datetime.now()
        
        try:
            # Create and start worker pool
            self.worker_pool = WorkerPool(
                root_path=str(self.root_path),
                num_workers=self.num_workers,
                max_queue_size=self.max_queue_size,
                extract_props=self.extract_props
            )
            
            await self.worker_pool.start()
            
            # Discover and queue files concurrently with processing
            # This is more efficient than two-pass approach
            discovery_task = asyncio.create_task(
                self._discover_and_queue_files()
            )
            
            # Monitor progress while discovery runs
            monitor_task = asyncio.create_task(
                self._monitor_progress()
            )
            
            # Wait for discovery to complete
            await discovery_task
            
            # Signal workers to stop after all files queued
            await self.worker_pool.stop_workers()
            
            # Wait for all workers to finish
            await self.worker_pool.wait_completion()
            
            # Stop monitoring
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            
            # Merge trees
            logger.info("Merging worker trees...")
            self.result_tree = await self.worker_pool.merge_trees()
            
            # Final stats
            final_stats = self.worker_pool.get_total_stats()
            self.progress.processed_files = final_stats['total_files']
            self.progress.processed_size = final_stats['total_bytes']
            
            # Final progress callback
            if self.progress_callback:
                await asyncio.to_thread(self.progress_callback, self.progress)
            
            logger.info(
                f"Scan complete: {final_stats['total_files']} files, "
                f"{final_stats['total_errors']} errors, "
                f"{self.progress.elapsed_seconds:.2f}s, "
                f"{self.progress.files_per_second:.2f} files/sec"
            )
            
            return self.result_tree
            
        except Exception as e:
            logger.error(f"Scan failed: {e}")
            raise
    
    async def _discover_and_queue_files(self) -> None:
        """
        Single-pass discovery: walk filesystem and queue tasks.
        Files are queued as discovered, so workers can start immediately.
        """
        logger.info("Discovering and queueing files...")
        
        discovered = 0
        
        try:
            for path in self.root_path.rglob("*"):
                # Check if should exclude
                if self.should_exclude(path):
                    continue
                
                # Only process files
                if not path.is_file():
                    continue
                
                try:
                    stat = path.stat()
                    
                    # Check file size limits
                    if stat.st_size < self.min_file_size:
                        continue
                    
                    if self.max_file_size and stat.st_size > self.max_file_size:
                        logger.warning(
                            f"Skipping large file: {path} "
                            f"({stat.st_size / (1024**2):.2f} MB)"
                        )
                        continue
                    
                    # Create and queue task immediately
                    task = ScanTask(file_path=path, file_size=stat.st_size)
                    await self.worker_pool.add_task(task) # type: ignore
                    
                    # Update discovery stats
                    discovered += 1
                    self.progress.total_files = discovered
                    self.progress.total_size += stat.st_size
                    self.progress.current_path = str(path)
                    
                except (PermissionError, OSError) as e:
                    self.progress.errors.append({
                        'path': str(path),
                        'error': str(e),
                        'phase': 'discovery'
                    })
            
            logger.info(f"Discovery complete: {discovered} files queued")
            
        except Exception as e:
            logger.error(f"Error during file discovery: {e}")
            raise
    
    async def _monitor_progress(self) -> None:
        """
        Monitor and report progress periodically.
        Runs concurrently with discovery and processing.
        """
        while True:
            try:
                # Wait a bit between updates
                await asyncio.sleep(1.0)
                
                # Get current worker stats
                if self.worker_pool:
                    worker_stats = self.worker_pool.get_total_stats()
                    self.progress.processed_files = worker_stats['total_files']
                    self.progress.processed_size = worker_stats['total_bytes']
                
                # Call progress callback
                if self.progress_callback:
                    try:
                        await asyncio.to_thread(
                            self.progress_callback,
                            self.progress
                        )
                    except Exception as e:
                        logger.debug(f"Progress callback error: {e}")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in progress monitor: {e}")
    
    def get_progress(self) -> ScanProgress:
        """Get current scan progress"""
        return self.progress
    
    def get_worker_stats(self) -> dict:
        """Get worker statistics"""
        if self.worker_pool:
            return self.worker_pool.get_total_stats()
        return {}
    
    def add_exclude_pattern(self, pattern: str) -> None:
        """Add a pattern to exclude from scanning"""
        self.exclude_patterns.append(pattern)
    
    def add_exclude_dir(self, dirname: str) -> None:
        """Add a directory name to exclude"""
        self.exclude_dirs.add(dirname)
    
    def set_max_file_size(self, size_bytes: int) -> None:
        """Set maximum file size to scan"""
        self.max_file_size = size_bytes
    
    def set_min_file_size(self, size_bytes: int) -> None:
        """Set minimum file size to scan"""
        self.min_file_size = size_bytes


# ============================================================
# Convenience Functions
# ============================================================

async def scan_directory(
    root_path: str,
    num_workers: int = 4,
    extract_props: bool = False,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
    exclude_patterns: Optional[List[str]] = None,
    max_file_size: Optional[int] = None
) -> FilesystemTree:
    """
    Convenience function to scan a directory.
    
    Args:
        root_path: Root directory to scan
        num_workers: Number of concurrent workers
        extract_props: Whether to extract expensive properties
        progress_callback: Optional progress callback
        exclude_patterns: Optional list of patterns to exclude
        max_file_size: Optional maximum file size in bytes
        
    Returns:
        Complete FilesystemTree
    """
    scanner = DirectoryScanner(
        root_path=root_path,
        num_workers=num_workers,
        extract_props=extract_props,
        progress_callback=progress_callback
    )
    
    if exclude_patterns:
        for pattern in exclude_patterns:
            scanner.add_exclude_pattern(pattern)
    
    if max_file_size:
        scanner.set_max_file_size(max_file_size)
    
    return await scanner.scan()


async def quick_scan(root_path: str, num_workers: int = 4) -> FilesystemTree:
    """Quick scan with default settings."""
    return await scan_directory(root_path, num_workers=num_workers)

