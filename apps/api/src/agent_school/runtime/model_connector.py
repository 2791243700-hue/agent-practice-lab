import asyncio
import json

import httpx

from agent_school.contracts import ModelAccess
from agent_school.errors import AppError
from agent_school.runtime.provider_options import basic_chat_options


class ModelConnector:
    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client

    async def list_models(self, access: ModelAccess):
        client = self.client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        secret = access.api_key.get_secret_value()
        try:
            response = await client.get(
                access.base_url.rstrip("/") + "/models",
                headers={"Authorization": "Bearer " + secret},
                follow_redirects=False,
            )
            if response.status_code in (401, 403):
                raise AppError("MODEL_AUTH_FAILED", "服务商未接受这个 Key，请核对服务商和凭据。", 401)
            if response.status_code in (404, 405, 501):
                raise AppError(
                    "MODEL_CATALOG_UNSUPPORTED", "该接口不提供模型列表，可选择兼容接口并手动填写模型。"
                )
            if response.status_code >= 500 or response.status_code == 429:
                raise AppError("MODEL_UNAVAILABLE", "暂时无法获取模型列表，请稍后重试。", 503, True)
            if response.status_code != 200 or len(response.content) > 2_000_000:
                raise ValueError()
            data = response.json()["data"]
            if not isinstance(data, list):
                raise ValueError()
            models = {}
            for item in data:
                if not isinstance(item, dict):
                    continue
                model = item.get("id")
                if not isinstance(model, str) or not model.strip() or len(model) > 200 or secret in model:
                    continue
                if any(ord(char) < 32 or ord(char) == 127 for char in model):
                    continue
                value = {"id": model}
                if isinstance(item.get("name"), str):
                    value["name"] = item["name"].replace(secret, "[redacted]")[:200]
                models[model] = value
            if not models:
                raise ValueError()
            return {"items": [models[key] for key in sorted(models)[:1000]], "source": "provider"}
        except AppError:
            raise
        except (httpx.TimeoutException, TimeoutError):
            raise AppError("MODEL_TIMEOUT", "获取模型列表超时，请稍后重试。", 504, True) from None
        except httpx.RequestError:
            raise AppError("MODEL_UNAVAILABLE", "无法连接选定的模型服务商。", 503, True) from None
        except (ValueError, KeyError, TypeError, IndexError):
            raise AppError(
                "MODEL_CATALOG_INVALID", "服务商未返回有效的可选模型；兼容接口可改为手动指定模型。"
            ) from None
        finally:
            if self.client is None:
                await client.aclose()

    async def check(self, access: ModelAccess):
        from agent_school.service import now

        client = self.client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        result = {
            "status": "failed",
            "text_ok": False,
            "tools_ok": False,
            "error_code": None,
            "message": "连接检查未通过。",
            "checked_at": now(),
        }

        async def request(body):
            response = await client.post(
                access.base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": "Bearer " + access.api_key.get_secret_value()},
                json={"model": access.model, "stream": False, **basic_chat_options(access.base_url), **body},
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            if not isinstance(message, dict):
                raise ValueError()
            return message

        try:
            async with asyncio.timeout(30):
                first = await request({"messages": [{"role": "user", "content": "回复 ok。"}]})
                if not isinstance(first.get("content"), str) or not first["content"].strip():
                    raise ValueError()
                result["text_ok"] = True
                tools = [
                    {
                        "type": "function",
                        "function": {
                            "name": "connection_probe",
                            "description": "无副作用的连接检查",
                            "parameters": {
                                "type": "object",
                                "properties": {"value": {"type": "string", "enum": ["ok"]}},
                                "required": ["value"],
                                "additionalProperties": False,
                            },
                        },
                    }
                ]
                messages = [{"role": "user", "content": "调用 connection_probe，value 为 ok。"}]
                second = await request(
                    {
                        "messages": messages,
                        "tools": tools,
                        "tool_choice": {"type": "function", "function": {"name": "connection_probe"}},
                    }
                )
                calls = second.get("tool_calls", [])
                if len(calls) != 1 or calls[0]["function"]["name"] != "connection_probe":
                    raise ValueError()
                call = calls[0]
                if json.loads(call["function"]["arguments"]) != {"value": "ok"} or not call.get("id"):
                    raise ValueError()
                final = await request(
                    {
                        "messages": messages
                        + [second, {"role": "tool", "tool_call_id": call["id"], "content": '{"ok":true}'}]
                    }
                )
                if not isinstance(final.get("content"), str) or not final["content"].strip():
                    raise ValueError()
                result.update(status="passed", tools_ok=True, message="文本与工具调用检查通过。")
        except httpx.HTTPStatusError as exc:
            result["error_code"] = (
                "MODEL_AUTH_FAILED" if exc.response.status_code in (401, 403) else "MODEL_UNAVAILABLE"
            )
        except (httpx.TimeoutException, TimeoutError):
            result["error_code"] = "MODEL_TIMEOUT"
        except (ValueError, KeyError, TypeError, IndexError):
            result["error_code"] = "MODEL_INCOMPATIBLE"
        except Exception:
            result["error_code"] = "MODEL_UNAVAILABLE"
        finally:
            if self.client is None:
                await client.aclose()
        if result["error_code"]:
            messages = {
                "MODEL_AUTH_FAILED": "认证失败，请检查 Key 和接口地址。",
                "MODEL_TIMEOUT": "连接超时，请稍后重试。",
                "MODEL_INCOMPATIBLE": "该连接未能完成标准文本与工具调用，请检查模型兼容性。",
                "MODEL_UNAVAILABLE": "模型服务暂不可用，请检查地址或稍后重试。",
            }
            result["message"] = messages[result["error_code"]]
        return result
