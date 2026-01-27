"""
DirStudio main entry point with full analysis pipeline.
"""
import json
import sys
from pathlib import Path

from services.scan import Scanner
from services.duplicate import DuplicateDetector
from services.organize import Organizer


def main():
    """Main entry point."""
    
    test_path = "."
    
    if len(sys.argv) > 1:
        test_path = sys.argv[1]
    
    print("=" * 60)
    print("DirStudio - Directory Intelligence System")
    print("=" * 60)
    print()
    
    # STEP 1: Scan directory
    print("STEP 1: Scanning directory...")
    print("-" * 60)
    
    scanner = Scanner(
        max_depth=5,
        num_workers=4
    )
    
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
        print("STEP 3: Organization suggestions...")
        print("-" * 60)
        
        organizer = Organizer(test_path)
        organizer.create_default_rules()
        
        report = organizer.generate_report(files)
        
        print(f"\nFile categories:")
        for cat, count in report['statistics']['categories'].items():
            print(f"  {cat}: {count}")
        
        print(f"\nSuggestions: {len(report['suggestions'])}")
        for i, sug in enumerate(report['suggestions'][:3], 1):
            print(f"  {i}. {sug['reason']}")
            print(f"     Confidence: {sug['confidence']:.0%}")
        
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
        
        # Save organization report
        org_file = Path("organization_report.json")
        with open(org_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        print(f"Organization: {org_file}")
        
        print()
        print("=" * 60)
        print("✓ Analysis complete")
        print("=" * 60)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()