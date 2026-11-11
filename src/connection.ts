import { checkConnection, fetchInfo } from './api';
import type { ObjectInfo } from './domain';
import { idbGet, idbSet } from './storage';

function valid(info: ObjectInfo | undefined | null): info is ObjectInfo {
  return !!info && Object.values(info).some((node) => node?.input);
}

// A cache never proves connectivity. Only a successful live queue response can
// make a cached schema ready. A fresh schema always wins over a late IDB read.
export function startConnection(
  base: string,
  handlers: { ready: (info: ObjectInfo) => void; error: (error: Error) => void },
  refresh = false,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const key = 'cm-info-cache:' + base;
  let schema: ObjectInfo | undefined;
  let fresh = false;
  let reachable = false;
  let failed = false;
  const publish = () => {
    if (!signal.aborted && !failed && reachable && schema) handlers.ready(schema);
  };
  const health = checkConnection(base, signal).then(() => {
    reachable = true;
    publish();
  });
  const cached = idbGet<ObjectInfo>(key).then((value) => {
    if (!fresh && valid(value)) {
      schema = value;
      publish();
    }
  });
  const update = fetchInfo(base, signal, refresh).then((value) => {
    if (!valid(value)) throw new Error('ComfyUI 노드 정보를 확인해 주세요');
    fresh = true;
    schema = value;
    publish();
    if (!signal.aborted) void idbSet(key, value).catch(() => {});
  });
  void health.catch((error) => {
    failed = true;
    if (!signal.aborted) handlers.error(error);
    controller.abort();
  });
  void update.catch(async (error) => {
    await cached;
    // Keep a usable cache when the server is live but schema refresh failed.
    if (!schema && !signal.aborted && !failed) {
      failed = true;
      handlers.error(error);
    }
  });
  return () => controller.abort();
}
