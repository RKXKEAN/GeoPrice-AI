import time
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings

logger = logging.getLogger(__name__)

# Convert postgres:// to postgresql:// if needed for SQLAlchemy 2.0
db_url = settings.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    db_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Dependency for obtaining database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db(max_retries: int = 5, retry_interval: int = 2):
    """
    Creates database tables on startup.
    Includes retry logic in case the database container is still initializing.
    """
    retries = 0
    while retries < max_retries:
        try:
            logger.info("Initializing database tables...")
            # Import models so Base.metadata knows about them
            import app.models  # noqa: F401
            Base.metadata.create_all(bind=engine)
            logger.info("Database tables initialized successfully.")
            return
        except Exception as e:
            retries += 1
            logger.warning(f"Database connection attempt {retries}/{max_retries} failed: {e}")
            if retries >= max_retries:
                logger.error("Could not connect to database after maximum retries.")
                raise e
            time.sleep(retry_interval)
