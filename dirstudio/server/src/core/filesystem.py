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

    def __init__(self, root: Path) -> None:
        self.root: DirNode = DirNode(root, Metadata.extract(root))

    def _normalize_path(self, path: Path) -> Path:
        return path if path.is_absolute() else self.root.path / path

    def _chain_path(self, target_path: Path) -> DirNode:
        """
        Ensure all parent directories exist for a file path.
        Creates missing directories as needed.
        Args:
            file_path: Full path to a file 
        Returns:
            Parent DirNode for the file 
        Raises:
            ValueError: If file_path is not under root_path
        """
        file_path = self._normalize_path(target_path)
        parent_path = file_path.parent

        # validate path is under root
        try:
            parent_path.relative_to(self.root.path)
        except ValueError:
            raise ValueError(
                f"Path {file_path} is not under root {self.root.path}"
            ) from None
        
        # build chain from roo to target
        try:
            rel_parts = parent_path.relative_to(self.root.path).parts
        except ValueError:
            return self.root
        
        curr_node = self.root
        curr_path = self.root.path
        for part in rel_parts:
            curr_path = curr_path / part

            # find or create subdirs
            existing = next((dir for dir in curr_node.subdirs if dir.path == curr_path), None)

            if existing:
                curr_node = existing
            else:
                new_node = DirNode(curr_path, Metadata.extract(curr_path))
                curr_node.subdirs.append(new_node)
                curr_node = new_node

        return curr_node

    def attach_file(self, path: Path, metadata: Metadata, hashes: dict[str, str]) -> FileNode:
        """
        Add a file to the tree. Automatically creates parent directories.
        Args:
            path: File path (must be under root_path)
            metadata: File metadata
            hashes: Hash strings for the file 
        Returns:
            Created FileNode 
        Raises:
            ValueError: If path is not a file or not under root
        """
        path = self._normalize_path(path)

        if path.is_dir():
            raise ValueError(f"Cannot attach directory as file: {path}")
        
        file_node = FileNode(path=path, metadata=metadata, hashes=hashes)

        # Ensure parent directory chain exist
        parent = self._chain_path(path)

        # check for duplicates
        file_idx = next((i for i, f in enumerate(parent.files) if f.path == path), None)
        if file_idx is not None:
            # replace existing file
            parent.files[file_idx] = file_node
        else:
            parent.files.append(file_node)

        return file_node

    def merge(self, other: "FilesystemTree") -> None:
        """
        Merge another tree into this one. 
        overwrites any conflicting files between the trees. 
        Args:
            other: Another FilesystemTree to merge  
        Raises:
            ValueError: If roots don't match
        """
        if not other.root:
            return
        
        if not self.root:
            self.root = DirNode.from_dict(other.root.to_dict())
            return
        
        if self.root.path != other.root.path:
            raise ValueError(
                f"Cannot merge trees with different roots: "
                f"{self.root.path} != {other.root.path}"
            )
        
        # merge recursively
        self._merge(self.root, other.root)

    def _merge(self, target: DirNode, source: DirNode) -> None:
        """Recursively merge source directory into target."""
        # merge files
        existing_files = {f.path: i for i, f in enumerate(target.files)}
        for source_file in source.files:
            if source_file.path in existing_files:
                # overrite the files in target
                idx = existing_files[source_file.path]
                target.files[idx] = source_file
            else:
                target.files.append(source_file)

        # merge directories
        existing_subdirs = {dir.path: dir for dir in target.subdirs}
        for source_subdir in source.subdirs:
            if source_subdir.path in existing_subdirs:
                self._merge(existing_subdirs[source_subdir.path], source_subdir)
            else:
                target.subdirs.append(source_subdir)

    def query_dir(self, path: Path) -> Optional[DirNode]:
        """
        Find a directory node by path using BFS.
        Args:
            path: Absolute path to directory 
        Returns:
            DirNode if found, None otherwise
        """
        if not self.root:
            return None
        
        path = self._normalize_path(path)

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
        Args:
            filter_fn: Optional predicate to filter files
            start_path: Starting directory path (defaults to root) 
        Yields:
            FileNode instances matching filter
        """
        initial_node = self.root
        if start_path:
            initial_node = self.query_dir(start_path)
        
        if not initial_node:
            return

        # BFS traversal
        queue = deque([initial_node])
        while queue:
            node = queue.popleft()

            for file in node.files:
                if not filter_fn or filter_fn(file):
                    yield file

            queue.extend(node.subdirs)

    def compute_stats(self) -> dict[str, Any]:
        """
        Compute tree statistics 
        Returns:
            Dictionary with comprehensive statistics
        """
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
        
        queue = deque([(self.root, 0)]) # (node, depth)
        while queue:
            node, depth = queue.popleft()
            stats['total_dirs'] += 1
            stats['depth'] = max(stats['depth'], depth)
            
            # Process files in this directory
            for file_node in node.files:
                stats['total_files'] += 1
                stats['total_size'] += file_node.size
                stats['file_types'][file_node.metadata.filetype.value] += 1
                
                ext = file_node.path.suffix.lower() 
                if ext:
                    stats['extensions'][ext] += 1
            
            # Queue subdirectories
            for subdir in node.subdirs:
                queue.append((subdir, depth + 1))
        
        # Convert defaultdicts to regular dicts
        stats['file_types'] = dict(stats['file_types'])
        stats['extensions'] = dict(stats['extensions'])
        
        return stats
    
    def to_dict(self) -> dict[str, Any]:
        """
        Serialize the entire tree to a dictionary.
        Returns:
            Dictionary containing tree structure and metadata   
        """
        return {
            "root": self.root.to_dict(),
            "stats": self.compute_stats(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FilesystemTree":
        """
        Deserialize a tree from a dictionary.
        Args:
            data: Dictionary produced by to_dict()
        Returns:
            Reconstructed FilesystemTree instance
        Raises:
            ValueError: If data format is invalid
            KeyError: If required fields are missing
        """
        if "root" not in data:
            raise KeyError("Missing required field: 'root'")
        
        # Deserialize root node
        root_node = DirNode.from_dict(data["root"])
        
        # Create tree instance without calling __init__
        # (to avoid Metadata.extract() during deserialization)
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
    