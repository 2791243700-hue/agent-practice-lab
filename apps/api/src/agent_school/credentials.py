from pydantic import SecretStr

from agent_school.errors import AppError


class InMemoryCredentialStore:
    def __init__(self):
        self.values = {}

    def set(self, owner_id, profile_id, key: SecretStr):
        self.values[(owner_id, profile_id)] = key

    def get(self, owner_id, profile_id):
        value = self.values.get((owner_id, profile_id))
        if value is None:
            raise AppError("CREDENTIAL_MISSING", "请在本地设置页输入 API Key。")
        return value

    def delete(self, owner_id, profile_id):
        self.values.pop((owner_id, profile_id), None)

    def configured(self, profile_id):
        return ("local-owner", profile_id) in self.values

    def redact(self, value):
        if isinstance(value, str):
            for key in self.values.values():
                value = value.replace(key.get_secret_value(), "[redacted]")
            return value
        if isinstance(value, dict):
            return {k: self.redact(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        return value

    def clear(self):
        self.values.clear()

    def stream_piece(self, buffers, message_id, delta):
        # Keep every possible unfinished secret in memory until its suffix arrives.
        value = self.redact(buffers.get(message_id, "") + delta)
        hold = max((len(secret.get_secret_value()) - 1 for secret in self.values.values()), default=0)
        if hold == 0:
            buffers.pop(message_id, None)
            return value
        cut = max(0, len(value) - hold)
        buffers[message_id] = value[cut:]
        return value[:cut]

    def flush_stream(self, buffers, message_id):
        return self.redact(buffers.pop(message_id, ""))
