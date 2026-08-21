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
    type: Literal["undo_request", "rematch_request", "spicy_curry", "resign", "leave", "ping"]


class UndoResponseMessage(StrictMessage):
    type: Literal["undo_response"]
    accept: bool


class SecretCardActionMessage(StrictMessage):
    type: Literal["card_action"]
    action: Literal["check", "call", "raise", "fold", "all_in"]
    amount: Optional[int] = None


class SecretCardSkillMessage(StrictMessage):
    type: Literal["skill_action"]
    skill: Literal["hint", "poker_face", "pressure", "risk_bet", "insurance"]


class SecretCardSimpleMessage(StrictMessage):
    type: Literal["next_round", "rematch_request", "leave", "ping"]


ClientMessage = Union[JoinMessage, MoveMessage, ReactionMessage, SimpleMessage, UndoResponseMessage]
client_message_adapter = TypeAdapter(ClientMessage)

SecretCardClientMessage = Union[
    JoinMessage,
    ReactionMessage,
    SecretCardActionMessage,
    SecretCardSkillMessage,
    SecretCardSimpleMessage,
]
secret_card_message_adapter = TypeAdapter(SecretCardClientMessage)
