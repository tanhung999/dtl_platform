"""One accent-insensitive normalization contract for Notes and Calendar search."""
import unicodedata

def fold_text(value: str | None) -> str:
    value = unicodedata.normalize("NFD", (value or "").casefold().replace("đ", "d"))
    return "".join(char for char in value if unicodedata.category(char) != "Mn").strip()
