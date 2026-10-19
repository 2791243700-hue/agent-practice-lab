from urllib.parse import urlsplit


def basic_chat_options(base_url: str) -> dict:
    """Use standard, non-thinking tool turns for the introductory curriculum."""
    url = urlsplit(base_url)
    if url.scheme == "https" and url.hostname == "api.deepseek.com":
        return {"thinking": {"type": "disabled"}}
    return {}
