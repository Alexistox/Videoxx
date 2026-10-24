import { useEffect, useState } from "react";
import { api, on } from "../lib/api";

let cur = null;
const subs = new Set();
const set = (p) => {
  cur = p;
  subs.forEach((f) => f(p));
};
let started = false;
function start() {
  if (started) return;
  started = true;
  api
    .plan()
    .then(set)
    .catch(() => {});
  on("plan:changed", set);
}
export function usePlan() {
  start();
  const [p, setP] = useState(cur);
  useEffect(() => {
    subs.add(setP);
    if (cur) setP(cur);
    return () => {
      subs.delete(setP);
    };
  }, []);
  return p;
}
export const isStandard = (p) => p?.plan === "standard";
export const PREMIUM_PAGES = new Set(["routines", "youtube"]);
export const premiumMsg = (what) => `${what} is a Premium feature.`;
export const exportsLeft = (p) => (p && p.exportsLimit != null ? Math.max(0, p.exportsLimit - p.exportsUsed) : null);
