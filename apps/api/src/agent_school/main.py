import asyncio
import copy
import hmac
import json
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from agent_school.config import Config
from agent_school.errors import AppError, error_body
from agent_school.service import School, fingerprint

def create_app(config: Config | None = None):
    config = config or Config.from_env()
    @asynccontextmanager
    async def lifespan(app):
        app.state.school = School(config)
        app.state.idempotency_locks = {}
        try:
            yield
        finally:
            await app.state.school.close()
    app = FastAPI(title="Agent Practice Lab",lifespan=lifespan)
    @app.middleware("http")
    async def authenticate(request, call_next):
        token = request.headers.get("X-Local-Token","")
        host = urlsplit("http://" + request.headers.get("host","")).hostname
        if host not in ("127.0.0.1","localhost","::1") or not hmac.compare_digest(token,config.local_token):
            return JSONResponse(error_body("LOCAL_TOKEN_INVALID","本地连接校验失败，请检查启动设置。"),status_code=401)
        origin = request.headers.get("origin")
        if origin and origin!=config.frontend_origin:
            return JSONResponse(error_body("ORIGIN_REJECTED","请求来源不被允许。"),status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response
    from agent_school.schema import Contracts
    contracts = Contracts(config.root)
    app.openapi = lambda: copy.deepcopy(contracts.openapi)

    def make_endpoint(operation):
        async def endpoint(request: Request):
            try:
                body = None
                if "requestBody" in operation:
                    if request.headers.get("content-type","").split(";")[0]!="application/json":
                        raise AppError()
                    buffer = bytearray()
                    async for chunk in request.stream():
                        buffer.extend(chunk)
                        if len(buffer)>65536:
                            raise AppError("LIMIT_EXCEEDED","请求内容过大。",413)
                    try:
                        body = json.loads(buffer)
                    except Exception:
                        raise AppError(message="请求不是有效的 JSON。") from None
                    schema_name = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
                    contracts.validate(schema_name,body)
                params = {}
                idem = None
                for parameter in operation.get("parameters",[]):
                    location,name,schema = parameter["in"],parameter["name"],parameter["schema"]
                    source = request.path_params if location=="path" else request.query_params if location=="query" else request.headers
                    value = source.get(name)
                    if value is None:
                        if parameter["required"]:
                            raise AppError(fields=[{"path":"/"+name,"message":"缺少必要参数。"}])
                        if "default" in schema:
                            value = schema["default"]
                        else:
                            continue
                    if schema.get("type")=="integer":
                        try:
                            if isinstance(value,str) and not value.isdecimal(): raise ValueError()
                            value = int(value)
                        except (ValueError,TypeError):
                            raise AppError() from None
                    from jsonschema import Draft202012Validator, FormatChecker
                    if list(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(value)):
                        if name in ("after_seq","Last-Event-ID"):
                            raise AppError("CURSOR_INVALID","事件位置无效。",400)
                        raise AppError()
                    if name=="Idempotency-Key": idem = value
                    if location=="query" or name=="Last-Event-ID": params[name]=value
                school = request.app.state.school
                operation_id = operation["operationId"]
                status = next(int(k) for k in operation["responses"] if k.isdigit() and int(k)<300)
                async def invoke(prepared=None):
                    result = await school.dispatch(operation_id,dict(request.path_params),params,body,prepared)
                    if isinstance(result,Response): return result
                    if status==204: return Response(status_code=204)
                    schema_name = operation["responses"][str(status)]["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
                    contracts.validate(schema_name,result,response=True)
                    return JSONResponse(result,status_code=status)
                if idem:
                    from agent_school.errors import new_id
                    key = fingerprint(["local-owner",request.method,request.url.path,idem])
                    lock = app.state.idempotency_locks.setdefault(key,asyncio.Lock())
                    if lock.locked():
                        raise AppError("IDEMPOTENCY_IN_PROGRESS","该操作正在进行，请稍后重试。",409,True)
                    async with lock:
                        old = school.store.get("idempotency",key,missing_ok=True)
                        digest = fingerprint(body)
                        if old:
                            if old["digest"]!=digest:
                                raise AppError("IDEMPOTENCY_CONFLICT","操作标识已用于不同请求。",409)
                            if old.get("pending"):
                                raise AppError("IDEMPOTENCY_IN_PROGRESS","该操作未确认结束；请检查当前状态。",409,False)
                            return JSONResponse(old["body"],status_code=old["status"])
                        if operation_id=="checkConnection":
                            school.store.put("idempotency",key,{"digest":digest,"pending":True})
                        try:
                            prepared=await school.prepare(operation_id,dict(request.path_params),params,body)
                        except BaseException:
                            if operation_id=="checkConnection":
                                school.store.remove("idempotency",key)
                            raise
                        with school.store.atomic():
                            response = await invoke(prepared)
                            if isinstance(response,JSONResponse):
                                school.store.put("idempotency",key,{"digest":digest,"status":response.status_code,
                                    "body":json.loads(response.body)})
                            return response
                prepared=await school.prepare(operation_id,dict(request.path_params),params,body)
                return await invoke(prepared)
            except AppError as error:
                return JSONResponse(error.body,status_code=error.status)
            except Exception:
                return JSONResponse(error_body("INTERNAL_ERROR","操作失败，请重试或检查本地服务。"),status_code=500)
        return endpoint
    for path,methods in contracts.openapi["paths"].items():
        for method,operation in methods.items():
            app.add_api_route("/api/v1"+path,make_endpoint(operation),methods=[method.upper()],
                             name=operation["operationId"],include_in_schema=False)
    return app

def app_factory():
    return create_app()

