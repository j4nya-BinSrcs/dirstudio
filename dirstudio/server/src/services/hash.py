"""
File hashing service for exact and perceptual hashes.
"""
import hashlib
from pathlib import Path
from typing import Optional

import config

try:
    from PIL import Image
    import imagehash
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False


def compute_sha256(path: Path) -> Optional[str]:
    """
    Compute SHA-256 hash of a file using streaming.
    
    Args:
        path: File path
    
    Returns:
        Hexadecimal SHA-256 hash or None on error
    """
    try:
        hasher = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(config.SHA256_CHUNK_SIZE), b''):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return None


def compute_phash(path: Path) -> Optional[int]:
    """
    Compute perceptual hash (pHash) for images.
    
    Args:
        path: Image file path
    
    Returns:
        Integer representation of perceptual hash or None on error
    """
    if not HAS_IMAGEHASH:
        return None
    
    try:
        with Image.open(path) as img:
            phash = imagehash.phash(img, hash_size=config.PHASH_SIZE)
            return int(str(phash), 16)
    except Exception:
        return None


def compute_dhash(path: Path) -> Optional[int]:
    """
    Compute difference hash (dHash) for images.
    
    Args:
        path: Image file path
    
    Returns:
        Integer representation of difference hash or None on error
    """
    if not HAS_IMAGEHASH:
        return None
    
    try:
        with Image.open(path) as img:
            dhash = imagehash.dhash(img, hash_size=config.PHASH_SIZE)
            return int(str(dhash), 16)
    except Exception:
        return None


def compute_ahash(path: Path) -> Optional[int]:
    """
    Compute average hash (aHash) for images.
    
    Args:
        path: Image file path
    
    Returns:
        Integer representation of average hash or None on error
    """
    if not HAS_IMAGEHASH:
        return None
    
    try:
        with Image.open(path) as img:
            ahash = imagehash.average_hash(img, hash_size=config.PHASH_SIZE)
            return int(str(ahash), 16)
    except Exception:
        return None


def hamming_distance(hash1: int, hash2: int) -> int:
    """
    Compute Hamming distance between two integer hashes.
    
    Args:
        hash1: First hash
        hash2: Second hash
    
    Returns:
        Number of differing bits
    """
    return bin(hash1 ^ hash2).count('1')