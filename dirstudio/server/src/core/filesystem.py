from collections import defaultdict, deque
import json
from pathlib import Path
from dataclasses import dataclass, field
import pickle
from typing import Any, Callable, Iterator, Optional

from .metadata import MetaTag, MetaTime, Metadata

@dataclass
class FileNode:
    """Represents a file in the filesystem tree."""
    path: str
    metadata: Metadata
    hashes: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "metadata": self.metadata.to_dict(),
            "hashes": dict(self.hashes),
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FileNode":
        return cls(
            path=data["path"],
            metadata=Metadata.from_dict(data["metadata"]),
            hashes=dict(data.get("hashes", {})),
        )

    @property
    def size(self) -> int:
        return self.metadata.size
    
    @property
    def name(self) -> str:
        return Path(self.path).name

@dataclass
class DirNode:
    """Represents a directory in the filesystem tree."""
    path: str
    metadata: Metadata
    files: list[FileNode] = field(default_factory=list)
    subdirs: list["DirNode"] = field(default_factory=list)
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "metadata": self.metadata.to_dict(),
            "files": [file.to_dict() for file in self.files],
            "subdirs": [subdir.to_dict() for subdir in self.subdirs],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DirNode":
        return cls(
            path=data["path"],
            metadata=Metadata.from_dict(data["metadata"]),
            files=[
                FileNode.from_dict(f)
                for f in data.get("files", [])
            ],
            subdirs=[
                cls.from_dict(d)
                for d in data.get("subdirs", [])
            ],
        )

    @property
    def size(self) -> int:
        files_size = sum(file.size for file in self.files)
        subdirs_size = sum(subdir.size for subdir in self.subdirs)
        return files_size + subdirs_size

    @property
    def name(self) -> str:
        return Path(self.path).name

