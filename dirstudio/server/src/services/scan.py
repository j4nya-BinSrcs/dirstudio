"""
Filesystem scanner with async walking and worker-based processing.
"""
import os
from pathlib import Path
from queue import Queue
from typing import Optional, Set

import config
from core.filesystem import FilesystemTree
from core.processor import ProcessorPool


class Scanner:
    """
    Filesystem scanner with multi-threaded processing.
    """
    
    def __init__(
        self,
        exclude_patterns: Optional[Set[str]] = None,
        max_depth: Optional[int] = None,
        num_workers: Optional[int] = None
    ):
        self.exclude = exclude_patterns or config.EXCLUDE_PATTERNS
        self.max_depth = max_depth
        self.num_workers = num_workers or config.DEFAULT_WORKERS
    
    def _should_exclude(self, path: Path) -> bool:
        """Check if path matches any exclude pattern."""
        return any(pattern in path.parts for pattern in self.exclude)
    
    def _walk(self, root: Path, queue: Queue, depth: int = 0) -> int:
        """
        Walk directory tree and add files to queue.
        
        Returns:
            Total number of files discovered
        """
        count = 0
        
        try:
            with os.scandir(root) as entries:
                for entry in entries:
                    path = Path(entry.path)
                    
                    if self._should_exclude(path):
                        continue
                    
                    try:
                        if entry.is_file(follow_symlinks=False):
                            queue.put(str(path))
                            count += 1
                        
                        elif entry.is_dir(follow_symlinks=False):
                            if self.max_depth is None or depth < self.max_depth:
                                count += self._walk(path, queue, depth + 1)
                    
                    except (PermissionError, OSError):
                        continue
        
        except (PermissionError, OSError):
            pass
        
        return count
    
    def scan(
        self,
        path: str,
        compute_sha256: bool = True,
        compute_phash: bool = True
    ) -> FilesystemTree:
        """
        Scan a directory and build filesystem tree.
        
        Args:
            path: Directory path to scan
            compute_sha256: Whether to compute SHA-256 hashes
            compute_phash: Whether to compute perceptual hashes for images
        
        Returns:
            Complete FilesystemTree with metadata and hashes
        """
        root = Path(path).resolve()
        
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Invalid directory: {path}")
        
        # Initialize tree
        tree = FilesystemTree(root)
        
        # Create queue
        queue = Queue(maxsize=config.MAX_QUEUE_SIZE)
        
        print(f"Scanning: {root}")
        
        # Walk directory and populate queue
        file_count = self._walk(root, queue)
        
        print(f"Found {file_count} files")
        print(f"Processing with {self.num_workers} workers...")
        
        # Start processor pool
        pool = ProcessorPool(
            num_workers=self.num_workers,
            file_queue=queue,
            tree=tree,
            compute_sha256=compute_sha256,
            compute_phash=compute_phash
        )
        
        pool.start()
        pool.wait()
        
        print("Scan complete")
        
        return tree