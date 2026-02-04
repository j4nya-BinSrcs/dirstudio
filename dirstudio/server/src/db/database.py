"""
Database connection and session management.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from typing import Generator
import os

from .schema import Base
import config


class Database:
    """Database connection manager."""
    
    def __init__(self, database_url: str = None):
        """
        Initialize database connection.
        
        Args:
            database_url: SQLAlchemy database URL (defaults to config)
        """
        self.database_url = database_url or os.getenv('DATABASE_URL', config.DATABASE_URL)
        
        # Create engine
        self.engine = create_engine(
            self.database_url,
            echo=False,
            pool_pre_ping=True,  # Verify connections before using
            pool_size=5,
            max_overflow=10
        )
        
        # Create session factory
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine
        )
    
    def create_tables(self):
        """Create all tables in the database."""
        Base.metadata.create_all(bind=self.engine)
        print("✓ Database tables created")
    
    def drop_tables(self):
        """Drop all tables from the database."""
        Base.metadata.drop_all(bind=self.engine)
        print("✓ Database tables dropped")
    
    def reset_database(self):
        """Drop and recreate all tables."""
        print("Resetting database...")
        self.drop_tables()
        self.create_tables()
        print("✓ Database reset complete")
    
    def get_session(self) -> Session:
        """
        Get a new database session.
        
        Returns:
            SQLAlchemy Session instance
        """
        return self.SessionLocal()
    
    @contextmanager
    def session_scope(self) -> Generator[Session, None, None]:
        """
        Provide a transactional scope for database operations.
        
        Usage:
            with db.session_scope() as session:
                session.add(obj)
                # Automatically commits on success, rolls back on error
        
        Yields:
            SQLAlchemy Session instance
        """
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


# Global database instance
db = Database()


def get_db() -> Generator[Session, None, None]:
    """
    Dependency for FastAPI to get database session.
    
    Usage in FastAPI:
        @app.get("/items")
        def get_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    
    Yields:
        Database session
    """
    session = db.get_session()
    try:
        yield session
    finally:
        session.close()


def init_db():
    """Initialize database tables."""
    db.create_tables()


def reset_db():
    """Reset database (drop and recreate all tables)."""
    db.reset_database()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == 'reset':
            reset_db()
        elif sys.argv[1] == 'init':
            init_db()
        else:
            print("Usage: python database.py [init|reset]")
    else:
        init_db()
