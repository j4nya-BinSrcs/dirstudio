"""
Filesystem tree data structures.
Preserved design from original with performance optimizations.
"""
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

from .metadata import Metadata


@dataclass
class FileNode:
    """Represents a file in the filesystem tree."""
    path: Path
    metadata: Metadata
    hashes: dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "metadata": self.metadata.to_dict(),
            "hashes": dict(self.hashes),
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FileNode":
        return cls(
            path=Path(data["path"]),
            metadata=Metadata.from_dict(data["metadata"]),
            hashes=dict(data.get("hashes", {})),
        )
    
    @property
    def size(self) -> int:
        return self.metadata.size
    
    @property
    def name(self) -> str:
        return self.path.name


@dataclass
class DirNode:
    """Represents a directory in the filesystem tree."""
    path: Path
    metadata: Metadata
    files: list[FileNode] = field(default_factory=list)
    subdirs: list["DirNode"] = field(default_factory=list)
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "metadata": self.metadata.to_dict(),
            "files": [file.to_dict() for file in self.files],
            "subdirs": [subdir.to_dict() for subdir in self.subdirs],
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DirNode":
        return cls(
            path=Path(data["path"]),
            metadata=Metadata.from_dict(data["metadata"]),
            files=[FileNode.from_dict(f) for f in data.get("files", [])],
            subdirs=[cls.from_dict(d) for d in data.get("subdirs", [])],
        )
    
    @property
    def size(self) -> int:
        files_size = sum(file.size for file in self.files)
        subdirs_size = sum(subdir.size for subdir in self.subdirs)
        return files_size + subdirs_size
    
    @property
    def name(self) -> str:
        return self.path.name


class FilesystemTree:
    """Container for filesystem tree with efficient operations."""
    
    def __init__(self, root: Path) -> None:
        self.root = DirNode(root, Metadata.extract(root))
    
    def _normalize(self, path: Path) -> Path:
        """Convert to absolute path."""
        return path if path.is_absolute() else self.root.path / path
    
    def _ensure_parents(self, target: Path) -> DirNode:
        """
        Ensure all parent directories exist for a target path.
        Creates missing directories as needed.
        """
        target = self._normalize(target)
        parent = target.parent
        
        # Validate path is under root
        try:
            parent.relative_to(self.root.path)
        except ValueError:
            raise ValueError(f"Path {target} is not under root {self.root.path}")
        
        # Build chain from root to target
        try:
            rel_parts = parent.relative_to(self.root.path).parts
        except ValueError:
            return self.root
        
        curr = self.root
        curr_path = self.root.path
        
        for part in rel_parts:
            curr_path = curr_path / part
            
            # Find or create subdir
            existing = next((d for d in curr.subdirs if d.path == curr_path), None)
            
            if existing:
                curr = existing
            else:
                new_dir = DirNode(curr_path, Metadata.extract(curr_path))
                curr.subdirs.append(new_dir)
                curr = new_dir
        
        return curr
    
    def attach_file(self, path: Path, metadata: Metadata, hashes: dict[str, str]) -> FileNode:
        """
        Add a file to the tree. Automatically creates parent directories.
        """
        path = self._normalize(path)
        
        if path.is_dir():
            raise ValueError(f"Cannot attach directory as file: {path}")
        
        file_node = FileNode(path=path, metadata=metadata, hashes=hashes)
        parent = self._ensure_parents(path)
        
        # Replace if exists, otherwise append
        for i, f in enumerate(parent.files):
            if f.path == path:
                parent.files[i] = file_node
                return file_node
        
        parent.files.append(file_node)
        return file_node
    
    def merge(self, other: "FilesystemTree") -> None:
        """Merge another tree into this one."""
        if not other.root:
            return
        
        if not self.root:
            self.root = DirNode.from_dict(other.root.to_dict())
            return
        
        if self.root.path != other.root.path:
            raise ValueError(f"Cannot merge trees with different roots")
        
        self._merge_dirs(self.root, other.root)
    
    def _merge_dirs(self, target: DirNode, source: DirNode) -> None:
        """Recursively merge source directory into target."""
        # Merge files
        existing = {f.path: i for i, f in enumerate(target.files)}
        for src_file in source.files:
            if src_file.path in existing:
                target.files[existing[src_file.path]] = src_file
            else:
                target.files.append(src_file)
        
        # Merge directories
        existing_dirs = {d.path: d for d in target.subdirs}
        for src_dir in source.subdirs:
            if src_dir.path in existing_dirs:
                self._merge_dirs(existing_dirs[src_dir.path], src_dir)
            else:
                target.subdirs.append(src_dir)
    
    def query_dir(self, path: Path) -> Optional[DirNode]:
        """Find a directory node by path using BFS."""
        if not self.root:
            return None
        
        path = self._normalize(path)
        
        if path == self.root.path:
            return self.root
        
        queue = deque([self.root])
        while queue:
            node = queue.popleft()
            if node.path == path:
                return node
            queue.extend(node.subdirs)
        
        return None
    
    def traverse(
        self,
        filter_fn: Optional[Callable[[FileNode], bool]] = None,
        start_path: Optional[Path] = None
    ) -> Iterator[FileNode]:
        """
        Traverse all files in the tree with optional filtering.
        """
        start = self.root
        if start_path:
            start = self.query_dir(start_path)
        
        if not start:
            return
        
        queue = deque([start])
        while queue:
            node = queue.popleft()
            
            for file in node.files:
                if not filter_fn or filter_fn(file):
                    yield file
            
            queue.extend(node.subdirs)
    
    def compute_stats(self) -> dict[str, Any]:
        """Compute comprehensive tree statistics."""
        stats = {
            'total_files': 0,
            'total_dirs': 0,
            'total_size': 0,
            'file_types': defaultdict(int),
            'extensions': defaultdict(int),
            'depth': 0
        }
        
        if not self.root:
            return stats
        
        queue = deque([(self.root, 0)])
        while queue:
            node, depth = queue.popleft()
            stats['total_dirs'] += 1
            stats['depth'] = max(stats['depth'], depth)
            
            for file_node in node.files:
                stats['total_files'] += 1
                stats['total_size'] += file_node.size
                stats['file_types'][file_node.metadata.filetype.value] += 1
                
                ext = file_node.path.suffix.lower()
                if ext:
                    stats['extensions'][ext] += 1
            
            for subdir in node.subdirs:
                queue.append((subdir, depth + 1))
        
        stats['file_types'] = dict(stats['file_types'])
        stats['extensions'] = dict(stats['extensions'])
        
        return stats
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize the entire tree to a dictionary."""
        return {
            "root": self.root.to_dict(),
            "stats": self.compute_stats(),
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FilesystemTree":
        """Deserialize a tree from a dictionary."""
        if "root" not in data:
            raise KeyError("Missing required field: 'root'")
        
        root_node = DirNode.from_dict(data["root"])
        
        tree = cls.__new__(cls)
        tree.root = root_node
        
        return tree
    
    def __len__(self) -> int:
        return sum(1 for _ in self.traverse())
    
    def __repr__(self) -> str:
        if not self.root:
            return f"FilesystemTree(root='{self.root.path}', empty=True)"
        
        stats = self.compute_stats()
        size_gb = stats['total_size'] / (1024**3)
        
        return (
            f"FilesystemTree(root='{self.root.path}', "
            f"files={stats['total_files']}, "
            f"dirs={stats['total_dirs']}, "
            f"size={size_gb:.2f}GB, "
            f"depth={stats['depth']})"
        )