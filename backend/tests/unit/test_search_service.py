from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from apps.api.app.schemas.search import SearchRequest
from apps.api.app.services.search_service import SearchService


@pytest.mark.asyncio
async def test_extra_filter_cannot_replace_authorized_document_ids():
    authorized_document_id = uuid.uuid4()
    retriever = MagicMock()
    retriever.retrieve.return_value = ([], MagicMock())
    service = SearchService(session=AsyncMock(), retriever=retriever)
    service.doc_repo.get_allowed_document_ids = AsyncMock(
        return_value=[authorized_document_id]
    )
    user = MagicMock(id=uuid.uuid4(), roles=[])

    await service.search(
        SearchRequest(
            query="What does the document say?",
            filters={
                "extra": {
                    "authorized_document_ids": ["unauthorized-document"],
                }
            },
        ),
        current_user=user,
    )

    search_filters = retriever.retrieve.call_args.kwargs["filters"]
    assert search_filters["authorized_document_ids"] == [str(authorized_document_id)]
