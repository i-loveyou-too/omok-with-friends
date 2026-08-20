from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class StrictMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JoinMessage(StrictMessage):
    type: Literal["join"]
    nickname: str
    character: str
    token: Optional[str] = None


class MoveMessage(StrictMessage):
    type: Literal["move"]
    row: int = Field(ge=0, le=14)
    col: int = Field(ge=0, le=14)


class ReactionMessage(StrictMessage):
    type: Literal["reaction"]
    value: str


class SimpleMessage(StrictMessage):
    type: Literal["undo_request", "rematch_request", "resign", "leave", "ping"]


class UndoResponseMessage(StrictMessage):
    type: Literal["undo_response"]
    accept: bool


ClientMessage = Union[JoinMessage, MoveMessage, ReactionMessage, SimpleMessage, UndoResponseMessage]
client_message_adapter = TypeAdapter(ClientMessage)

