"""
DirStudio main entry point.
Supports both CLI mode and API server mode.
"""
import sys
import json
from pathlib import Path

# Add src to path if running from project root
src_path = Path(__file__).parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from services.scan import Scanner
from services.duplicate import DuplicateDetector


def cli_mode(test_path: str):
    """Run in CLI mode with full analysis pipeline."""
    
    print("=" * 60)
    print("DirStudio - Directory Intelligence System")
    print("=" * 60)
    print()
    
    # STEP 1: Scan directory
    print("STEP 1: Scanning directory...")
    print("-" * 60)
    
    scanner = Scanner(max_depth=5, num_workers=4)
    
    try:
        tree = scanner.scan(
            path=test_path,
            compute_sha256=True,
            compute_phash=True
        )
        
        stats = tree.compute_stats()
        print()
        print(f"Files: {stats['total_files']}")
        print(f"Directories: {stats['total_dirs']}")
        print(f"Total size: {stats['total_size'] / (1024**2):.2f} MB")
        print(f"Depth: {stats['depth']}")
        
        # STEP 2: Detect duplicates
        print()
        print("=" * 60)
        print("STEP 2: Detecting duplicates...")
        print("-" * 60)
        
        files = list(tree.traverse())
        print(f"Analyzing {len(files)} files...")
        
        detector = DuplicateDetector()
        for file_node in files:
            detector.add_file(file_node)
        
        exact = detector.detect_exact_duplicates()
        near = detector.detect_near_duplicates()
        
        print(f"Exact duplicate groups: {len(exact)}")
        print(f"Near duplicate groups: {len(near)}")
        
        dup_stats = detector.get_statistics()
        print(f"Potential savings: {dup_stats['potential_savings_mb']:.2f} MB")
        
        if exact:
            print("\nTop exact duplicate groups:")
            for i, (gid, group) in enumerate(list(exact.items())[:3], 1):
                print(f"  {i}. {len(group.files)} files, {group.wastage / 1024:.1f} KB wasted")
                for f in group.files[:2]:
                    print(f"     - {f.name}")
        
        # STEP 3: Organization suggestions
        print()
        print("=" * 60)
        print("STEP 3: AI Organization suggestions...")
        print("-" * 60)
        print("(Requires MISTRAL_API_KEY in .env)")
        print("Use API endpoint: POST /api/scans/{id}/organize")
        print()
        
        # STEP 4: Export results
        print()
        print("=" * 60)
        print("STEP 4: Exporting results...")
        print("-" * 60)
        
        # Save tree
        tree_file = Path("scan_tree.json")
        with open(tree_file, 'w') as f:
            json.dump(tree.to_dict(), f, indent=2, default=str)
        print(f"Tree: {tree_file}")
        
        # Save duplicates
        dup_file = Path("duplicates.json")
        dup_data = {
            'statistics': dup_stats,
            'exact_duplicates': {k: v.to_dict() for k, v in exact.items()},
            'near_duplicates': {k: v.to_dict() for k, v in near.items()}
        }
        with open(dup_file, 'w') as f:
            json.dump(dup_data, f, indent=2, default=str)
        print(f"Duplicates: {dup_file}")
        
        print()
        print("=" * 60)
        print("✓ Analysis complete")
        print("=" * 60)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def server_mode():
    """Run in API server mode."""
    import uvicorn
    
    print("=" * 60)
    print("DirStudio API Server")
    print("=" * 60)
    print()
    print("Starting server on http://0.0.0.0:8000")
    print("API docs available at http://0.0.0.0:8000/docs")
    print()
    print("Make sure to set MISTRAL_API_KEY in .env for AI features")
    print()
    
    # Import here to avoid issues
    # try:
    from api.api import app
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
    # except ImportError as e:
    #     print(f"Error importing API: {e}")
    #     print("Make sure you're in the correct directory")
    #     sys.exit(1)


def main():
    """Main entry point."""
    
    # Check for server mode flag
    if len(sys.argv) > 1 and sys.argv[1] in ('--server', '-s', 'server'):
        server_mode()
    elif len(sys.argv) > 1 and sys.argv[1] in ('--help', '-h'):
        print("DirStudio - Directory Intelligence System")
        print()
        print("Usage:")
        print("  python main.py [path]           # CLI mode: scan directory")
        print("  python main.py --server         # Start API server")
        print("  python main.py --help           # Show this help")
        print()
        print("CLI mode examples:")
        print("  python main.py                  # Scan current directory")
        print("  python main.py /path/to/scan    # Scan specific directory")
        print()
        print("Server mode:")
        print("  python main.py --server")
        print("  API docs: http://localhost:8000/docs")
        print()
        print("Environment variables (.env):")
        print("  MISTRAL_API_KEY - Required for AI organization")
        print("  DATABASE_URL - Database connection (default: sqlite)")
    else:
        # CLI mode
        test_path = sys.argv[1] if len(sys.argv) > 1 else "."
        cli_mode(test_path)


if __name__ == "__main__":
    main()