class FilesystemTree:
    
    def __init__(self, root_path: str):
        self.root_path = root_path
        self.root: Optional[DirNode] = None 
        self._path_index: dict[str, DirNode] = {}
        self._stats_cache: Optional[dict[str, Any]] = None

    def _chain_path(self, file_path: str) -> DirNode:
        """
        Ensure all parent directories exist for a file path.
        Creates missing directories as needed.
        Args:
            file_path: Full path to a file 
        Returns:
            Parent DirNode for the file
        """
        file_path = str(Path(file_path).resolve())
        parent_path = str(Path(file_path).parent)

        # Check if parent already exists
        if parent_path in self._path_index:
            return self._path_index[parent_path]
        
        # Build chain of parents from root to target
        path_parts = Path(parent_path).parts
        current_path = ""
        current_node = None

        for i, part in enumerate(path_parts):
            current_path = str(Path(current_path) / part) if i else part # curr_path = path if i == 0 ('/' or 'C:\')

            if current_path in self._path_index:
                current_node = self._path_index[current_path]
                continue

            # Create missing directory node
            try:
                metadata = Metadata.extract(current_path)
            except (FileNotFoundError, PermissionError):
                # Create minimal dummy metadata for inaccessible dirs
                metadata = Metadata(
                    path=Path(current_path),
                    size=0,
                    tags=[MetaTag.DIRECTORY],
                    times={MetaTime.CREATED: "unknown", 
                           MetaTime.ACCESSED: "unknown",
                           MetaTime.MODIFIED: "unknown"},
                    ino=0,
                    owner="unknown",
                    permissions="unknown",
                    properties={},
                    mime=None
                )

            new_node = DirNode(path=current_path, metadata=metadata)
            self._path_index[current_path] = new_node
            
            # Link to parent or set as root
            if current_node:
                current_node.subdirs.append(new_node)
            else:
                self.root = new_node
                self.root_path = current_path
            
            current_node = new_node
        
        return current_node # type: ignore

    def attach_file(self,  path: str, metadata: Metadata, hashes: dict[str, str]) -> FileNode:
        """
        Add a file to the tree. Automatically creates parent directories.
        Args:
            path: File path
            metadata: File metadata
            filetype: File type classification 
        Returns:
            Created FileNode
        """
        path = str(Path(path).resolve())
        file_node = FileNode(path=path, metadata=metadata, hashes=hashes)
        
        # Ensure parent directory chain exists
        parent = self._chain_path(path)
        parent.files.append(file_node)
        
        self._stats_cache = None  # Invalidate cache
        return file_node

    def merge(self, other: "FilesystemTree") -> None:
        """
        Merge another tree into this one.
        Handles duplicates by keeping existing nodes.
        Args:
            other: Another FilesystemTree to merge
        """
        if not other.root:
            return
        
        if not self.root:
            self.root = other.root
            self.root_path = other.root_path
            self._rebuild_index()
            return
        
        # Merge recursively
        self._merge_dirs(self.root, other.root)
        self._rebuild_index()
        self._stats_cache = None

    def _merge_dirs(self, target: DirNode, source: DirNode) -> None:
        """Recursively merge source directory into target."""
        # Merge files (avoid duplicates by path)
        existing_paths = {f.path for f in target.files}
        for file_node in source.files:
            if file_node.path not in existing_paths:
                target.files.append(file_node)
        
        # Merge subdirectories
        existing_subdirs = {d.path: d for d in target.subdirs}
        for source_subdir in source.subdirs:
            if source_subdir.path in existing_subdirs:
                self._merge_dirs(existing_subdirs[source_subdir.path], source_subdir)
            else:
                target.subdirs.append(source_subdir)

    def _rebuild_index(self): 
        """Rebuild directory index after merging."""
        if not self.root:
            return
        
        self._path_index.clear()
        queue = deque([self.root])
        
        while queue:
            node = queue.popleft()
            self._path_index[node.path] = node
            queue.extend(node.subdirs)

    def traverse(self, filter_fn: Optional[Callable[[FileNode], bool]] = None,
                 start_path: Optional[str] = None) -> Iterator[FileNode]:
        """
        Traverse all files in the tree with optional filtering.
        Args:
            filter_fn: Optional filter function for files
            start_path: Starting directory path (defaults to root)
        Yields:
            FileNode instances
        """
        start_node = self.root
        if start_path and start_path in self._path_index:
            start_node = self._path_index[start_path]
        
        if not start_node:
            return
        
        # BFS traversal
        queue = deque([start_node])
        while queue:
            node = queue.popleft()
            
            for file_node in node.files:
                if filter_fn is None or filter_fn(file_node):
                    yield file_node
            
            queue.extend(node.subdirs)

    def compute_stats(self, use_cache: bool = True) -> dict[str, Any]:
        """
        Compute tree statistics with optional caching.
        Args:
            use_cache: Use cached stats if available 
        Returns:
            dictionary with comprehensive statistics
        """
        if use_cache and self._stats_cache:
            return self._stats_cache.copy()
        
        if not self.root:
            return {
                'total_files': 0,
                'total_dirs': 0,
                'total_size': 0,
                'file_types': {},
                'extensions': {}
            }
        
        stats = {
            'total_files': 0,
            'total_dirs': 0,
            'total_size': 0,
            'file_types': defaultdict(int),
            'extensions': defaultdict(int)
        }
        
        # Count directories
        queue = deque([self.root])
        while queue:
            node = queue.popleft()
            stats['total_dirs'] += 1
            queue.extend(node.subdirs)
        
        # Count files and gather stats
        for file_node in self.traverse():
            stats['total_files'] += 1
            stats['total_size'] += file_node.size
            stats['file_types'][file_node.metadata.filetype.value] += 1
            
            ext = Path(file_node.path).suffix.lower()
            if ext:
                stats['extensions'][ext] += 1
        
        stats['file_types'] = dict(stats['file_types'])
        stats['extensions'] = dict(stats['extensions'])
        
        self._stats_cache = stats
        return stats.copy()

    def to_json(self, filepath: str, indent: int = 2) -> None:
        """Save tree to JSON file."""
        if not self.root:
            raise ValueError("Cannot serialize empty tree")
        
        data = {
            'root_path': self.root_path,
            'root': self.root.to_dict(),
            'stats': self.compute_stats()
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=indent)
    
    @classmethod
    def from_json(cls, filepath: str) -> "FilesystemTree":
        """Load tree from JSON file."""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        tree = cls(root_path=data['root_path'])
        tree.root = DirNode.from_dict(data['root'])
        tree._rebuild_index()
        return tree
    
    def to_pickle(self, filepath: str) -> None:
        """Save tree to pickle file (faster, binary)."""
        if not self.root:
            raise ValueError("Cannot serialize empty tree")
        
        with open(filepath, 'wb') as f:
            pickle.dump({'root_path': self.root_path, 'root': self.root}, f)
    
    @classmethod
    def from_pickle(cls, filepath: str) -> "FilesystemTree":
        """Load tree from pickle file."""
        with open(filepath, 'rb') as f:
            data = pickle.load(f)
        
        tree = cls(root_path=data['root_path'])
        tree.root = data['root']
        tree._rebuild_index()
        return tree

    def __len__(self) -> int:
        """Return total number of files."""
        return sum(1 for _ in self.traverse())
    
    def __repr__(self) -> str:
        """String representation."""
        stats = self.compute_stats()
        size_gb = stats['total_size'] / (1024**3)  # type: ignore
        return (f"FilesystemTree(root={self.root_path}, "
                f"files={stats['total_files']}, " # type: ignore
                f"dirs={stats['total_dirs']}, " # type: ignore
                f"size={size_gb:.2f}GB)")
    