import { shell } from "electron";
import { log } from "./log";

const opened = [],
  all = [];
export function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve();
  if (process.env.CZ_TEST_HOOKS === "1") {
    opened.push(url);
    all.push(url);
    log("external (test, not opened):", url.slice(0, 160));
    return Promise.resolve();
  }
  return shell.openExternal(url);
}
export function takeOpened() {
  return opened.splice(0, opened.length);
}
export function openedSoFar() {
  return all.slice();
}
