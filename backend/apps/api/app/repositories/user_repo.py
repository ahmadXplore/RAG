"""User and Role repository."""
import uuid
from collections.abc import Sequence

from apps.api.app.models.user import Role, User, user_roles
from apps.api.app.repositories.base import BaseRepository
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession):
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> User | None:
        """Fetch user by unique email address case-insensitively."""
        query = select(User).where(User.email.ilike(email.strip())).options(selectinload(User.roles))
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_with_roles(self, user_id: uuid.UUID) -> User | None:
        """Fetch user with eager-loaded roles."""
        query = select(User).where(User.id == user_id).options(selectinload(User.roles))
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_role_by_name(self, name: str) -> Role | None:
        """Fetch role by name (e.g., ADMIN, ANALYST, VIEWER) case-insensitively."""
        query = select(Role).where(Role.name.ilike(name))
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def list_roles(self) -> Sequence[Role]:
        """List all defined roles."""
        query = select(Role)
        result = await self.session.execute(query)
        return result.scalars().all()

    async def list_paginated(
        self,
        search: str | None = None,
        role: str | None = None,
        is_active: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[Sequence[User], int]:
        """Fetch users with filtering, search, pagination, and total count."""
        query = select(User).options(selectinload(User.roles))
        count_query = select(func.count(func.distinct(User.id)))

        conditions = []
        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(or_(User.email.ilike(term), User.full_name.ilike(term)))

        if is_active is not None:
            conditions.append(User.is_active == is_active)

        if role and role.strip() and role.lower() != "all":
            query = query.join(User.roles).where(Role.name.ilike(role.strip()))
            count_query = count_query.join(User.roles).where(Role.name.ilike(role.strip()))

        if conditions:
            query = query.where(*conditions)
            count_query = count_query.where(*conditions)

        total_res = await self.session.execute(count_query)
        total = total_res.scalar_one() or 0

        query = query.order_by(User.created_at.desc()).limit(limit).offset(offset)
        res = await self.session.execute(query)
        return res.scalars().all(), total

    async def get_global_stats(self) -> dict[str, int]:
        """Get aggregate counts for accounts, active users, blocked users, and admins."""
        total_q = await self.session.execute(select(func.count(User.id)))
        total_accounts = total_q.scalar_one() or 0

        active_q = await self.session.execute(select(func.count(User.id)).where(User.is_active == True))  # noqa: E712
        active_users = active_q.scalar_one() or 0

        blocked_users = total_accounts - active_users

        admin_q = await self.session.execute(
            select(func.count(func.distinct(User.id)))
            .join(User.roles)
            .where(Role.name.ilike("ADMIN"))
        )
        admin_users = admin_q.scalar_one() or 0

        return {
            "total_accounts": total_accounts,
            "active_users": active_users,
            "blocked_users": blocked_users,
            "admin_users": admin_users,
        }

    async def list_all(self, limit: int = 100, offset: int = 0) -> Sequence[User]:
        """Fetch all users ordered by creation date."""
        query = (
            select(User)
            .options(selectinload(User.roles))
            .order_by(User.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(query)
        return result.scalars().all()

