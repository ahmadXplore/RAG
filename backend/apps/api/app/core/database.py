"""Database connection and session management."""
from collections.abc import AsyncGenerator

from apps.api.app.config import get_settings
from apps.api.app.core.logging import logger
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

settings = get_settings()

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

# Bug fix: SQLite has a single-writer lock that causes "database is locked" errors
# under concurrent async requests. Fix this with two complementary settings:
#
# 1. pool_size=1 / NullPool for aiosqlite: aiosqlite wraps each connection in
#    its own thread, so the async engine must serialise through a single
#    connection to avoid write contention. Use NullPool (no pooling) so that
#    aiosqlite manages the single underlying sqlite3 connection correctly.
#
# 2. WAL journal mode + busy_timeout: even with NullPool, pragma WAL allows
#    concurrent readers and a single writer; busy_timeout=5000 ms makes writers
#    retry instead of immediately raising OperationalError.
#
# In production (PostgreSQL/MySQL) none of these SQLite workarounds apply.

if _is_sqlite:
    from sqlalchemy.pool import QueuePool

    engine: AsyncEngine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        future=True,
        connect_args={
            "check_same_thread": False,
            "timeout": 30,  # SQLite connection-level busy timeout in seconds
        },
        pool_size=10,
        max_overflow=20,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_connect(dbapi_conn, _connection_record):
        """Enable WAL mode, busy timeout, and normal synchronous on every SQLite connection."""
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

else:
    engine: AsyncEngine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        future=True,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides an async SQLAlchemy session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_db_health() -> bool:
    """Execute a simple query to verify database connectivity."""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as e:
        logger.error(f"Database health check failed: {str(e)}")
        return False
