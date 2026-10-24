import { useEffect, useState } from "react";
import { api, on } from "../lib/api";

const lists = new Map(),
  subs = new Map(),
  loading = new Map();
function setRefs(projectId, l) {
  lists.set(projectId, l);
  subs.get(projectId)?.forEach((f) => f(l));
}
export function putRef(projectId, r) {
  const l = lists.get(projectId) ?? [];
  setRefs(projectId, l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [...l, r]);
}
export function reloadRefs(projectId) {
  const p = api
    .refsList(projectId)
    .then((l) => {
      setRefs(projectId, l || []);
      return l || [];
    })
    .finally(() => loading.delete(projectId));
  loading.set(projectId, p);
  return p;
}
export function useRefs(projectId) {
  const [refs, set] = useState(() => lists.get(projectId) ?? null),
    [error, setError] = useState(null);
  useEffect(() => {
    const s = subs.get(projectId) ?? new Set();
    subs.set(projectId, s);
    s.add(set);
    if (lists.has(projectId)) set(lists.get(projectId));
    (loading.get(projectId) ?? reloadRefs(projectId))
      .then(() => setError(null))
      .catch((e) => {
        setError(String(e?.message || e));
        set((l) => l ?? []);
      });
    const off = on("references:changed", (p) => {
      if (p?.projectId === projectId && !loading.has(projectId)) reloadRefs(projectId).catch(() => {});
    });
    return () => {
      s.delete(set);
      off();
    };
  }, [projectId]);
  return { refs, error };
}
const thumbs = new Map();
export function refThumb(projectId, r, t, w = 320) {
  if (!r.exists || (r.kind !== "video" && r.kind !== "image" && !(r.kind === "model" && r.model?.thumb))) return Promise.resolve(null);
  const key = `${projectId}|${r.id}|${r.path}|${t == null ? "" : t.toFixed(1)}|${w}`;
  if (!thumbs.has(key))
    thumbs.set(
      key,
      api
        .refsThumb(projectId, r.id, t, w)
        .then((x) => x?.url ?? null)
        .catch(() => {
          thumbs.delete(key);
          return null;
        }),
    );
  return thumbs.get(key);
}
export function useRefThumb(projectId, r, t, w = 320) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true;
    setU(null);
    if (r)
      refThumb(projectId, r, t, w).then((x) => {
        if (live) setU(x);
      });
    return () => {
      live = false;
    };
  }, [projectId, r?.id, r?.path, r?.exists, t, w]);
  return u;
}
