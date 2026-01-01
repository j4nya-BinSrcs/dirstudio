import logging
from typing import Dict, List, Tuple, Optional
from collections import defaultdict

try:
    import imagehash
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False

logger = logging.getLogger(__name__)


class DuplicateDetector:
    """
    Detects duplicate and similar files using hash comparisons.
    Works with FilesystemTree and FileNode objects.
    """
    
    def __init__(self):
        """Initialize duplicate detector."""
        self._exact_duplicates_cache: Optional[Dict[str, List[str]]] = None
        self._similar_images_cache: Optional[List[Tuple[str, str, int]]] = None
    
    def find_exact_duplicates(
        self,
        file_nodes: list,
        min_group_size: int = 2
    ) -> Dict[str, List[str]]:
        """
        Find exact duplicate files based on cryptographic hash.
        
        Args:
            file_nodes: List of FileNode objects with hashes
            min_group_size: Minimum number of files to be considered a duplicate group
            
        Returns:
            Dictionary mapping hash to list of duplicate file paths
        """
        logger.info(f"Finding exact duplicates among {len(file_nodes)} files")
        
        # Group files by cryptographic hash
        hash_groups: Dict[str, List[str]] = defaultdict(list)
        
        for node in file_nodes:
            # Get cryptographic hash from node
            crypto_hash = node.hashes.get('cryptographic')
            if not crypto_hash:
                continue
            
            hash_groups[crypto_hash].append(node.path)
        
        # Filter to only groups with duplicates (min_group_size+ files)
        duplicates = {
            h: paths for h, paths in hash_groups.items()
            if len(paths) >= min_group_size
        }
        
        # Cache results
        self._exact_duplicates_cache = duplicates
        
        total_duplicates = sum(len(paths) for paths in duplicates.values())
        logger.info(
            f"Found {len(duplicates)} duplicate groups "
            f"({total_duplicates} total duplicate files)"
        )
        
        return duplicates
    
    def find_similar_images(
        self,
        file_nodes: list,
        threshold: int = 10,
        hash_type: str = 'phash'
    ) -> List[Tuple[str, str, int]]:
        """
        Find similar images using perceptual hash comparison.
        
        Args:
            file_nodes: List of FileNode objects with perceptual hashes
            threshold: Maximum Hamming distance for similarity (0-64)
                      Lower = more strict (default: 10)
            hash_type: Type of perceptual hash to use (phash, dhash, ahash, whash)
            
        Returns:
            List of tuples: (path1, path2, distance)
        """
        if not HAS_IMAGEHASH:
            logger.error("imagehash library required for image similarity")
            return []
        
        logger.info(f"Finding similar images among {len(file_nodes)} files")
        
        # Extract images with perceptual hashes
        image_hashes: List[Tuple[str, str]] = []
        phash_key = f'perceptual_{hash_type}'
        
        for node in file_nodes:
            if phash_key in node.hashes:
                image_hashes.append((node.path, node.hashes[phash_key]))
        
        if len(image_hashes) < 2:
            logger.warning(f"Not enough images with {hash_type} hashes")
            return []
        
        logger.info(f"Comparing {len(image_hashes)} images...")
        
        # Compare all pairs
        similar_pairs: List[Tuple[str, str, int]] = []
        
        for i, (path1, hash1) in enumerate(image_hashes):
            for path2, hash2 in image_hashes[i+1:]:
                try:
                    distance = self._hamming_distance(hash1, hash2)
                    if distance <= threshold:
                        similar_pairs.append((path1, path2, distance))
                except Exception as e:
                    logger.debug(f"Error comparing {path1} and {path2}: {e}")
        
        # Sort by distance (most similar first)
        similar_pairs.sort(key=lambda x: x[2])
        
        # Cache results
        self._similar_images_cache = similar_pairs
        
        logger.info(f"Found {len(similar_pairs)} similar image pairs")
        return similar_pairs
    
    def find_duplicate_by_size(
        self,
        file_nodes: list,
        min_size: int = 0
    ) -> Dict[int, List[str]]:
        """
        Group files by size (potential duplicates).
        Useful as a fast pre-filter before hash comparison.
        
        Args:
            file_nodes: List of FileNode objects
            min_size: Minimum file size to consider (skip empty files)
            
        Returns:
            Dictionary mapping file size to list of file paths
        """
        logger.info("Grouping files by size...")
        
        size_groups: Dict[int, List[str]] = defaultdict(list)
        
        for node in file_nodes:
            if node.size >= min_size:
                size_groups[node.size].append(node.path)
        
        # Filter to only groups with 2+ files
        potential_duplicates = {
            size: paths for size, paths in size_groups.items()
            if len(paths) >= 2
        }
        
        logger.info(f"Found {len(potential_duplicates)} size groups with potential duplicates")
        return potential_duplicates
    
    def get_duplicate_statistics(
        self,
        exact_duplicates: Dict[str, List[str]],
        file_nodes: list
    ) -> Dict[str, any]: # type: ignore
        """
        Calculate statistics about duplicate files.
        
        Args:
            exact_duplicates: Result from find_exact_duplicates()
            file_nodes: Original list of FileNode objects
            
        Returns:
            Dictionary with duplicate statistics
        """
        # Build path to node map
        path_map = {node.path: node for node in file_nodes}
        
        total_duplicate_files = 0
        wasted_space = 0
        groups_by_size = defaultdict(int)
        
        for hash_val, paths in exact_duplicates.items():
            group_size = len(paths)
            total_duplicate_files += group_size
            
            # Calculate wasted space (all but one file)
            if paths[0] in path_map:
                file_size = path_map[paths[0]].size
                wasted_space += file_size * (group_size - 1)
            
            groups_by_size[group_size] += 1
        
        return {
            'total_duplicate_groups': len(exact_duplicates),
            'total_duplicate_files': total_duplicate_files,
            'wasted_space_bytes': wasted_space,
            'wasted_space_gb': round(wasted_space / (1024**3), 2),
            'groups_by_size': dict(groups_by_size),
            'largest_group': max(groups_by_size.keys()) if groups_by_size else 0
        }
    
    @staticmethod
    def _hamming_distance(hash1: str, hash2: str) -> int:
        """Calculate Hamming distance between two perceptual hashes."""
        if not HAS_IMAGEHASH:
            raise RuntimeError("imagehash library not available")
        
        h1 = imagehash.hex_to_hash(hash1)  # type: ignore
        h2 = imagehash.hex_to_hash(hash2)  # type: ignore
        return h1 - h2
    
    def clear_cache(self) -> None:
        """Clear cached results"""
        self._exact_duplicates_cache = None
        self._similar_images_cache = None


# ============================================================
# Convenience Functions
# ============================================================

def find_duplicates_in_tree(tree, min_group_size: int = 2) -> Dict[str, List[str]]:
    """
    Find exact duplicates in a FilesystemTree.
    
    Args:
        tree: FilesystemTree instance
        min_group_size: Minimum files to be considered a duplicate group
        
    Returns:
        Dictionary of duplicate groups
    """
    detector = DuplicateDetector()
    file_nodes = list(tree.traverse())
    return detector.find_exact_duplicates(file_nodes, min_group_size)
