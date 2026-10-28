"""Validated content and revision contracts for the PPT workbench."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Style = Literal["paper", "dark", "minimal", "business", "tech", "kids"]
Status = Literal["idle", "outline", "generating", "revising", "exporting", "failed"]


class Slide(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=4000)
    svg: str | None = Field(default=None, max_length=102400)


class CreateDeck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    brief: str = Field(default="", max_length=12000)
    audience: str = Field(default="", max_length=120)
    style: Style = "paper"
    page_count: int = Field(default=8, ge=1, le=20)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("title must not be blank")
        return value.strip()


class SaveDeck(CreateDeck):
    revision: int = Field(ge=1)
    slides: list[Slide] = Field(max_length=20)

    @model_validator(mode="after")
    def unique_slides(self) -> SaveDeck:
        ids = [slide.slide_id for slide in self.slides]
        if len(ids) != len(set(ids)):
            raise ValueError("slide ids must be unique")
        return self


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=1)
    action: Literal["outline", "generate", "compose", "revise", "export"]
    page_id: str | None = Field(default=None, max_length=64)
    instruction: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def revision_requires_page(self) -> JobRequest:
        if self.action == "revise" and (not self.page_id or not (self.instruction or "").strip()):
            raise ValueError("page_id and instruction are required to revise a slide")
        return self


class Deck(CreateDeck):
    deck_id: str
    agent_id: str
    owner_user_id: int
    slides: list[Slide] = Field(default_factory=list, max_length=20)
    revision: int = 1
    status: Status = "idle"
    error: str | None = None
    export_path: str | None = None
    updated_at: int


class ChatTurn(BaseModel):
    """One persisted exchange in the deck-bound workbench conversation."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=8000)
    action: str | None = Field(default=None, max_length=32)
    at: int = Field(ge=0)


class ChatLog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatTurn] = Field(default_factory=list, max_length=200)


class ChatRequest(BaseModel):
    """One user message for the conversational orchestrator."""

    model_config = ConfigDict(extra="forbid")

    deck_id: str | None = Field(default=None, max_length=64)
    message: str = Field(min_length=1, max_length=4000)


class ChatOutcome(BaseModel):
    reply: str = Field(max_length=8000)
    action: str = Field(max_length=32)
    deck: Deck | None = None
