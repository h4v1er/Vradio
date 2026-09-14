// 轻量 HTTP 客户端:/api 前缀 + JSON + 非 2xx 抛出带服务端 error 的异常
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败(${res.status})`);
  }
  return data;
}

export const http = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
};
