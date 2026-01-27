"""
File and directory metadata extraction.
Preserved design from original with minor performance improvements.
"""
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
import mimetypes
import os
from pathlib import Path
import stat
from typing import Any, Optional

try:
    import magic
    HAS_MAGIC = True
except ImportError:
    HAS_MAGIC = False


DOCUMENT_MIMES = {
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/rtf'
}

ARCHIVE_MIMES = {
    'application/zip',
    'application/x-tar',
    'application/x-rar',
    'application/gzip',
    'application/x-7z-compressed',
    'application/x-bzip2'
}

CODE_EXTENSIONS = {
    '.py', '.js', '.java', '.cpp', '.c', '.h', '.rs', '.go',
    '.rb', '.php', '.swift', '.kt', '.ts', '.jsx', '.tsx'
}


class MetaTime(Enum):
    """Time metadata types for file system objects."""
    CREATED = 'crt_time'
    ACCESSED = 'acc_time'
    MODIFIED = 'mod_time'


class FileType(Enum):
    """Classification of file types based on MIME and extension."""
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
    """Immutable metadata container for files and directories."""
    
    path: Path
    size: int
    time: dict[MetaTime, str]
    ino: int
    owner: str
    perms: str
    mime: Optional[str]
    
    @classmethod
    def extract(cls, path: Path) -> "Metadata":
        """Extract complete metadata from a file or directory path."""
        if not path.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")
        
        try:
            stat_info = path.lstat()
            return cls(
                path=path,
                size=_get_size(stat_info),
                time=_get_time(stat_info),
                ino=stat_info.st_ino,
                owner=_get_owner(stat_info),
                perms=_get_perms(stat_info),
                mime=_get_mime(path)
            )
        except PermissionError as e:
            raise PermissionError(f"Permission denied: {path}") from e
        except Exception:
            return cls._fallback(path)
    
    @classmethod
    def _fallback(cls, path: Path) -> "Metadata":
        """Create placeholder metadata for inaccessible files."""
        return cls(
            path=path,
            size=0,
            time={
                MetaTime.CREATED: "unknown",
                MetaTime.ACCESSED: "unknown",
                MetaTime.MODIFIED: "unknown"
            },
            ino=0,
            owner="unknown",
            perms="unknown",
            mime=None
        )
    
    @property
    def filetype(self) -> FileType:
        """Determine file type from MIME and extension."""
        if not self.mime:
            return FileType.UNKNOWN
        
        mime = self.mime.lower()
        
        # Check by MIME prefix
        if any(mime.startswith(doc) for doc in DOCUMENT_MIMES):
            return FileType.DOCUMENT
        
        if any(mime.startswith(arch) for arch in ARCHIVE_MIMES):
            return FileType.ARCHIVE
        
        if self.path.suffix.lower() in CODE_EXTENSIONS:
            return FileType.CODE
        
        # Check by category
        category = mime.split('/')[0]
        if category == 'image':
            return FileType.IMAGE
        elif category == 'audio':
            return FileType.AUDIO
        elif category == 'video':
            return FileType.VIDEO
        elif category == 'text':
            return FileType.TEXT
        elif category == 'application':
            return FileType.BINARY
        
        return FileType.UNKNOWN
    
    @property
    def is_hidden(self) -> bool:
        """Check if file/directory is hidden."""
        return self.path.name.startswith('.')
    
    @property
    def is_symlink(self) -> bool:
        """Check if path is a symbolic link."""
        return self.path.is_symlink()
    
    def to_dict(self) -> dict[str, Any]:
        """Convert metadata to dictionary for serialization."""
        return {
            "path": str(self.path),
            "size": self.size,
            "time": {time.name: value for time, value in self.time.items()},
            "inode": self.ino,
            "owner": self.owner,
            "permissions": self.perms,
            "mime": self.mime,
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Metadata":
        """Reconstruct Metadata from dictionary."""
        return cls(
            path=Path(data["path"]),
            size=data["size"],
            time={MetaTime[name]: value for name, value in data.get("time", {}).items()},
            ino=data.get("inode", 0),
            owner=data.get("owner", "unknown"),
            perms=data.get("permissions", "unknown"),
            mime=data.get("mime"),
        )


# Helper functions

def _get_size(stat_info: os.stat_result) -> int:
    """Extract size from stat result."""
    if stat.S_ISDIR(stat_info.st_mode) or stat.S_ISLNK(stat_info.st_mode):
        return 0
    return stat_info.st_size


def _get_time(stat_info: os.stat_result) -> dict[MetaTime, str]:
    """Extract timestamps as ISO strings."""
    return {
        MetaTime.CREATED: datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
        MetaTime.ACCESSED: datetime.fromtimestamp(stat_info.st_atime).isoformat(),
        MetaTime.MODIFIED: datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
    }


def _get_owner(stat_info: os.stat_result) -> str:
    """Extract owner name."""
    uid = getattr(stat_info, "st_uid", None)
    if uid is None:
        return "unknown"
    
    try:
        import pwd
        return pwd.getpwuid(uid).pw_name # type: ignore (Not Supported for windows)
    except (ImportError, KeyError):
        return str(uid)


def _get_perms(stat_info: os.stat_result) -> str:
    """Extract permissions as octal and symbolic."""
    mode = stat_info.st_mode
    octal = oct(stat.S_IMODE(mode))
    
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


def _get_mime(path: Path) -> Optional[str]:
    """Detect MIME type using python-magic if available."""
    if HAS_MAGIC:
        try:
            return magic.from_file(str(path), mime=True) # type: ignore
        except Exception:
            pass
    
    mime_type, _ = mimetypes.guess_type(str(path))
    return mime_type