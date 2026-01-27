"""
Simple test of the complete pipeline.

Tests: Scanner → Processor → Hashing → Tree
"""

import tempfile
import shutil
from pathlib import Path
from collections import defaultdict

from dirstudio.server.src.services.scan import scan_directory
from dirstudio.server.src.services.hash import SHA256Hasher
from dirstudio.server.src.core.processor import process_files


def create_test_files():
    """Create simple test directory."""
    tmpdir = Path(tempfile.mkdtemp(prefix="test_"))
    
    # Create some files
    (tmpdir / "file1.txt").write_text("Content A")
    (tmpdir / "file2.txt").write_text("Content B")
    (tmpdir / "file3.txt").write_text("Content A")  # Duplicate of file1
    
    # Create subdirectory
    (tmpdir / "subdir").mkdir()
    (tmpdir / "subdir" / "file4.txt").write_text("Content C")
    (tmpdir / "subdir" / "file5.txt").write_text("Content A")  # Another duplicate
    
    return tmpdir


def test_basic_pipeline():
    """Test: Scan → Process → Analyze"""
    print("="*70)
    print("TEST: Basic Pipeline")
    print("="*70 + "\n")
    
    test_dir = create_test_files()
    print(f"Test directory: {test_dir}\n")
    
    try:
        # STEP 1: Scan
        print("Step 1: Scanning...")
        queue, stats = scan_directory(test_dir)
        print(f"  Files found: {stats.files_found}")
        print(f"  Directories: {stats.dirs_found}")
        print(f"  Errors: {stats.errors}\n")
        
        assert stats.files_found == 5, "Should find 5 files"
        
        # STEP 2: Process with hashing
        print("Step 2: Processing with SHA-256...")
        hasher = SHA256Hasher()
        tree = process_files(test_dir, queue, hasher)
        print(f"  Processed: {len(tree)} files\n")
        
        assert len(tree) == 5, "Should have 5 files in tree"
        
        # STEP 3: Find duplicates
        print("Step 3: Finding duplicates...")
        duplicates = defaultdict(list)
        
        for file_node in tree.traverse():
            sha256 = file_node.hashes.get("sha256")
            if sha256:
                duplicates[sha256].append(file_node)
        
        # Find duplicate groups
        dup_groups = [files for files in duplicates.values() if len(files) > 1]
        
        print(f"  Found {len(dup_groups)} duplicate group(s)\n")
        
        for i, files in enumerate(dup_groups, 1):
            print(f"  Group {i} ({len(files)} files):")
            for f in files:
                rel_path = f.path.relative_to(test_dir)
                print(f"    - {rel_path}")
        print()
        
        assert len(dup_groups) == 1, "Should find 1 duplicate group"
        assert len(dup_groups[0]) == 3, "Duplicate group should have 3 files"
        
        print("✓ All tests passed!\n")
        
    finally:
        shutil.rmtree(test_dir)
        print(f"Cleaned up: {test_dir}")


def test_hash_consistency():
    """Test: Same file always gives same hash"""
    print("\n" + "="*70)
    print("TEST: Hash Consistency")
    print("="*70 + "\n")
    
    with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
        f.write("Test content")
        temp_path = Path(f.name)
    
    try:
        hasher = SHA256Hasher()
        
        # Compute hash multiple times
        hash1 = hasher.compute(temp_path)["sha256"]
        hash2 = hasher.compute(temp_path)["sha256"]
        hash3 = hasher.compute(temp_path)["sha256"]
        
        print(f"Hash 1: {hash1[:32]}...")
        print(f"Hash 2: {hash2[:32]}...")
        print(f"Hash 3: {hash3[:32]}...")
        
        assert hash1 == hash2 == hash3, "Hashes should be identical"
        print("\n✓ Hashes are consistent!\n")
        
    finally:
        temp_path.unlink()


def test_tree_structure():
    """Test: Tree structure is correct"""
    print("="*70)
    print("TEST: Tree Structure")
    print("="*70 + "\n")
    
    test_dir = create_test_files()
    
    try:
        # Scan and process
        queue, _ = scan_directory(test_dir)
        tree = process_files(test_dir, queue, SHA256Hasher())
        
        # Check stats
        stats = tree.compute_stats()
        
        print("Tree Statistics:")
        print(f"  Files: {stats['total_files']}")
        print(f"  Directories: {stats['total_dirs']}")
        print(f"  Depth: {stats['depth']}")
        print(f"  File types: {stats['file_types']}")
        
        assert stats['total_files'] == 5
        assert stats['total_dirs'] == 2  # root + subdir
        assert stats['depth'] == 1
        
        print("\n✓ Tree structure is correct!\n")
        
    finally:
        shutil.rmtree(test_dir)


def test_empty_directory():
    """Test: Handle empty directory"""
    print("="*70)
    print("TEST: Empty Directory")
    print("="*70 + "\n")
    
    test_dir = Path(tempfile.mkdtemp(prefix="empty_"))
    
    try:
        queue, stats = scan_directory(test_dir)
        
        print(f"Files found: {stats.files_found}")
        print(f"Directories: {stats.dirs_found}")
        
        assert stats.files_found == 0
        assert stats.dirs_found == 0
        
        print("\n✓ Empty directory handled correctly!\n")
        
    finally:
        shutil.rmtree(test_dir)


if __name__ == "__main__":
    print("\n" + "="*70)
    print("DirStudio Simple Pipeline Tests")
    print("="*70 + "\n")
    
    test_basic_pipeline()
    test_hash_consistency()
    test_tree_structure()
    test_empty_directory()
    
    print("="*70)
    print("ALL TESTS PASSED! ✓")
    print("="*70 + "\n")