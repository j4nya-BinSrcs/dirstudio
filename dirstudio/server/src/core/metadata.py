import os
import stat
import mimetypes
from pathlib import Path
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
from typing import Any, List, Dict, Optional

try:
    import magic
    HAS_MAGIC = True
except ImportError:
    HAS_MAGIC = False

class MetaTag(Enum):
    FILE = 'is_file'
    DIRECTORY = 'is_dir'
    SYMLINK = 'is_symlink'
    HIDDEN = 'is_hidden'
    CORRUPTED = 'is_corrupted'

class MetaTime(Enum):
    CREATED = 'crt_time'
    ACCESSED = 'acc_time'
    MODIFIED = 'mod_time'

class MetaProperty(Enum):
    SYMLINK = 'symlink_target'
    IMAGE = 'image_properties'
    MEDIA = 'media_properties'
    TEXT = 'text_properties'

class FileType(Enum):
    TEXT = 'text_file'
    AUDIO = 'audio_file'
    IMAGE = 'image_file'
    VIDEO = 'video_file'
    DOCUMENT = 'document_file'
    ARCHIVE = 'archive_file'
    CODE = 'code_file'
    BINARY = 'binary_file'
    UNKNOWN = 'unknown_file'

@dataclass(slots=True, frozen=True)
class Metadata:
    """Immutable metadata container for files and directories"""

    path: Path
    size: int
    tags: List[MetaTag]
    times: Dict[MetaTime, str]
    ino: int
    owner: str
    permissions: str
    properties: Dict[MetaProperty, str | dict]
    mime: Optional[str]

    @classmethod
    def extract(cls, path: Path | str, extract_props: bool = False) -> "Metadata":
        """
        Extract complete metadata from a file or directory path.
        Args:
            path: Path to file or directory
        Returns:
            Metadata instance with all extracted information
        Raises:
            FileNotFoundError: If path doesn't exist
            PermissionError: If path is not accessible
        """
        path = Path(path) if isinstance(path, str) else path
        
        if not path.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")
        
        try:
            stat_info = path.lstat()  # Use lstat to handle symlinks
            
            return cls(
                path=path,
                size=_extract_size(path, stat_info),
                tags=_extract_tags(path, stat_info),
                times=_extract_times(stat_info),
                ino=_extract_ino(stat_info),
                owner=_extract_owner(stat_info),
                permissions=_extract_permissions(stat_info),
                properties=_extract_properties(path, stat_info) if not extract_props else {},
                mime=_extract_mime(path)
            )
        except PermissionError as e:
            raise PermissionError(f"Permission denied accessing: {path}") from e
        except Exception:
            # Mark as corrupted if we can't read it properly
            return cls._corrupted_metadata(path)

    @classmethod
    def _corrupted_metadata(cls, path: Path) -> "Metadata":
        """Create minimal metadata for corrupted/inaccessible files"""
        tags = [MetaTag.CORRUPTED]
        if path.name.startswith('.'):
            tags.append(MetaTag.HIDDEN)

        return cls(
            path=path,
            size=0,
            tags=tags,
            times={
                MetaTime.CREATED: "unknown",
                MetaTime.ACCESSED: "unknown",
                MetaTime.MODIFIED: "unknown"
            },
            ino=0,
            owner="unknown",
            permissions="unknown",
            properties={},
            mime=None
        )

    @property
    def filetype(self) -> FileType:
        """
        Determine the file type based on MIME type and extension.
        Returns:
            FileType enum value
        """
        if MetaTag.DIRECTORY in self.tags or not self.mime:
            return FileType.UNKNOWN
        
        mime_lower = self.mime.lower()

        # Image files
        if mime_lower.startswith('image/'):
            return FileType.IMAGE
        
        # Audio files
        if mime_lower.startswith('audio/'):
            return FileType.AUDIO
        
        # Video files
        if mime_lower.startswith('video/'):
            return FileType.VIDEO
        
        # Text files
        if mime_lower.startswith('text/'):
            return FileType.TEXT
        
        # Document files
        document_mimes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument',
            'application/vnd.ms-excel',
            'application/vnd.ms-powerpoint',
            'application/rtf'
        ]
        if any(doc in mime_lower for doc in document_mimes):
            return FileType.DOCUMENT
        
        # Archive files
        archive_mimes = [
            'application/zip',
            'application/x-tar',
            'application/x-rar',
            'application/gzip',
            'application/x-7z-compressed',
            'application/x-bzip2'
        ]
        if any(arch in mime_lower for arch in archive_mimes):
            return FileType.ARCHIVE
        
        # Code files
        code_extensions = {'.py', '.js', '.java', '.cpp', '.c', '.h', '.rs', '.go', 
                          '.rb', '.php', '.swift', '.kt', '.ts', '.jsx', '.tsx'}
        if self.path.suffix.lower() in code_extensions:
            return FileType.CODE
        
        # Binary/application files
        if mime_lower.startswith('application/'):
            return FileType.BINARY
        
        return FileType.UNKNOWN
    
    @property
    def is_hidden(self) -> bool:
        return MetaTag.HIDDEN in self.tags

    @property
    def is_symlink(self) -> bool:
        return MetaTag.SYMLINK in self.tags

    @property
    def is_corrupted(self) -> bool:
        return MetaTag.CORRUPTED in self.tags

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert metadata to dictionary for serialization.
        Returns:
            Dictionary representation of metadata
        """
        return {
        "path": str(self.path),
        "size": self.size,
        "tags": [tag.name for tag in self.tags],
        "times": {
            time.name: value
            for time, value in self.times.items()
        },
        "inode": self.ino,
        "owner": self.owner,
        "permissions": self.permissions,
        "properties": {
            prop.name: value
            for prop, value in self.properties.items()
        },
        "mime": self.mime,
        "filetype": self.filetype.name,
        "flags": {
            "hidden": self.is_hidden,
            "symlink": self.is_symlink,
            "corrupted": self.is_corrupted,
        },
    }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Metadata":
        """
        Reconstruct Metadata from its serialized dictionary form.
        """
        return cls(
            path=Path(data["path"]),
            size=data["size"],
            tags=[MetaTag[tag] for tag in data.get("tags", [])],
            times={
                MetaTime[name]: value
                for name, value in data.get("times", {}).items()
            },
            ino=data.get("inode", 0),
            owner=data.get("owner", "unknown"),
            permissions=data.get("permissions", "unknown"),
            properties={
                MetaProperty[name]: value
                for name, value in data.get("properties", {}).items()
            },
            mime=data.get("mime"),
        )

def _extract_size(path: Path, stat_info: os.stat_result) -> int:
    """
    Extract file/directory size.
    Args:
        path: Path to file or directory
        stat_info: os.stat_result object    
    Returns:
        Size in bytes (0 for directories and symlinks)
    """
    if stat.S_ISDIR(stat_info.st_mode) or stat.S_ISLNK(stat_info.st_mode):
        return 0
    return stat_info.st_size

def _extract_tags(path: Path, stat_info: os.stat_result) -> List[MetaTag]:
    """
    Extract tags about the file/directory.
    Args:
        path: Path to file or directory
        stat_info: os.stat_result object
    Returns:
        List of MetaTag 
    """
    mode = stat_info.st_mode
    tags = []

    if stat.S_ISREG(mode): 
        tags.append(MetaTag.FILE)
    if  stat.S_ISDIR(mode):
        tags.append(MetaTag.DIRECTORY)
    if stat.S_ISLNK(mode):
        tags.append(MetaTag.SYMLINK)
    if path.name.startswith('.') or path.name.startswith('~'):
        tags.append(MetaTag.HIDDEN)

    return tags

def _extract_times(stat_info: os.stat_result) -> dict[MetaTime, str]:
    """
    Extract timestamp information.
    Args:
        stat_info: os.stat_result object
    Returns:
        Dictionary mapping MetaTime to ISO format timestamp strings
    """
    return {
        MetaTime.CREATED: datetime.fromtimestamp(stat_info.st_birthtime).isoformat(),
        MetaTime.ACCESSED: datetime.fromtimestamp(stat_info.st_atime).isoformat(),
        MetaTime.MODIFIED: datetime.fromtimestamp(stat_info.st_mtime).isoformat()
    }

def _extract_ino(stat_info: os.stat_result) -> int:
    """
    Extract inode number.
    Args:
        stat_info: os.stat_result object
    Returns:
        Inode number
    """
    return stat_info.st_ino

def _extract_owner(stat_info: os.stat_result) -> str:
    """
    Extract file owner username.
    Args:
        stat_info: os.stat_result object
    Returns:
        Owner username or UID as string if username lookup fails
    """
    uid = getattr(stat_info, "st_uid", None)

    # If st_uid is not available (Windows)
    if uid is None:
        return "unknown"

    try:
        # Unix-like systems
        import pwd
        return pwd.getpwuid(uid).pw_name #type: ignore
    except (ImportError, KeyError):
        # ImportError: pwd module not available (e.g., Windows)
        # KeyError: UID not found in passwd database
        return str(uid)

def _extract_permissions(stat_info: os.stat_result) -> str:
    """
    Extract file permissions in octal and symbolic format.
    Args:
        stat_info: os.stat_result object
    Returns:
        Permission string in format "0755 (rwxr-xr-x)"
    """
    mode = stat_info.st_mode
    octal = oct(stat.S_IMODE(mode))
    
    # Build symbolic representation
    symbolic = ''
    symbolic += 'r' if mode & stat.S_IRUSR else '-'
    symbolic += 'w' if mode & stat.S_IWUSR else '-'
    symbolic += 'x' if mode & stat.S_IXUSR else '-'
    symbolic += 'r' if mode & stat.S_IRGRP else '-'
    symbolic += 'w' if mode & stat.S_IWGRP else '-'
    symbolic += 'x' if mode & stat.S_IXGRP else '-'
    symbolic += 'r' if mode & stat.S_IROTH else '-'
    symbolic += 'w' if mode & stat.S_IWOTH else '-'
    symbolic += 'x' if mode & stat.S_IXOTH else '-'
    
    return f"{octal} ({symbolic})"

def _extract_properties(path: Path, stat_info: os.stat_result) -> dict[MetaProperty, str | dict]:
    """
    Extract additional properties based on file type.
    Args:
        path: Path to file or directory
        stat_info: os.stat_result object
    Returns:
        Dictionary of properties (symlink target, image metadata, etc.)
    """
    properties: Dict[MetaProperty, str | dict] = {}

    # --- Symlink properties ---
    symlink_props = _extract_symlink_properties(path, stat_info)
    if symlink_props is not None:
        properties[MetaProperty.SYMLINK] = symlink_props

    # --- Regular file properties ---
    if stat.S_ISREG(stat_info.st_mode):
        mime = _extract_mime(path)

        if mime:
            if mime.startswith("image/"):
                properties[MetaProperty.IMAGE] = _extract_image_properties(path)
            elif mime.startswith(("audio/", "video/")):
                properties[MetaProperty.MEDIA] = _extract_media_properties(path)
            elif mime.startswith("text/"):
                properties[MetaProperty.TEXT] = _extract_text_properties(path)

    return properties

def _extract_symlink_properties(path: Path, stat_info: os.stat_result) -> Optional[str]:
    if not stat.S_ISLNK(stat_info.st_mode):
        return None

    try:
        return str(path.readlink())
    except OSError:
        return "unreadable"

def _extract_image_properties(path: Path) -> dict:
    props: dict[str, Any] = {}

    try:
        from PIL import Image

        with Image.open(path) as img:
            props["format"] = img.format
            props["mode"] = img.mode
            props["width"], props["height"] = img.size

            if img.info:
                props["metadata"] = dict(img.info)

    except ImportError:
        props["error"] = "Pillow not installed"
    except Exception as exc:
        props["error"] = str(exc)

    return props

def _extract_media_properties(path: Path) -> dict:
    props: dict[str, Any] = {}

    try:
        props["mime"] = mimetypes.guess_type(path)[0]
        props["size_bytes"] = path.stat().st_size
    except Exception as exc:
        props["error"] = str(exc)

    return props

def _extract_text_properties(path: Path, max_bytes: int = 8192) -> dict:
    props: dict[str, Any] = {}

    try:
        with path.open("rb") as f:
            sample = f.read(max_bytes)

        props["encoding"] = _detect_encoding(sample)
        props["lines"] = sample.count(b"\n")

    except Exception as exc:
        props["error"] = str(exc)

    return props

def _detect_encoding(data: bytes) -> str:
    try:
        import chardet
        result = chardet.detect(data)
        return result.get("encoding") or "unknown"
    except ImportError:
        return "unknown"

def _extract_mime(path: Path) -> Optional[str]:
    """
    Extract MIME type of the file using magic bytes inspection.
    Falls back to extension-based detection if python-magic is unavailable.
    Args:
        path: Path to file
    Returns:
        MIME type string or None if cannot be determined
    """
    if path.is_dir() or path.is_symlink():
        return None
    
    mime_type = None
    
    # Primary method: use python-magic for content-based detection
    if HAS_MAGIC:
        try:
            mime_type = magic.from_file(str(path), mime=True) # type: ignore
        except (OSError, PermissionError, magic.MagicException): # type: ignore
            # Fall through to extension-based detection
            pass
    
    # Fallback: use mimetypes module for extension-based detection
    if not mime_type:
        mime_type, _ = mimetypes.guess_type(str(path))
    
    # Second fallback: common types not in mimetypes
    if not mime_type:
        ext = path.suffix.lower()
        fallback_map = {
            '.py': 'text/x-python',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.md': 'text/markdown',
            '.yml': 'text/yaml',
            '.yaml': 'text/yaml',
            '.toml': 'text/toml',
            '.rs': 'text/x-rust',
            '.go': 'text/x-go',
            '.ts': 'text/typescript',
            '.tsx': 'text/typescript',
            '.jsx': 'text/javascript',
        }
        mime_type = fallback_map.get(ext)
    
    return mime_type
