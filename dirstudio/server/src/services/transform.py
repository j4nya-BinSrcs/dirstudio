"""
File transformation and conversion service.
"""
import shutil
import zipfile
import tarfile
from pathlib import Path
from typing import Optional, Callable
from dataclasses import dataclass

from core.filesystem import FileNode
from core.metadata import FileType

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import PyPDF2
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False


@dataclass
class TransformResult:
    """Result of a transformation operation."""
    
    success: bool
    source_path: str
    target_path: Optional[str] = None
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            'success': self.success,
            'source_path': self.source_path,
            'target_path': self.target_path,
            'error': self.error
        }


class Transformer:
    """
    File transformation and conversion service.
    Handles compression, format conversion, and batch operations.
    """
    
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.results: list[TransformResult] = []
    
    def compress_files(
        self,
        files: list[FileNode],
        output_path: Path,
        format: str = 'zip'
    ) -> TransformResult:
        """
        Compress multiple files into archive.
        
        Args:
            files: Files to compress
            output_path: Output archive path
            format: Archive format ('zip' or 'tar')
        
        Returns:
            TransformResult
        """
        if self.dry_run:
            return TransformResult(
                success=True,
                source_path=f"{len(files)} files",
                target_path=str(output_path)
            )
        
        try:
            if format == 'zip':
                with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for file_node in files:
                        zf.write(file_node.path, file_node.name)
            
            elif format == 'tar':
                with tarfile.open(output_path, 'w:gz') as tf:
                    for file_node in files:
                        tf.add(file_node.path, arcname=file_node.name)
            
            else:
                raise ValueError(f"Unsupported format: {format}")
            
            result = TransformResult(
                success=True,
                source_path=f"{len(files)} files",
                target_path=str(output_path)
            )
        
        except Exception as e:
            result = TransformResult(
                success=False,
                source_path=f"{len(files)} files",
                error=str(e)
            )
        
        self.results.append(result)
        return result
    
    def convert_image(
        self,
        file_node: FileNode,
        target_format: str,
        output_dir: Optional[Path] = None
    ) -> TransformResult:
        """
        Convert image to different format.
        
        Args:
            file_node: Source image file
            target_format: Target format (e.g., 'png', 'jpg', 'webp')
            output_dir: Output directory (defaults to source dir)
        
        Returns:
            TransformResult
        """
        if not HAS_PIL:
            return TransformResult(
                success=False,
                source_path=str(file_node.path),
                error="PIL not available"
            )
        
        if file_node.metadata.filetype != FileType.IMAGE:
            return TransformResult(
                success=False,
                source_path=str(file_node.path),
                error="Not an image file"
            )
        
        output_dir = output_dir or file_node.path.parent
        output_path = output_dir / f"{file_node.path.stem}.{target_format}"
        
        if self.dry_run:
            return TransformResult(
                success=True,
                source_path=str(file_node.path),
                target_path=str(output_path)
            )
        
        try:
            with Image.open(file_node.path) as img:
                # Convert RGBA to RGB if saving as JPEG
                if target_format.lower() in ('jpg', 'jpeg') and img.mode == 'RGBA':
                    img = img.convert('RGB')
                
                img.save(output_path, format=target_format.upper())
            
            result = TransformResult(
                success=True,
                source_path=str(file_node.path),
                target_path=str(output_path)
            )
        
        except Exception as e:
            result = TransformResult(
                success=False,
                source_path=str(file_node.path),
                error=str(e)
            )
        
        self.results.append(result)
        return result
    
    def resize_image(
        self,
        file_node: FileNode,
        max_width: int,
        max_height: int,
        output_dir: Optional[Path] = None
    ) -> TransformResult:
        """
        Resize image to maximum dimensions.
        
        Args:
            file_node: Source image file
            max_width: Maximum width
            max_height: Maximum height
            output_dir: Output directory
        
        Returns:
            TransformResult
        """
        if not HAS_PIL:
            return TransformResult(
                success=False,
                source_path=str(file_node.path),
                error="PIL not available"
            )
        
        output_dir = output_dir or file_node.path.parent
        output_path = output_dir / f"{file_node.path.stem}_resized{file_node.path.suffix}"
        
        if self.dry_run:
            return TransformResult(
                success=True,
                source_path=str(file_node.path),
                target_path=str(output_path)
            )
        
        try:
            with Image.open(file_node.path) as img:
                img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
                img.save(output_path)
            
            result = TransformResult(
                success=True,
                source_path=str(file_node.path),
                target_path=str(output_path)
            )
        
        except Exception as e:
            result = TransformResult(
                success=False,
                source_path=str(file_node.path),
                error=str(e)
            )
        
        self.results.append(result)
        return result
    
    def move_files(
        self,
        files: list[FileNode],
        target_dir: Path
    ) -> list[TransformResult]:
        """
        Move files to target directory.
        
        Args:
            files: Files to move
            target_dir: Target directory
        
        Returns:
            List of TransformResults
        """
        target_dir.mkdir(parents=True, exist_ok=True)
        results = []
        
        for file_node in files:
            target_path = target_dir / file_node.name
            
            if self.dry_run:
                result = TransformResult(
                    success=True,
                    source_path=str(file_node.path),
                    target_path=str(target_path)
                )
            else:
                try:
                    shutil.move(str(file_node.path), str(target_path))
                    result = TransformResult(
                        success=True,
                        source_path=str(file_node.path),
                        target_path=str(target_path)
                    )
                except Exception as e:
                    result = TransformResult(
                        success=False,
                        source_path=str(file_node.path),
                        error=str(e)
                    )
            
            results.append(result)
            self.results.append(result)
        
        return results
    
    def copy_files(
        self,
        files: list[FileNode],
        target_dir: Path
    ) -> list[TransformResult]:
        """
        Copy files to target directory.
        
        Args:
            files: Files to copy
            target_dir: Target directory
        
        Returns:
            List of TransformResults
        """
        target_dir.mkdir(parents=True, exist_ok=True)
        results = []
        
        for file_node in files:
            target_path = target_dir / file_node.name
            
            if self.dry_run:
                result = TransformResult(
                    success=True,
                    source_path=str(file_node.path),
                    target_path=str(target_path)
                )
            else:
                try:
                    shutil.copy2(str(file_node.path), str(target_path))
                    result = TransformResult(
                        success=True,
                        source_path=str(file_node.path),
                        target_path=str(target_path)
                    )
                except Exception as e:
                    result = TransformResult(
                        success=False,
                        source_path=str(file_node.path),
                        error=str(e)
                    )
            
            results.append(result)
            self.results.append(result)
        
        return results
    
    def delete_files(
        self,
        files: list[FileNode]
    ) -> list[TransformResult]:
        """
        Delete files (with dry-run support).
        
        Args:
            files: Files to delete
        
        Returns:
            List of TransformResults
        """
        results = []
        
        for file_node in files:
            if self.dry_run:
                result = TransformResult(
                    success=True,
                    source_path=str(file_node.path),
                    target_path="<deleted>"
                )
            else:
                try:
                    file_node.path.unlink()
                    result = TransformResult(
                        success=True,
                        source_path=str(file_node.path),
                        target_path="<deleted>"
                    )
                except Exception as e:
                    result = TransformResult(
                        success=False,
                        source_path=str(file_node.path),
                        error=str(e)
                    )
            
            results.append(result)
            self.results.append(result)
        
        return results
    
    def batch_transform(
        self,
        files: list[FileNode],
        operation: Callable[[FileNode], TransformResult]
    ) -> list[TransformResult]:
        """
        Apply transformation to multiple files.
        
        Args:
            files: Files to transform
            operation: Transformation function
        
        Returns:
            List of TransformResults
        """
        results = []
        
        for file_node in files:
            result = operation(file_node)
            results.append(result)
            self.results.append(result)
        
        return results
    
    def get_summary(self) -> dict:
        """Get summary of all operations."""
        success_count = sum(1 for r in self.results if r.success)
        error_count = len(self.results) - success_count
        
        return {
            'total_operations': len(self.results),
            'successful': success_count,
            'failed': error_count,
            'dry_run': self.dry_run,
            'results': [r.to_dict() for r in self.results]
        }
    
    def clear_results(self) -> None:
        """Clear operation results."""
        self.results.clear()