"""
Database schema definitions using SQLAlchemy ORM.
Simplified - only essential fields.
"""
from sqlalchemy import Column, Integer, String, BigInteger, Text, Index, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Scan(Base):
    """
    Scan record - represents a directory scan.
    """
    __tablename__ = 'scans'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(String(36), unique=True, nullable=False, index=True)  # UUID
    path = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default='pending')  # pending, running, completed, failed
    
    # Results (computed from tree)
    total_files = Column(Integer, default=0)
    total_dirs = Column(Integer, default=0)
    total_size = Column(BigInteger, default=0)
    tree_depth = Column(Integer, default=0)  # Changed from 'depth' to 'tree_depth'
    
    # Store complete tree as JSON
    tree_json = Column(Text, nullable=True)  # Serialized tree.to_dict()
    
    # Error tracking
    error = Column(Text, nullable=True)
    
    # Relationships
    files = relationship("File", back_populates="scan", cascade="all, delete-orphan")
    duplicate_groups = relationship("DuplicateGroup", back_populates="scan", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_scan_status', 'status'),
    )


class File(Base):
    """
    File record - stores file metadata and hashes.
    """
    __tablename__ = 'files'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey('scans.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Path and identification
    path = Column(Text, nullable=False)
    name = Column(String(255), nullable=False)
    extension = Column(String(50))
    
    # Core metadata
    size = Column(BigInteger, nullable=False)
    mime_type = Column(String(100))
    file_type = Column(String(50))  # image_file, text_file, etc.
    
    # Hashes
    sha256 = Column(String(64), index=True)
    phash = Column(String(20), index=True)
    
    # Duplicate grouping
    duplicate_group_id = Column(Integer, ForeignKey('duplicate_groups.id', ondelete='SET NULL'), nullable=True)
    
    # Relationships
    scan = relationship("Scan", back_populates="files")
    duplicate_group = relationship("DuplicateGroup", back_populates="files")
    
    __table_args__ = (
        Index('idx_file_sha256', 'sha256'),
        Index('idx_file_phash', 'phash'),
        Index('idx_file_type', 'file_type'),
    )


class DuplicateGroup(Base):
    """
    Duplicate group - groups duplicate or similar files.
    """
    __tablename__ = 'duplicate_groups'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey('scans.id', ondelete='CASCADE'), nullable=False, index=True)
    group_id = Column(String(50), nullable=False, index=True)  # e.g., "exact_abc123"
    
    # Group metadata
    duplicate_type = Column(String(20), nullable=False)  # exact, near
    file_count = Column(Integer, default=0)
    total_size = Column(BigInteger, default=0)
    wastage = Column(BigInteger, default=0)  # Bytes that could be saved
    
    # Relationships
    scan = relationship("Scan", back_populates="duplicate_groups")
    files = relationship("File", back_populates="duplicate_group")
    