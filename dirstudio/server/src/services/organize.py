"""
AI-powered file organization using Mistral AI via LangChain.
"""
from dataclasses import dataclass
from typing import List
import json
import os

from core.filesystem import FileNode, FilesystemTree


@dataclass
class OrganizationSuggestion:
    """AI-generated organization suggestion."""
    
    target_path: str
    reason: str
    files: List[str]
    confidence: float
    
    def to_dict(self) -> dict:
        return {
            'target_path': self.target_path,
            'reason': self.reason,
            'files': self.files,
            'file_count': len(self.files),
            'confidence': self.confidence
        }


class AIOrganizer:
    """
    AI-powered file organization using Mistral via LangChain.
    Reads MISTRAL_API_KEY from environment.
    """
    
    SYSTEM_PROMPT = """You are an expert file organization assistant. Analyze the filesystem tree and suggest intelligent organization strategies.

Your task:
1. Identify patterns (file types, naming conventions, dates, projects, topics)
2. Suggest logical folder structures
3. Group related files together
4. Provide clear, actionable recommendations

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "suggestions": [
    {
      "target_path": "path/to/folder",
      "reason": "Clear explanation of why these files belong together",
      "files": ["file1.txt", "file2.pdf"],
      "confidence": 0.85
    }
  ]
}

Rules:
- confidence must be between 0.0 and 1.0
- Group files logically (by type, project, date, topic)
- Avoid over-organizing (don't create too many folders)
- target_path should be relative paths
- Be practical and user-friendly
- Base suggestions on actual file names and structure in the tree"""
    
    def __init__(self, base_path: str = ".", temperature: float = 0.7):
        """
        Initialize AI organizer with Mistral.
        
        Environment variables:
            MISTRAL_API_KEY - Mistral API key (required)
        
        Args:
            base_path: Base path for organization
            temperature: LLM temperature (0.0-1.0)
        """
        self.base_path = base_path
        self.temperature = temperature
        self.llm = self._create_llm()
    
    def _create_llm(self):
        """Create LangChain Mistral LLM."""
        try:
            from langchain_mistralai import ChatMistralAI
        except ImportError:
            raise ImportError(
                "langchain-mistralai required. Install: pip install langchain-mistralai"
            )

        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key:
            raise ValueError(
                "MISTRAL_API_KEY not found in environment variables."
            )

        # IMPORTANT: do NOT pass api_key here
        return ChatMistralAI(
            model="mistral-medium-3.1",
            temperature=self.temperature,
        )
    
    def _tree_to_compact_json(self, tree: FilesystemTree, max_depth: int = 5) -> str:
        """
        Convert filesystem tree to compact JSON representation.
        Includes file names, types, sizes, and structure.
        """
        def node_to_dict(node, current_depth=0):
            from core.filesystem import FileNode, DirNode
            
            # Limit depth to avoid token overflow
            if current_depth > max_depth:
                return None
            
            if isinstance(node, FileNode):
                return {
                    'type': 'file',
                    'name': node.name,
                    'size': node.size,
                    'file_type': node.metadata.filetype.value,
                    'extension': node.path.suffix
                }
            elif isinstance(node, DirNode):
                children = []
                
                # Add files (limit to 50 per directory)
                for child in node.files[:50]:
                    child_dict = node_to_dict(child, current_depth)
                    if child_dict:
                        children.append(child_dict)
                
                # Add subdirectories (limit to 20)
                for child in node.subdirs[:20]:
                    child_dict = node_to_dict(child, current_depth + 1)
                    if child_dict:
                        children.append(child_dict)
                
                return {
                    'type': 'dir',
                    'name': node.name,
                    'children': children
                }
            
            return None
        
        tree_dict = node_to_dict(tree.root)
        return json.dumps(tree_dict, indent=2)
    
    def _parse_llm_response(self, response: str) -> List[OrganizationSuggestion]:
        """Parse LLM JSON response into suggestions."""
        try:
            # Extract JSON from response
            response = response.strip()
            
            # Find JSON block
            start = response.find('{')
            end = response.rfind('}') + 1
            
            if start != -1 and end > start:
                json_str = response[start:end]
            else:
                json_str = response
            
            data = json.loads(json_str)
            
            suggestions = []
            for item in data.get('suggestions', []):
                suggestion = OrganizationSuggestion(
                    target_path=f"{self.base_path}/{item['target_path']}",
                    reason=item['reason'],
                    files=item['files'],
                    confidence=float(item.get('confidence', 0.8))
                )
                suggestions.append(suggestion)
            
            return suggestions
            
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"Error parsing LLM response: {e}")
            print(f"Response was: {response[:500]}...")
            return []
    
    def analyze(self, tree: FilesystemTree) -> List[OrganizationSuggestion]:
        """
        Analyze filesystem tree and generate organization suggestions.
        
        Args:
            tree: FilesystemTree to analyze
        
        Returns:
            List of organization suggestions
        """
        # Convert tree to compact JSON
        tree_json = self._tree_to_compact_json(tree)
        
        # Build prompt
        prompt = f"""Analyze this filesystem tree and suggest how to organize the files.

Filesystem Tree:
{tree_json}

Provide organization suggestions in JSON format. Focus on:
- Grouping related files
- Creating logical folder structures
- Identifying patterns in file names
- Organizing by type, date, or project

Remember: Respond ONLY with valid JSON matching the required format."""
        
        # Get LLM response using LangChain
        from langchain_core.messages import SystemMessage, HumanMessage
        
        messages = [
            SystemMessage(content=self.SYSTEM_PROMPT),
            HumanMessage(content=prompt)
        ]
        
        response = self.llm.invoke(messages)

        content = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )

        suggestions = self._parse_llm_response(content)

        return suggestions
    
    def generate_report(self, tree: FilesystemTree) -> dict:
        """
        Generate complete organization report.
        
        Args:
            tree: FilesystemTree to analyze
        
        Returns:
            Report dictionary with suggestions and statistics
        """
        suggestions = self.analyze(tree)
        
        # Get stats from tree
        stats = tree.compute_stats()
        
        return {
            'statistics': {
                'total_files': stats['total_files'],
                'total_dirs': stats['total_dirs'],
                'file_types': stats['file_types']
            },
            'suggestions': [s.to_dict() for s in suggestions],
            'ai_powered': True,
            'model': 'mistral-large-latest'
        }