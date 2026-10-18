const fail = (status: number, code: string, message: string) =>
  Response.json(
    {
      error: {
        code,
        message,
        request_id: "web-proxy",
        retryable: status === 503,
        fields: [],
      },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export async function proxy(
  request: Request,
  segments: string[],
): Promise<Response> {
  const frontend = new URL(
    process.env.AGENT_SCHOOL_FRONTEND_ORIGIN ?? "http://127.0.0.1:3000",
  );
  // Next.js may synthesize request.url with localhost internally. The actual
  // Host header and browser Origin must match the configured public origin.
  if (request.headers.get("host") !== frontend.host)
    return fail(403, "ORIGIN_REJECTED", "请从启动器显示的本地地址访问。");
  const writing = !["GET", "HEAD"].includes(request.method);
  if (writing && request.headers.get("origin") !== frontend.origin)
    return fail(403, "ORIGIN_REJECTED", "请求来源不匹配，请从本地页面重试。");
  const token = process.env.AGENT_SCHOOL_LOCAL_TOKEN;
  if (!token)
    return fail(
      503,
      "MODEL_UNAVAILABLE",
      "本地代理尚未配置，请使用项目启动脚本。",
    );
  const upstream = new URL(
    process.env.AGENT_SCHOOL_API_ORIGIN ?? "http://127.0.0.1:8000",
  );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname) ||
    !["http:", "https:"].includes(upstream.protocol) ||
    upstream.username ||
    upstream.password
  )
    return fail(503, "INTERNAL_ERROR", "本地 API 地址配置无效。");
  if (!segments.length || segments.some((s) => !s || /[\\/.]/.test(s)))
    return fail(404, "NOT_FOUND", "接口不存在。");
  upstream.pathname = `/api/v1/${segments.map(encodeURIComponent).join("/")}`;
  upstream.search = new URL(request.url).search;
  const headers = new Headers({ "X-Local-Token": token });
  for (const name of [
    "content-type",
    "idempotency-key",
    "last-event-id",
    "origin",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    let body: Uint8Array | undefined;
    if (writing && request.body) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = request.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          return fail(413, "LIMIT_EXCEEDED", "请求内容超过大小限制。");
        }
        chunks.push(next.value);
      }
      body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      signal: request.signal,
      cache: "no-store",
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400)
      return fail(503, "INTERNAL_ERROR", "本地服务返回了意外跳转。");
    const outgoing = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-type", "content-disposition"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    let outgoingBody = response.body;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      outgoing.set("X-Accel-Buffering", "no");
      // A backend restart closes the SSE transport. Let the browser resume by
      // sequence rather than surfacing an unhandled Next.js pipe exception.
      if (response.body) {
        const reader = response.body.getReader();
        let closed = false;
        outgoingBody = new ReadableStream<Uint8Array<ArrayBuffer>>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (closed) return;
              if (next.done) {
                closed = true;
                controller.close();
              } else controller.enqueue(next.value);
            } catch {
              if (!closed) {
                closed = true;
                controller.close();
              }
            }
          },
          async cancel() {
            closed = true;
            await reader.cancel().catch(() => {});
          },
        });
      }
    }
    return new Response(outgoingBody, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return fail(
      503,
      "MODEL_UNAVAILABLE",
      "无法连接本地后端，请检查服务是否启动。",
    );
  }
}
