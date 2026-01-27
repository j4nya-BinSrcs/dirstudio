"""
Duplicate and near-duplicate detection service.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import config
from core.filesystem import FileNode
from .hash import hamming_distance


@dataclass
class DuplicateGroup:
    """Group of duplicate or similar files."""
    
    group_id: str
    files: list[FileNode] = field(default_factory=list)
    duplicate_type: str = "exact"  # exact, near, similar
    total_size: int = 0
    wastage: int = 0
    representative: Optional[FileNode] = None
    
    def add_file(self, file_node: FileNode) -> None:
        """Add file to group and update stats."""
        self.files.append(file_node)
        self.total_size += file_node.size
        
        if len(self.files) > 1:
            self.wastage = self.total_size - min(f.size for f in self.files)
    
    def set_representative(self) -> None:
        """Set representative file (most recent)."""
        if not self.files:
            return
        
        # Use most recently modified
        self.representative = max(
            self.files,
            key=lambda f: f.metadata.time.get('MODIFIED', '')
        )
    
    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'group_id': self.group_id,
            'duplicate_type': self.duplicate_type,
            'file_count': len(self.files),
            'total_size': self.total_size,
            'wastage': self.wastage,
            'representative': {
                'path': str(self.representative.path),
                'name': self.representative.name
            } if self.representative else None,
            'files': [{'path': str(f.path), 'name': f.name} for f in self.files]
        }


class DuplicateDetector:
    """
    Detects exact and near-duplicate files using hashes.
    """
    
    def __init__(self):
        self.exact_duplicates: dict[str, DuplicateGroup] = {}
        self.near_duplicates: dict[str, DuplicateGroup] = {}
        
        # Indexes for fast lookup
        self._sha256_index: dict[str, list[FileNode]] = defaultdict(list)
        self._phash_index: dict[int, list[FileNode]] = defaultdict(list)
    
    def add_file(self, file_node: FileNode) -> None:
        """Add a file to detection indexes."""
        # Index by SHA-256
        sha256 = file_node.hashes.get('sha256')
        if sha256:
            self._sha256_index[sha256].append(file_node)
        
        # Index by phash
        phash_str = file_node.hashes.get('phash')
        if phash_str:
            phash = int(phash_str)
            self._phash_index[phash].append(file_node)
    
    def detect_exact_duplicates(self) -> dict[str, DuplicateGroup]:
        """
        Detect exact duplicate files using SHA-256.
        
        Returns:
            Dictionary of duplicate groups by hash
        """
        self.exact_duplicates.clear()
        
        for sha256, files in self._sha256_index.items():
            if len(files) > 1:
                group = DuplicateGroup(
                    group_id=f"exact_{sha256[:16]}",
                    duplicate_type="exact"
                )
                
                for file_node in files:
                    group.add_file(file_node)
                
                group.set_representative()
                self.exact_duplicates[group.group_id] = group
        
        return self.exact_duplicates
    
    def detect_near_duplicates(
        self,
        threshold: Optional[int] = None
    ) -> dict[str, DuplicateGroup]:
        """
        Detect near-duplicate images using perceptual hashing.
        
        Args:
            threshold: Hamming distance threshold
        
        Returns:
            Dictionary of near-duplicate groups
        """
        if threshold is None:
            threshold = config.PHASH_DUPLICATE_THRESHOLD
        
        self.near_duplicates.clear()
        
        phashes = list(self._phash_index.keys())
        visited = set()
        group_counter = 0
        
        for i, phash1 in enumerate(phashes):
            if phash1 in visited:
                continue
            
            # Find similar phashes
            similar = [phash1]
            
            for phash2 in phashes[i+1:]:
                if phash2 in visited:
                    continue
                
                if hamming_distance(phash1, phash2) <= threshold:
                    similar.append(phash2)
                    visited.add(phash2)
            
            # Create group if duplicates found
            if len(similar) > 1:
                visited.add(phash1)
                group = DuplicateGroup(
                    group_id=f"near_{group_counter}",
                    duplicate_type="near"
                )
                
                for phash in similar:
                    for file_node in self._phash_index[phash]:
                        group.add_file(file_node)
                
                group.set_representative()
                self.near_duplicates[group.group_id] = group
                group_counter += 1
        
        return self.near_duplicates
    
    def get_statistics(self) -> dict:
        """Get duplicate detection statistics."""
        total_exact = sum(len(g.files) for g in self.exact_duplicates.values())
        total_near = sum(len(g.files) for g in self.near_duplicates.values())
        total_wastage = sum(
            g.wastage 
            for g in list(self.exact_duplicates.values()) + list(self.near_duplicates.values())
        )
        
        return {
            'exact_duplicate_groups': len(self.exact_duplicates),
            'exact_duplicate_files': total_exact,
            'near_duplicate_groups': len(self.near_duplicates),
            'near_duplicate_files': total_near,
            'total_wastage_bytes': total_wastage,
            'potential_savings_mb': total_wastage / (1024 * 1024)
        }


class BKTree:
    """
    Burkhard-Keller tree for efficient similarity search.
    Used for fast perceptual hash matching.
    """
    
    class Node:
        def __init__(self, value: int, file_node: FileNode):
            self.value = value
            self.file_node = file_node
            self.children: dict[int, 'BKTree.Node'] = {}
    
    def __init__(self):
        self.root: Optional[BKTree.Node] = None
    
    def add(self, phash: int, file_node: FileNode) -> None:
        """Add a phash to the tree."""
        if self.root is None:
            self.root = self.Node(phash, file_node)
            return
        
        current = self.root
        while True:
            distance = hamming_distance(phash, current.value)
            
            if distance in current.children:
                current = current.children[distance]
            else:
                current.children[distance] = self.Node(phash, file_node)
                break
    
    def search(self, phash: int, threshold: int) -> list[tuple[FileNode, int]]:
        """
        Find all items within threshold distance.
        
        Args:
            phash: Query perceptual hash
            threshold: Maximum Hamming distance
        
        Returns:
            List of (file_node, distance) tuples
        """
        if self.root is None:
            return []
        
        results = []
        self._search_recursive(self.root, phash, threshold, results)
        return results
    
    def _search_recursive(
        self,
        node: Node,
        target: int,
        threshold: int,
        results: list
    ) -> None:
        """Recursive search helper."""
        distance = hamming_distance(target, node.value)
        
        if distance <= threshold:
            results.append((node.file_node, distance))
        
        # Search children within valid range
        min_dist = max(0, distance - threshold)
        max_dist = distance + threshold
        
        for edge_dist, child in node.children.items():
            if min_dist <= edge_dist <= max_dist:
                self._search_recursive(child, target, threshold, results)