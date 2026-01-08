"""
DirStudio Transformation Module - Lightweight
Handles essential file conversions, compression, and archiving.
"""

import shutil
import zipfile
import tarfile
import gzip
import bz2
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass

# Only import heavy libraries when needed
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


@dataclass
class TransformResult:
    """Simple result object"""
    success: bool
    message: str
    source: str
    output: Optional[str] = None
    original_size: int = 0
    new_size: int = 0
    
    @property
    def saved_space(self) -> int:
        return self.original_size - self.new_size if self.new_size else 0


class Transformer:
    """Lightweight file transformation handler"""
    
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.results: List[TransformResult] = []
    
    # ========== IMAGE OPERATIONS ==========
    
    def convert_image(self, source: Path, target: Path, quality: int = 85) -> TransformResult:
        """Convert image format"""
        if not PIL_AVAILABLE:
            return TransformResult(False, "PIL not available", str(source))
        
        try:
            orig_size = source.stat().st_size
            
            if self.dry_run:
                return TransformResult(True, "Dry run: would convert", str(source), str(target), orig_size)
            
            with Image.open(source) as img:  # type: ignore
                # Convert RGBA to RGB for JPEG
                if target.suffix.lower() in ['.jpg', '.jpeg'] and img.mode in ('RGBA', 'LA', 'P'):
                    bg = Image.new('RGB', img.size, (255, 255, 255)) # type: ignore
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    bg.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                    img = bg
                
                # Save with quality
                kwargs = {'quality': quality, 'optimize': True} if target.suffix.lower() in ['.jpg', '.jpeg', '.webp'] else {'optimize': True}
                img.save(target, **kwargs) # type: ignore
            
            new_size = target.stat().st_size
            result = TransformResult(True, "Converted", str(source), str(target), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", str(source))
            self.results.append(result)
            return result
    
    def images_to_pdf(self, images: List[Path], output: Path) -> TransformResult:
        """Combine images into PDF"""
        if not PIL_AVAILABLE:
            return TransformResult(False, "PIL not available", f"{len(images)} images")
        
        try:
            orig_size = sum(img.stat().st_size for img in images)
            
            if self.dry_run:
                return TransformResult(True, "Dry run: would create PDF", f"{len(images)} images", str(output), orig_size)
            
            img_list = []
            for img_path in images:
                img = Image.open(img_path) # type: ignore
                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGB')
                img_list.append(img)
            
            if img_list:
                img_list[0].save(output, save_all=True, append_images=img_list[1:])
            
            new_size = output.stat().st_size
            result = TransformResult(True, f"Created PDF from {len(images)} images", f"{len(images)} images", str(output), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", f"{len(images)} images")
            self.results.append(result)
            return result
    
    def resize_image(self, source: Path, target: Path, max_size: int = 1920) -> TransformResult:
        """Resize image to max dimension"""
        if not PIL_AVAILABLE:
            return TransformResult(False, "PIL not available", str(source))
        
        try:
            orig_size = source.stat().st_size
            
            if self.dry_run:
                return TransformResult(True, "Dry run: would resize", str(source), str(target), orig_size)
            
            with Image.open(source) as img: # type: ignore
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS) # type: ignore
                img.save(target, optimize=True)
            
            new_size = target.stat().st_size
            result = TransformResult(True, f"Resized to max {max_size}px", str(source), str(target), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", str(source))
            self.results.append(result)
            return result
    
    # ========== COMPRESSION ==========
    
    def compress(self, source: Path, output: Path = None, method: str = 'gz') -> TransformResult: # type: ignore
        """Compress file (gz, bz2)"""
        if output is None:
            output = source.with_suffix(source.suffix + f'.{method}')
        
        try:
            orig_size = source.stat().st_size
            
            if self.dry_run:
                return TransformResult(True, f"Dry run: would compress with {method}", str(source), str(output), orig_size)
            
            compressor = gzip if method == 'gz' else bz2
            
            with open(source, 'rb') as f_in:
                with compressor.open(output, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
            
            new_size = output.stat().st_size
            ratio = (1 - new_size/orig_size) * 100
            result = TransformResult(True, f"Compressed {ratio:.1f}%", str(source), str(output), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", str(source))
            self.results.append(result)
            return result
    
    def decompress(self, source: Path, output: Path = None) -> TransformResult: # type: ignore
        """Decompress .gz or .bz2 file"""
        if output is None:
            output = source.with_suffix('')
        
        try:
            orig_size = source.stat().st_size
            
            if self.dry_run:
                return TransformResult(True, "Dry run: would decompress", str(source), str(output), orig_size)
            
            if source.suffix == '.gz':
                opener = gzip.open
            elif source.suffix == '.bz2':
                opener = bz2.open
            else:
                return TransformResult(False, f"Unsupported format: {source.suffix}", str(source))
            
            with opener(source, 'rb') as f_in:
                with open(output, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
            
            new_size = output.stat().st_size
            result = TransformResult(True, "Decompressed", str(source), str(output), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", str(source))
            self.results.append(result)
            return result
    
    # ========== ARCHIVING ==========
    
    def create_zip(self, sources: List[Path], output: Path, compression: bool = True) -> TransformResult:
        """Create ZIP archive"""
        try:
            orig_size = sum(
                sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) if p.is_dir() 
                else p.stat().st_size for p in sources
            )
            
            if self.dry_run:
                return TransformResult(True, f"Dry run: would archive {len(sources)} items", f"{len(sources)} items", str(output), orig_size)
            
            compress_type = zipfile.ZIP_DEFLATED if compression else zipfile.ZIP_STORED
            
            with zipfile.ZipFile(output, 'w', compress_type) as zf:
                for source in sources:
                    if source.is_file():
                        zf.write(source, source.name)
                    else:
                        for file in source.rglob('*'):
                            if file.is_file():
                                zf.write(file, file.relative_to(source.parent))
            
            new_size = output.stat().st_size
            ratio = (1 - new_size/orig_size) * 100
            result = TransformResult(True, f"Archived {len(sources)} items, saved {ratio:.1f}%", f"{len(sources)} items", str(output), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", f"{len(sources)} items")
            self.results.append(result)
            return result
    
    def create_tar(self, sources: List[Path], output: Path, compress: str = None) -> TransformResult: # type: ignore
        """Create TAR archive (optional: gz, bz2, xz compression)"""
        try:
            orig_size = sum(
                sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) if p.is_dir() 
                else p.stat().st_size for p in sources
            )
            
            mode = f'w:{compress}' if compress else 'w'
            
            if self.dry_run:
                return TransformResult(True, f"Dry run: would create tar{'.'+compress if compress else ''}", f"{len(sources)} items", str(output), orig_size)
            
            with tarfile.open(output, mode) as tf: # type: ignore
                for source in sources:
                    tf.add(source, arcname=source.name)
            
            new_size = output.stat().st_size
            result = TransformResult(True, f"Created tar archive of {len(sources)} items", f"{len(sources)} items", str(output), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", f"{len(sources)} items")
            self.results.append(result)
            return result
    
    def extract(self, archive: Path, output_dir: Path) -> TransformResult:
        """Extract ZIP or TAR archive"""
        try:
            orig_size = archive.stat().st_size
            
            if self.dry_run:
                return TransformResult(True, "Dry run: would extract", str(archive), str(output_dir), orig_size)
            
            output_dir.mkdir(parents=True, exist_ok=True)
            
            if archive.suffix == '.zip':
                with zipfile.ZipFile(archive, 'r') as zf:
                    zf.extractall(output_dir)
                    count = len(zf.namelist())
            else:
                with tarfile.open(archive, 'r:*') as tf:
                    tf.extractall(output_dir)
                    count = len(tf.getmembers())
            
            new_size = sum(f.stat().st_size for f in output_dir.rglob('*') if f.is_file())
            result = TransformResult(True, f"Extracted {count} items", str(archive), str(output_dir), orig_size, new_size)
            self.results.append(result)
            return result
            
        except Exception as e:
            result = TransformResult(False, f"Error: {e}", str(archive))
            self.results.append(result)
            return result
    
    # ========== BATCH OPERATIONS ==========
    
    def batch_convert(self, files: List[Path], output_dir: Path, target_ext: str, **kwargs) -> List[TransformResult]:
        """Batch convert files"""
        output_dir.mkdir(parents=True, exist_ok=True)
        results = []
        
        for file in files:
            target = output_dir / f"{file.stem}.{target_ext.lstrip('.')}"
            
            if target_ext.lower() in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']:
                result = self.convert_image(file, target, kwargs.get('quality', 85))
            else:
                result = TransformResult(False, f"Unsupported target format: {target_ext}", str(file))
            
            results.append(result)
        
        return results
    
    def batch_resize(self, files: List[Path], output_dir: Path, max_size: int = 1920) -> List[TransformResult]:
        """Batch resize images"""
        output_dir.mkdir(parents=True, exist_ok=True)
        results = []
        
        for file in files:
            target = output_dir / file.name
            result = self.resize_image(file, target, max_size)
            results.append(result)
        
        return results
    
    def batch_compress(self, files: List[Path], method: str = 'gz') -> List[TransformResult]:
        """Batch compress files"""
        results = []
        
        for file in files:
            result = self.compress(file, method=method)
            results.append(result)
        
        return results
    
    # ========== REPORTING ==========
    
    def summary(self) -> Dict:
        """Get operation summary"""
        total = len(self.results)
        success = sum(1 for r in self.results if r.success)
        
        total_orig = sum(r.original_size for r in self.results)
        total_new = sum(r.new_size for r in self.results)
        total_saved = total_orig - total_new
        
        return {
            'total': total,
            'successful': success,
            'failed': total - success,
            'original_size_mb': total_orig / (1024*1024),
            'new_size_mb': total_new / (1024*1024),
            'saved_mb': total_saved / (1024*1024),
            'compression_ratio': f"{(total_saved/total_orig*100):.1f}%" if total_orig else "0%"
        }
    
    def print_summary(self):
        """Print summary to console"""
        s = self.summary()
        print(f"\n{'='*50}")
        print("Transformation Summary")
        print(f"{'='*50}")
        print(f"Total operations: {s['total']}")
        print(f"Successful: {s['successful']}")
        print(f"Failed: {s['failed']}")
        print(f"Original size: {s['original_size_mb']:.2f} MB")
        print(f"New size: {s['new_size_mb']:.2f} MB")
        print(f"Space saved: {s['saved_mb']:.2f} MB ({s['compression_ratio']})")
        print(f"{'='*50}\n")


# Quick utility functions
def quick_zip(files: List[Path], output: Path) -> bool:
    """Quick function to create a ZIP"""
    t = Transformer()
    result = t.create_zip(files, output)
    return result.success


def quick_extract(archive: Path, output_dir: Path) -> bool:
    """Quick function to extract archive"""
    t = Transformer()
    result = t.extract(archive, output_dir)
    return result.success


def quick_compress(file: Path, method: str = 'gz') -> bool:
    """Quick function to compress a file"""
    t = Transformer()
    result = t.compress(file, method=method)
    return result.success


# Example usage
if __name__ == "__main__":
    t = Transformer(dry_run=False)
    
    # Example operations:
    # t.convert_image(Path("photo.png"), Path("photo.jpg"), quality=90)
    # t.create_zip([Path("folder1"), Path("file.txt")], Path("archive.zip"))
    # t.compress(Path("large_file.txt"), method='gz')
    # t.extract(Path("archive.zip"), Path("extracted"))
    
    # t.print_summary()
    
    print("Lightweight Transformer loaded")
    print(f"PIL available: {PIL_AVAILABLE}")