"""
Configuration constants for DirStudio.
"""
from pathlib import Path

# Exclude patterns for scanning
EXCLUDE_PATTERNS = {
    '.git',
    '.svn',
    '__pycache__',
    'node_modules',
    '.venv',
    'venv',
    '.pytest_cache',
    '.ruff_cache',
    'dist',
    'build',
}

# File extensions by category
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'}
VIDEO_EXTS = {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webm'}
AUDIO_EXTS = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'}
DOCUMENT_EXTS = {'.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'}
CODE_EXTS = {'.py', '.js', '.ts', '.java', '.c', '.cpp', '.go', '.rs', '.rb'}
ARCHIVE_EXTS = {'.zip', '.tar', '.gz', '.7z', '.rar'}

# Hash settings
SHA256_CHUNK_SIZE = 8192  # 8KB chunks for streaming
PHASH_SIZE = 8  # 8x8 = 64-bit perceptual hash

# Similarity thresholds (Hamming distance for 64-bit phash)
PHASH_DUPLICATE_THRESHOLD = 10  # Near duplicates
PHASH_SIMILAR_THRESHOLD = 15    # Similar images

# Performance settings
DEFAULT_WORKERS = 4
MAX_QUEUE_SIZE = 10000

# Scan mode thresholds
SEMAPHORE_FILE_LIMIT = 10000  # Use shared tree below this

# Database
DATABASE_URL = 'sqlite:///dirstudio.db'