import { takeOpened } from "../core/openExternal";
import { cancelSignIn, clientStatus, keyStatus, reopenSignIn, setApiKey, setClient, signInOpen } from "../channels/youtubeAuth";
import {
  addChannel,
  channelFrom,
  disconnect,
  linkChannel,
  linkSuggestion,
  listChannels,
  overview,
  removeChannel,
  reorder,
  setSender,
  signInChannel,
  sync,
  tick,
  videoDetail,
} from "../channels/youtubeSync";
import { linkVideo, undoLink, videoChoices } from "../channels/links";
import {
  addInsight,
  approvedFor,
  cancelInsights,
  dismissInsight,
  generateInsights,
  insightsRunning,
  insightsSince,
  listInsights,
  setStubDelay,
  setStubFail,
  testLastPrompt,
  updateInsight,
} from "../channels/insights";
import { testScriptPrompt } from "../agent/sessions";

export function registerYoutubeIpc(h, send) {
  setSender(send);
  const status = () => ({ key: keyStatus(), client: clientStatus(), signingIn: signInOpen(), channels: listChannels() });
  h("youtube:status", () => status());
  h("youtube:setKey", async (key2) => {
    await setApiKey(key2);
    send("youtube:changed", { what: "setup" });
    return status();
  });
  h("youtube:setClient", (o) => {
    setClient(o ?? null);
    send("youtube:changed", { what: "setup" });
    return status();
  });
  h("youtube:signIn", () => signInChannel());
  h("youtube:cancelSignIn", () => {
    cancelSignIn();
    return true;
  });
  h("youtube:reopenSignIn", () => reopenSignIn());
  h("youtube:add", (input) => addChannel(String(input ?? "")));
  h("youtube:sync", (id) => sync(String(id), true));
  h("youtube:disconnect", (id) => disconnect(String(id)));
  h("youtube:remove", (id) => removeChannel(String(id)));
  h("youtube:reorder", (ids) => reorder(ids));
  h("youtube:link", (ytId, channelId) => linkChannel(String(ytId), channelId));
  h("youtube:linkSuggestion", (ytId) => linkSuggestion(String(ytId)));
  h("youtube:channelFrom", (ytId) => channelFrom(String(ytId)));
  h("youtube:overview", (id) => overview(String(id)));
  h("youtube:video", (videoId, force) => videoDetail(String(videoId), !!force));
  h("youtube:linkVideo", (videoId, projectId) => linkVideo(String(videoId), projectId ? String(projectId) : null));
  h("youtube:undoLink", (u) => undoLink(u && typeof u === "object" ? u : null));
  h("youtube:videoChoices", (projectId) => videoChoices(String(projectId)));
  h("youtube:insights", (channelId) => ({
    list: listInsights(String(channelId)),
    running: insightsRunning(String(channelId)),
    since: insightsSince(String(channelId)),
  }));
  h("youtube:insightsRun", async (channelId) => {
    try {
      return await generateInsights(String(channelId));
    } finally {
      send("youtube:changed", { what: "insights" });
    }
  });
  h("youtube:insightsCancel", (channelId) => cancelInsights(String(channelId)));
  h("youtube:insightUpdate", (id, patch) => {
    const r = updateInsight(String(id), patch || {});
    send("youtube:changed", { what: "insights" });
    return r;
  });
  h("youtube:insightDismiss", (id) => {
    dismissInsight(String(id));
    send("youtube:changed", { what: "insights" });
    return true;
  });
  h("youtube:insightAdd", (channelId, text) => {
    const r = addInsight(String(channelId), String(text ?? ""));
    send("youtube:changed", { what: "insights" });
    return r;
  });
  h("youtube:approved", (channelId) => approvedFor({ channelId: channelId || null }));
  if (process.env.CZ_TEST_HOOKS === "1") {
    h("test:externalUrls", () => takeOpened());
    h("test:ytTick", (maxAgeMs) => tick(Number(maxAgeMs) || 0));
    h("test:ytPrompt", () => testLastPrompt());
    h("test:ytStubDelay", (ms) => setStubDelay(Number(ms) || 0));
    h("test:ytStubFail", (raw) => setStubFail(raw));
    h("test:scriptPrompt", (projectId) => testScriptPrompt(String(projectId)));
  }
}
