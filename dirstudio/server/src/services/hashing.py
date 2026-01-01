import asyncio
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
import logging

# Optional imports for perceptual hashing
try:
    import imagehash
    from PIL import Image
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False

logger = logging.getLogger(__name__)


class HashAlgorithm(Enum):
    """Supported hash algorithms"""
    SHA256 = "sha256"
    SHA1 = "sha1"
    MD5 = "md5"
    BLAKE2B = "blake2b"


@dataclass
class HashResult:
    """Container for file hash results"""
    file_path: str
    cryptographic_hash: str
    algorithm: str
    file_size: int
    perceptual_hashes: Optional[Dict[str, str]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize hash result"""
        return {
            'file_path': self.file_path,
            'cryptographic_hash': self.cryptographic_hash,
            'algorithm': self.algorithm,
            'file_size': self.file_size,
            'perceptual_hashes': self.perceptual_hashes
        }


class FileHasher:
    """
    File hashing service supporting cryptographic and perceptual hashing.
    Optimized for async operation.
    """
    
    # Optimal chunk size for reading files (64KB for better I/O performance)
    CHUNK_SIZE = 65536
    
    # Image extensions for perceptual hashing
    IMAGE_EXTENSIONS = {
        '.jpg', '.jpeg', '.png', '.gif', '.bmp',
        '.tiff', '.tif', '.webp', '.ico'
    }
    
    def __init__(
        self,
        algorithm: HashAlgorithm = HashAlgorithm.SHA256,
        compute_perceptual: bool = True
    ):
        """
        Initialize file hasher.
        
        Args:
            algorithm: Cryptographic hash algorithm to use
            compute_perceptual: Whether to compute perceptual hashes for images
        """
        self.algorithm = algorithm
        self.compute_perceptual = compute_perceptual and HAS_IMAGEHASH
        
        if compute_perceptual and not HAS_IMAGEHASH:
            logger.warning(
                "imagehash/Pillow not available, perceptual hashing disabled. "
                "Install with: pip install imagehash pillow"
            )
    
    async def hash_file(
        self,
        file_path: Path | str,
        algorithm: Optional[HashAlgorithm] = None
    ) -> HashResult:
        """
        Compute hash for a file.
        
        Args:
            file_path: Path to file
            algorithm: Override default algorithm
            
        Returns:
            HashResult with computed hashes
            
        Raises:
            FileNotFoundError: If file doesn't exist
            PermissionError: If file is not readable
        """
        file_path = Path(file_path) if isinstance(file_path, str) else file_path
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not file_path.is_file():
            raise ValueError(f"Not a file: {file_path}")
        
        algo = algorithm or self.algorithm
        file_size = file_path.stat().st_size
        
        # Compute cryptographic hash (always async)
        crypto_hash = await self._compute_cryptographic_hash(file_path, algo)
        
        # Compute perceptual hashes for images
        perceptual_hashes = None
        if self.compute_perceptual and self._is_image(file_path):
            try:
                perceptual_hashes = await self._compute_perceptual_hashes(file_path)
            except Exception as e:
                logger.debug(f"Could not compute perceptual hash for {file_path}: {e}")
        
        return HashResult(
            file_path=str(file_path),
            cryptographic_hash=crypto_hash,
            algorithm=algo.value,
            file_size=file_size,
            perceptual_hashes=perceptual_hashes
        )
    
    async def _compute_cryptographic_hash(
        self,
        file_path: Path,
        algorithm: HashAlgorithm
    ) -> str:
        """
        Compute cryptographic hash using streaming reads.
        
        Args:
            file_path: Path to file
            algorithm: Hash algorithm to use
            
        Returns:
            Hex digest of file hash
        """
        def _hash():
            hasher = hashlib.new(algorithm.value)
            with open(file_path, 'rb') as f:
                while chunk := f.read(self.CHUNK_SIZE):
                    hasher.update(chunk)
            return hasher.hexdigest()
        
        return await asyncio.to_thread(_hash)
    
    def _is_image(self, file_path: Path) -> bool:
        """Check if file is an image based on extension"""
        return file_path.suffix.lower() in self.IMAGE_EXTENSIONS
    
    async def _compute_perceptual_hashes(
        self,
        file_path: Path
    ) -> Dict[str, str]:
        """
        Compute perceptual hashes for an image.
        
        Args:
            file_path: Path to image file
            
        Returns:
            Dictionary mapping hash type to hash value
        """
        if not HAS_IMAGEHASH:
            return {}
        
        def _compute():
            try:
                with Image.open(file_path) as img: # type: ignore
                    # Compute multiple perceptual hashes
                    hashes = {
                        'phash': str(imagehash.phash(img)), # type: ignore
                        'dhash': str(imagehash.dhash(img)), # type: ignore
                        'ahash': str(imagehash.average_hash(img)), # type: ignore
                        'whash': str(imagehash.whash(img)) # type: ignore
                    }
                    return hashes
                    
            except Exception as e:
                logger.debug(f"Error computing perceptual hashes: {e}")
                return {}
        
        return await asyncio.to_thread(_compute)
    
    async def hash_multiple_files(
        self,
        file_paths: list[Path | str],
        max_concurrent: int = 10
    ) -> list[HashResult]:
        """
        Hash multiple files concurrently with concurrency limit.
        
        Args:
            file_paths: List of file paths to hash
            max_concurrent: Maximum concurrent hash operations
            
        Returns:
            List of HashResult objects
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def hash_with_semaphore(path):
            async with semaphore:
                return await self.hash_file(path)
        
        tasks = [hash_with_semaphore(path) for path in file_paths]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out exceptions and return successful results
        return [r for r in results if isinstance(r, HashResult)]
    
    @staticmethod
    def compare_hashes(hash1: str, hash2: str) -> bool:
        """
        Compare two cryptographic hashes for equality.
        
        Args:
            hash1: First hash
            hash2: Second hash
            
        Returns:
            True if hashes match (files are identical)
        """
        return hash1.lower() == hash2.lower()
    
    @staticmethod
    def hamming_distance(hash1: str, hash2: str) -> int:
        """
        Calculate Hamming distance between two perceptual hashes.
        
        Args:
            hash1: First perceptual hash (hex string)
            hash2: Second perceptual hash (hex string)
            
        Returns:
            Number of differing bits
            
        Raises:
            RuntimeError: If imagehash not available
        """
        if not HAS_IMAGEHASH:
            raise RuntimeError("imagehash library not available")
        
        # Convert hex strings to imagehash objects
        h1 = imagehash.hex_to_hash(hash1) # type: ignore
        h2 = imagehash.hex_to_hash(hash2) # type: ignore
        
        return h1 - h2  # imagehash overloads subtraction


# ============================================================
# Convenience Functions
# ============================================================

async def quick_hash(file_path: str | Path) -> str:
    """
    Quick hash of a file using SHA-256.
    
    Args:
        file_path: Path to file
        
    Returns:
        SHA-256 hex digest
    """
    hasher = FileHasher(algorithm=HashAlgorithm.SHA256)
    result = await hasher.hash_file(file_path)
    return result.cryptographic_hash
