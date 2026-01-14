from datetime import datetime
from enum import Enum
from dataclasses import dataclass
import mimetypes
import os
from pathlib import Path
import stat
from typing import Any, Optional
import magic


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
    CREATED = 'crt_time'
    ACCESSED = 'acc_time'
    MODIFIED = 'mod_time'

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
    time: dict[MetaTime, str]
    ino: int
    owner: str
    perms: str
    mime: Optional[str]

    @classmethod
    def extract(cls, path: Path) -> "Metadata":
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
        if not path.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")
        
        try:
            stat_info = path.lstat()  # Use lstat to handle symlinks
            return cls(
                path=path,
                size=_size(stat_info),
                time=_time(stat_info),
                ino=_ino(stat_info),
                owner=_owner(stat_info),
                perms=_perms(stat_info),
                mime=_mime(path)
            )
        except PermissionError as e:
            raise PermissionError(f"Permission denied accessing: {path}") from e
        except Exception:
            return cls._pseudo_metadata(path)

    @classmethod
    def _pseudo_metadata(cls, path: Path) -> "Metadata":
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
        if not isinstance(self.mime, str) or not self.mime:
            return FileType.UNKNOWN

        mime = self.mime.lower()

        if any(doc in mime for doc in DOCUMENT_MIMES):
            return FileType.DOCUMENT
        if any(arch in mime for arch in ARCHIVE_MIMES):
            return FileType.ARCHIVE
        if self.path.suffix.lower() in CODE_EXTENSIONS:
            return FileType.CODE

        match(mime.split('/')[0]):
            case 'image': 
                return FileType.IMAGE
            case 'audio': 
                return FileType.AUDIO
            case 'video':
                return FileType.VIDEO
            case 'text':
                return FileType.TEXT
            case 'application':
                return FileType.BINARY

        return FileType.UNKNOWN

    @property
    def is_hidden(self) -> bool:
        return str(self.path).startswith('.')

    @property
    def is_symlink(self) -> bool:
        return self.path.is_symlink()

    def to_dict(self) -> dict[str, Any]:
        """
        Convert metadata to dictionary for serialization.
        Returns:
            Dictionary representation of metadata
        """
        return {
            "path": str(self.path),
            "size": self.size,
            "time": {
                time.name: value
                for time, value in self.time.items()
            },
            "inode": self.ino,
            "owner": self.owner,
            "permissions": self.perms,
            "mime": self.mime,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Metadata":
        """
        Reconstruct Metadata from its serialized dictionary form.
        """
        return cls(
            path=Path(data["path"]),
            size=data["size"],
            time={
                MetaTime[name]: value
                for name, value in data.get("time", {}).items()
            },
            ino=data.get("inode", 0),
            owner=data.get("owner", "unknown"),
            perms=data.get("perms", "unknown"),
            mime=data.get("mime"),
        )

def _size(stat_info: os.stat_result) -> int:
    if stat.S_ISDIR(stat_info.st_mode) or stat.S_ISLNK(stat_info.st_mode):
        return 0
    return stat_info.st_size

def _time(stat_info: os.stat_result) -> dict[MetaTime, str]:
    return {
        MetaTime.CREATED: datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
        MetaTime.ACCESSED: datetime.fromtimestamp(stat_info.st_atime).isoformat(),
        MetaTime.MODIFIED: datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
    }

def _ino(stat_info: os.stat_result) -> int:
    return stat_info.st_ino

def _owner(stat_info: os.stat_result) -> str:
    uid = getattr(stat_info, "st_uid", None)

    # If st_uid is not available (Windows)
    if uid is None:
        return "unknown"

    try:
        # Unix-like systems
        import pwd
        return pwd.getpwuid(uid).pw_name # type: ignore # pwd unavailable in windows 
    except (ImportError, KeyError):
        # ImportError: pwd module not available (e.g., Windows)
        # KeyError: UID not found in passwd database
        return str(uid)
    
def _perms(stat_info: os.stat_result) -> str:
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

def _mime(path: Path) -> Optional[str]:
    mime_type = None
    try:
        mime_type = magic.from_file(str(path), mime=True) 
    except (OSError, PermissionError, magic.MagicException):
        # Fall through to extension-based detection
        pass
    if not mime_type:
        mime_type, _ = mimetypes.guess_type(str(path))
    return mime_type
