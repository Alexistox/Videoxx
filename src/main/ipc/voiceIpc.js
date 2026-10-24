import path from "node:path";
import fs from "node:fs";
import { getConfig } from "../core/config";
import { FISH_MODELS, fishCredit, fishKeyStatus, fishVoiceName, fishVoices, setFishKey } from "../voice/fish";
import {
  cancelVoiceover,
  forgetInterrupted,
  interruptedJobs,
  jobOf,
  markSeen,
  projectSpeakers,
  restoreInterrupted,
  saveSpeakers,
  scriptWords,
  startVoiceover,
} from "../voice/voiceover";
import { expandDropped, probe } from "../voice/recordings";
import { elevenAccount, elevenModels, elevenVoices, keyStatus, setKey } from "../voice/elevenlabs";
import { cancelKokoroInstall, estimate, installKokoro, kokoroStatus, kokoroVoices, preview, removeKokoro } from "../voice/kokoro";

export function registerVoiceIpc(h, send, project) {
  const emitInstall = (s) => send("voice:install", s);
  restoreInterrupted();
  h("voice:status", async () => ({
    elevenlabs: keyStatus(),
    fish: fishKeyStatus(),
    kokoro: await kokoroStatus(),
    config: getConfig().voice,
  }));
  h("voice:fishSetKey", (key2) => setFishKey(key2));
  h("voice:fishVoices", (language, force) => fishVoices(String(language || "en"), !!force));
  h("voice:fishVoiceName", (id) => fishVoiceName(String(id ?? "")));
  h("voice:fishCredit", (force) => fishCredit(!!force));
  h("voice:fishModels", () => FISH_MODELS);
  h("voice:setKey", (key2) => setKey(key2));
  h("voice:account", (force) => elevenAccount(!!force));
  h("voice:elevenVoices", (force) => elevenVoices(!!force));
  h("voice:elevenModels", () => elevenModels());
  h("voice:preview", (o) => preview(o));
  h("voice:kokoroVoices", () => kokoroVoices());
  h("voice:customVoices", async (force) => (await import("../images/customProviders")).customVoices(!!force));
  h("voice:kokoroInstall", () => installKokoro(emitInstall));
  h("voice:kokoroCancel", () => cancelKokoroInstall());
  h("voice:kokoroRemove", () => removeKokoro());
  h("voice:estimate", (projectId, req) => estimate(project.dirOf(projectId), req));
  h("voice:scriptWords", (projectId) => scriptWords(project.dirOf(projectId)));
  h("voice:speakers", (projectId) => projectSpeakers(project.dirOf(projectId)));
  h("voice:setSpeakers", (projectId, provider, voices) => saveSpeakers(project.dirOf(projectId), provider, voices));
  h("voice:probe", (files) => probe(Array.isArray(files) ? files : []));
  h("voice:start", (projectId, req) => {
    if (project.busy(projectId))
      throw new Error(
        "Claude is working on this project. Make the voiceover when it has finished (or press Stop): a new voiceover changes the timing it builds to.",
      );
    return startVoiceover(
      projectId,
      project.dirOf(projectId),
      req,
      (j) => send("voice:progress", j),
      () => project.changed(projectId),
    );
  });
  h("voice:job", (projectId) => jobOf(projectId));
  h("voice:seen", (projectId) => markSeen(projectId, (j) => send("voice:progress", j)));
  h("voice:cancel", (projectId) => cancelVoiceover(projectId, project.dirOf(projectId)));
  h("voice:interrupted", () =>
    interruptedJobs().filter((j) => {
      let ok = false;
      try {
        ok = fs.existsSync(path.join(project.dirOf(j.projectId), "project.json"));
      } catch {}
      if (!ok) forgetInterrupted(j.projectId);
      return ok;
    }),
  );
  h("voice:expand", (paths) => expandDropped(Array.isArray(paths) ? paths : []));
}
