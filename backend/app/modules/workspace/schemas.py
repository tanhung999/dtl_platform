from pydantic import BaseModel, ConfigDict, Field, field_validator


class LayoutWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(max_length=1000)
    expected_version: int = Field(ge=0)
    pin_changes: dict[str, bool] = Field(default_factory=dict, max_length=1000)

    @field_validator("ids")
    @classmethod
    def unique_ids(cls, values):
        if len(values) != len(set(values)) or any(not value or len(value) > 80 for value in values):
            raise ValueError("Danh sách thứ tự không hợp lệ.")
        return values


class LayoutResponse(BaseModel):
    ids: list[str]
    version: int
