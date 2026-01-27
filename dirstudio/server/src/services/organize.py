"""
Intelligent file organization service.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import config
from core.filesystem import FileNode
from core.metadata import FileType


@dataclass
class OrganizationRule:
    """Organization rule definition."""
    
    name: str
    pattern: str
    condition: str
    value: any
    description: str = ""
    
    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'pattern': self.pattern,
            'condition': self.condition,
            'value': str(self.value),
            'description': self.description
        }


@dataclass
class OrganizationSuggestion:
    """Organization suggestion for files."""
    
    files: list[FileNode]
    target_path: str
    reason: str
    rule_name: str
    confidence: float = 1.0
    
    def to_dict(self) -> dict:
        return {
            'file_count': len(self.files),
            'files': [str(f.path) for f in self.files],
            'target_path': self.target_path,
            'reason': self.reason,
            'rule_name': self.rule_name,
            'confidence': self.confidence
        }


class Organizer:
    """
    Intelligent file organization system.
    """
    
    def __init__(self, base_path: str):
        self.base_path = Path(base_path)
        self.rules: list[OrganizationRule] = []
        self.suggestions: list[OrganizationSuggestion] = []
    
    def add_rule(self, rule: OrganizationRule) -> None:
        """Add an organization rule."""
        self.rules.append(rule)
    
    def create_default_rules(self) -> None:
        """Create default organization rules."""
        self.rules = [
            OrganizationRule(
                name="organize_by_type",
                pattern="{category}/{filename}",
                condition="category",
                value="*",
                description="Organize by file type category"
            ),
            OrganizationRule(
                name="organize_images_by_date",
                pattern="Images/{year}/{month}/{filename}",
                condition="category",
                value="image",
                description="Organize images by date"
            ),
            OrganizationRule(
                name="organize_by_extension",
                pattern="{extension}/{filename}",
                condition="extension",
                value="*",
                description="Organize by file extension"
            )
        ]
    
    def _categorize_by_type(self, files: list[FileNode]) -> dict[str, list[FileNode]]:
        """Group files by type."""
        categories = defaultdict(list)
        
        for file_node in files:
            category = file_node.metadata.filetype.value
            categories[category].append(file_node)
        
        return dict(categories)
    
    def _categorize_by_extension(self, files: list[FileNode]) -> dict[str, list[FileNode]]:
        """Group files by extension."""
        extensions = defaultdict(list)
        
        for file_node in files:
            ext = file_node.path.suffix or 'no_extension'
            extensions[ext].append(file_node)
        
        return dict(extensions)
    
    def _categorize_by_size(self, files: list[FileNode]) -> dict[str, list[FileNode]]:
        """Group files by size."""
        sizes = {
            'tiny': [],      # < 1KB
            'small': [],     # 1KB - 1MB
            'medium': [],    # 1MB - 100MB
            'large': [],     # 100MB - 1GB
            'huge': []       # > 1GB
        }
        
        for file_node in files:
            size = file_node.size
            if size < 1024:
                sizes['tiny'].append(file_node)
            elif size < 1024 * 1024:
                sizes['small'].append(file_node)
            elif size < 100 * 1024 * 1024:
                sizes['medium'].append(file_node)
            elif size < 1024 * 1024 * 1024:
                sizes['large'].append(file_node)
            else:
                sizes['huge'].append(file_node)
        
        return {k: v for k, v in sizes.items() if v}
    
    def _categorize_by_date(self, files: list[FileNode]) -> dict[str, list[FileNode]]:
        """Group files by date."""
        dates = defaultdict(list)
        
        for file_node in files:
            modified = file_node.metadata.time.get('MODIFIED')
            if modified and modified != 'unknown':
                try:
                    dt = datetime.fromisoformat(modified)
                    key = f"{dt.year}/{dt.month:02d}"
                    dates[key].append(file_node)
                except (ValueError, AttributeError):
                    continue
        
        return dict(dates)
    
    def suggest_by_category(self, files: list[FileNode]) -> list[OrganizationSuggestion]:
        """Suggest organizing by category."""
        suggestions = []
        categories = self._categorize_by_type(files)
        
        for category, cat_files in categories.items():
            if len(cat_files) < 3:
                continue
            
            target = self.base_path / category.replace('_file', '').title()
            suggestion = OrganizationSuggestion(
                files=cat_files,
                target_path=str(target),
                reason=f"Group {len(cat_files)} {category.replace('_file', '')} files",
                rule_name="organize_by_category",
                confidence=0.9
            )
            suggestions.append(suggestion)
        
        return suggestions
    
    def suggest_by_date(self, files: list[FileNode]) -> list[OrganizationSuggestion]:
        """Suggest organizing images by date."""
        suggestions = []
        
        # Only for images
        image_files = [
            f for f in files 
            if f.metadata.filetype == FileType.IMAGE
        ]
        
        if not image_files:
            return suggestions
        
        dates = self._categorize_by_date(image_files)
        
        for date_key, date_files in dates.items():
            if len(date_files) < 5:
                continue
            
            target = self.base_path / "Images" / date_key
            suggestion = OrganizationSuggestion(
                files=date_files,
                target_path=str(target),
                reason=f"Group {len(date_files)} images from {date_key}",
                rule_name="organize_images_by_date",
                confidence=0.85
            )
            suggestions.append(suggestion)
        
        return suggestions
    
    def suggest_organization(self, files: list[FileNode]) -> list[OrganizationSuggestion]:
        """
        Generate all organization suggestions.
        
        Args:
            files: List of file nodes
        
        Returns:
            List of organization suggestions
        """
        self.suggestions.clear()
        
        # Category-based
        self.suggestions.extend(self.suggest_by_category(files))
        
        # Date-based for images
        self.suggestions.extend(self.suggest_by_date(files))
        
        # Sort by confidence
        self.suggestions.sort(key=lambda s: s.confidence, reverse=True)
        
        return self.suggestions
    
    def get_statistics(self, files: list[FileNode]) -> dict:
        """Get organization statistics."""
        categories = self._categorize_by_type(files)
        extensions = self._categorize_by_extension(files)
        sizes = self._categorize_by_size(files)
        
        return {
            'total_files': len(files),
            'categories': {k: len(v) for k, v in categories.items()},
            'top_extensions': sorted(
                [(k, len(v)) for k, v in extensions.items()],
                key=lambda x: x[1],
                reverse=True
            )[:10],
            'size_distribution': {k: len(v) for k, v in sizes.items()},
            'suggestions_count': len(self.suggestions)
        }
    
    def generate_report(self, files: list[FileNode]) -> dict:
        """Generate comprehensive organization report."""
        suggestions = self.suggest_organization(files)
        stats = self.get_statistics(files)
        
        return {
            'statistics': stats,
            'suggestions': [s.to_dict() for s in suggestions],
            'rules': [r.to_dict() for r in self.rules]
        }