"""
File processor that extracts metadata and computes hashes.
"""
from pathlib import Path
from queue import Queue
import threading
from typing import Optional

from .metadata import Metadata, FileType
from .filesystem import FilesystemTree
import services.hash as hash_service


class Processor:
    """
    Processes files from a queue: extracts metadata, computes hashes,
    and attaches to filesystem tree.
    """
    
    def __init__(
        self,
        file_queue: Queue,
        tree: FilesystemTree,
        compute_sha256: bool = True,
        compute_phash: bool = True
    ):
        self.file_queue = file_queue
        self.tree = tree
        self.compute_sha256 = compute_sha256
        self.compute_phash = compute_phash
        self.lock = threading.Lock()
    
    def process(self, path: Path) -> Optional[tuple[Metadata, dict[str, str]]]:
        """
        Process a single file: extract metadata and compute hashes.
        
        Returns:
            Tuple of (metadata, hashes) or None on error
        """
        try:
            # Extract metadata
            metadata = Metadata.extract(path)
            hashes = {}
            
            # Compute SHA-256
            if self.compute_sha256:
                sha = hash_service.compute_sha256(path)
                if sha:
                    hashes['sha256'] = sha
            
            # Compute perceptual hash for images
            if self.compute_phash and metadata.filetype == FileType.IMAGE:
                phash = hash_service.compute_phash(path)
                if phash is not None:
                    hashes['phash'] = str(phash)
            
            return metadata, hashes
            
        except Exception:
            return None
    
    def run(self) -> None:
        """Main processing loop. Runs until sentinel (None) is received."""
        while True:
            path = self.file_queue.get()
            
            if path is None:  # Sentinel to stop
                self.file_queue.task_done()
                break
            
            result = self.process(Path(path))
            
            if result:
                metadata, hashes = result
                with self.lock:
                    self.tree.attach_file(Path(path), metadata, hashes)
            
            self.file_queue.task_done()


class ProcessorPool:
    """Pool of processor workers for parallel file processing."""
    
    def __init__(
        self,
        num_workers: int,
        file_queue: Queue,
        tree: FilesystemTree,
        compute_sha256: bool = True,
        compute_phash: bool = True
    ):
        self.num_workers = num_workers
        self.file_queue = file_queue
        self.workers = []
        self.threads = []
        
        for _ in range(num_workers):
            processor = Processor(
                file_queue=file_queue,
                tree=tree,
                compute_sha256=compute_sha256,
                compute_phash=compute_phash
            )
            self.workers.append(processor)
    
    def start(self) -> None:
        """Start all worker threads."""
        for worker in self.workers:
            thread = threading.Thread(target=worker.run, daemon=True)
            thread.start()
            self.threads.append(thread)
    
    def wait(self) -> None:
        """Wait for all workers to complete."""
        # Send sentinel values
        for _ in range(self.num_workers):
            self.file_queue.put(None)
        
        # Wait for threads
        for thread in self.threads:
            thread.join()