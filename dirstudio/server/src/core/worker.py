import asyncio
import logging
from pathlib import Path
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Any

from .metadata import Metadata
from .filesystem import FilesystemTree
from services.hashing import FileHasher

logger = logging.getLogger(__name__)

class TaskStatus(Enum):
    """Status of a scan task"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class ScanTask:
    """Represents a single file scanning task"""
    file_path: Path
    file_size: int
    status: TaskStatus = TaskStatus.PENDING
    error: Optional[str] = None
    
    def __hash__(self):
        return hash(str(self.file_path))

@dataclass
class WorkerStats:
    """Statistics for a single worker"""
    worker_id: int
    files_processed: int = 0
    bytes_processed: int = 0
    errors: int = 0
    start_time: datetime = field(default_factory=datetime.now)
    
    @property
    def elapsed_seconds(self) -> float:
        return (datetime.now() - self.start_time).total_seconds()
    
    @property
    def files_per_second(self) -> float:
        elapsed = self.elapsed_seconds
        return self.files_processed / elapsed if elapsed > 0 else 0.0
    
    def to_dict(self) -> dict[str, Any]:
        return {
            'worker_id': self.worker_id,
            'files_processed': self.files_processed,
            'bytes_processed': self.bytes_processed,
            'errors': self.errors,
            'elapsed_seconds': round(self.elapsed_seconds, 2),
            'files_per_second': round(self.files_per_second, 2)
        }

class Worker:
    """Individual worker that processes scan tasks and builds its own tree."""
    
    def __init__(
        self,
        worker_id: int,
        root_path: str,
        task_queue: asyncio.Queue[Optional[ScanTask]],
        hasher: Optional[FileHasher] = None,
        extract_props: bool = False
    ):
        """
        Initialize worker.
        Args:
            worker_id: Unique worker identifier
            root_path: Root directory being scanned
            task_queue: Shared task queue
            hasher: FileHasher instance (creates new if None)
            extract_props: Whether to extract expensive file properties
        """
        self.worker_id = worker_id
        self.root_path = root_path
        self.task_queue = task_queue
        self.hasher = hasher or FileHasher()
        self.extract_props = extract_props
        
        # Worker's own tree
        self.tree = FilesystemTree(root_path=root_path)
        
        # Worker statistics
        self.stats = WorkerStats(worker_id=worker_id)
        
        # Running flag
        self._running = False
    
    async def run(self) -> FilesystemTree:
        """
        Main worker loop: process tasks until stop signal.
        Returns:
            FilesystemTree built by this worker
        """
        logger.info(f"Worker {self.worker_id} starting")
        self._running = True
        self.stats.start_time = datetime.now()
        
        try:
            while self._running:
                # Get task from queue
                task = await self.task_queue.get()
                
                # Check for sentinel value (stop signal)
                if task is None:
                    self.task_queue.task_done()
                    break
                
                # Process the task
                try:
                    await self._process_task(task)
                    task.status = TaskStatus.COMPLETED
                    
                except Exception as e:
                    logger.error(f"Worker {self.worker_id} error processing {task.file_path}: {e}")
                    task.status = TaskStatus.FAILED
                    task.error = str(e)
                    self.stats.errors += 1
                
                finally:
                    self.task_queue.task_done()
                
                # Yield control to allow other tasks to run
                await asyncio.sleep(0)
        
        except Exception as e:
            logger.error(f"Worker {self.worker_id} fatal error: {e}")
            raise
        
        finally:
            self._running = False
            logger.info(
                f"Worker {self.worker_id} finished: "
                f"{self.stats.files_processed} files, "
                f"{self.stats.errors} errors, "
                f"{self.stats.elapsed_seconds:.2f}s"
            )
        
        return self.tree
    
    async def _process_task(self, task: ScanTask) -> None:
        """
        Process a single file task: extract metadata, hash, add to tree.
        
        Args:
            task: ScanTask to process
        """
        file_path = task.file_path
        task.status = TaskStatus.PROCESSING
        
        # Extract metadata (in thread pool to avoid blocking)
        metadata = await asyncio.to_thread(
            Metadata.extract,
            file_path,
            self.extract_props
        )
        
        # Hash the file
        hash_result = await self.hasher.hash_file(file_path)
        
        # Prepare hash dictionary
        hashes = {
            'algorithm': hash_result.algorithm,
            'cryptographic': hash_result.cryptographic_hash
        }
        
        # Add perceptual hashes if available (images)
        if hash_result.perceptual_hashes:
            hashes.update({
                f'perceptual_{k}': v
                for k, v in hash_result.perceptual_hashes.items()
            })
        
        # Add file to worker's tree (in thread pool)
        await asyncio.to_thread(
            self.tree.attach_file,
            str(file_path),
            metadata, 
            {} # hashes
        )
        
        # Update stats
        self.stats.files_processed += 1
        self.stats.bytes_processed += task.file_size
        
        logger.debug(
            f"Worker {self.worker_id} processed: {file_path.name} "
            # f"({task.file_size} bytes, hash: {hash_result.cryptographic_hash[:16]}...)"
        )
    
    def stop(self) -> None:
        """Signal worker to stop processing"""
        self._running = False
    
    def get_stats(self) -> WorkerStats:
        """Get current worker statistics"""
        return self.stats

class WorkerPool:
    """Manages a pool of workers for concurrent file processing."""
    
    def __init__(self, root_path: str, num_workers: int = 4, max_queue_size: int = 1000, extract_props: bool = False):
        """
        Initialize worker pool.
        Args:
            root_path: Root directory being scanned
            num_workers: Number of concurrent workers
            max_queue_size: Maximum task queue size
            extract_props: Whether to extract expensive file properties
        """
        self.root_path = root_path
        self.num_workers = num_workers
        self.extract_props = extract_props
        
        # Shared task queue
        self.task_queue: asyncio.Queue[Optional[ScanTask]] = asyncio.Queue(
            maxsize=max_queue_size
        )
        
        # Workers
        self.workers: list[Worker] = []
        self._worker_tasks: list[asyncio.Task] = []
        
        # Results
        self.worker_trees: list[FilesystemTree] = []
        self.merged_tree: Optional[FilesystemTree] = None
    
    async def start(self) -> None:
        """Start all workers"""
        logger.info(f"Starting {self.num_workers} workers")
        
        # Create workers
        for i in range(self.num_workers):
            worker = Worker(
                worker_id=i,
                root_path=self.root_path,
                task_queue=self.task_queue,
                extract_props=self.extract_props
            )
            self.workers.append(worker)
        
        # Start worker tasks
        self._worker_tasks = [
            asyncio.create_task(worker.run())
            for worker in self.workers
        ]
    
    async def add_task(self, task: ScanTask) -> None:
        """Add a task to the queue"""
        await self.task_queue.put(task)
    
    async def stop_workers(self) -> None:
        """Send stop signals to all workers"""
        logger.info("Sending stop signals to workers")
        
        # Send sentinel values
        for _ in range(self.num_workers):
            await self.task_queue.put(None)
    
    async def wait_completion(self) -> list[FilesystemTree]:
        """
        Wait for all workers to complete and collect their trees.
        Returns:
            List of FilesystemTree objects from each worker
        """
        logger.info("Waiting for workers to complete")
        
        # Wait for all workers to finish
        self.worker_trees = await asyncio.gather(*self._worker_tasks) 
        
        logger.info("All workers completed")
        return self.worker_trees
    
    async def merge_trees(self) -> FilesystemTree:
        """
        Merge all worker trees into a single tree.
        Returns:
            Merged FilesystemTree
        """
        if not self.worker_trees:
            raise ValueError("No worker trees to merge")
        
        logger.info(f"Merging {len(self.worker_trees)} worker trees")
        
        # Create base tree
        merged = FilesystemTree(root_path=self.root_path)
        
        # Merge all worker trees
        for i, worker_tree in enumerate(self.worker_trees):
            logger.debug(f"Merging tree from worker {i}")
            await asyncio.to_thread(merged.merge, worker_tree)
        
        self.merged_tree = merged
        logger.info("Tree merge complete")
        
        return merged
    
    def get_worker_stats(self) -> list[dict[str, Any]]:
        """Get statistics from all workers"""
        return [worker.get_stats().to_dict() for worker in self.workers]
    
    def get_total_stats(self) -> dict[str, Any]:
        """Get aggregated statistics across all workers"""
        total_files = sum(w.stats.files_processed for w in self.workers)
        total_bytes = sum(w.stats.bytes_processed for w in self.workers)
        total_errors = sum(w.stats.errors for w in self.workers)
        
        # Calculate average throughput
        elapsed_times = [w.stats.elapsed_seconds for w in self.workers]
        max_elapsed = max(elapsed_times) if elapsed_times else 0
        avg_throughput = total_files / max_elapsed if max_elapsed > 0 else 0
        
        return {
            'total_files': total_files,
            'total_bytes': total_bytes,
            'total_size_gb': round(total_bytes / (1024**3), 2),
            'total_errors': total_errors,
            'num_workers': self.num_workers,
            'max_elapsed_seconds': round(max_elapsed, 2),
            'avg_throughput': round(avg_throughput, 2),
            'workers': self.get_worker_stats()
        }
    
async def process_with_workers(root_path: str, tasks: list[ScanTask], num_workers: int = 4, extract_props: bool = False) -> FilesystemTree:
    """
    Process tasks using worker pool and return merged tree.
    Args:
        root_path: Root directory path
        tasks: List of ScanTask objects to process
        num_workers: Number of concurrent workers
        extract_props: Whether to extract expensive properties
    Returns:
        Merged FilesystemTree
    """
    pool = WorkerPool(root_path=root_path, num_workers=num_workers, extract_props=extract_props)
    
    # Start workers
    await pool.start()
    
    # Add all tasks
    for task in tasks:
        await pool.add_task(task)
    
    # Signal completion
    await pool.stop_workers()
    
    # Wait for completion
    await pool.wait_completion()
    
    # Merge trees
    merged_tree = await pool.merge_trees()
    
    # Log stats
    stats = pool.get_total_stats()
    logger.info(f"Processing complete: {stats}")
    
    return merged_tree
