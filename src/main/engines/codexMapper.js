export class CodexMapper {
  constructor(o) {
    this.o = o;
    this.threadId = o.resumeId ?? null;
  }
  o;
  initSent = false;
  text = new Map();
  // agent_message id -> text streamed so far
  started = new Set();
  // tool items whose tool_use went out
  done = new Set();
  // tool items whose tool_result went out
  turns = 0;
  threadId = null;
  init(id) {
    if (this.initSent && (!id || id === this.threadId)) return [];
    this.initSent = true;
    if (id) this.threadId = id;
    return [{ type: "system", subtype: "init", session_id: this.threadId, model: this.o.model }];
  }
  toolUse(id, name, input) {
    if (this.started.has(id)) return [];
    this.started.add(id);
    return [{ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: null }];
  }
  toolResult(id, error, content) {
    if (this.done.has(id)) return [];
    this.done.add(id);
    return [
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: error, ...(content ? { content } : {}) }] } },
    ];
  }
  item(kind, it) {
    const out = [],
      outside = [];
    switch (it.type) {
      case "agent_message": {
        const prev = this.text.get(it.id) ?? "",
          now = it.text ?? "";
        if (now.length > prev.length && now.startsWith(prev))
          out.push({
            type: "stream_event",
            event: { type: "content_block_delta", delta: { type: "text_delta", text: now.slice(prev.length) } },
            parent_tool_use_id: null,
          });
        this.text.set(it.id, now);
        if (kind === "completed")
          out.push({ type: "assistant", message: { content: [{ type: "text", text: now }] }, parent_tool_use_id: null });
        break;
      }
      case "command_execution":
        out.push(...this.toolUse(it.id, "Bash", { command: it.command }));
        if (kind === "completed" || it.status === "completed" || it.status === "failed")
          out.push(...this.toolResult(it.id, it.status === "failed" || (typeof it.exit_code === "number" && it.exit_code !== 0)));
        break;
      case "file_change":
        it.changes.forEach((c, i) => {
          const id = `${it.id}:${i}`;
          if (!this.o.inside(c.path)) outside.push(c.path);
          out.push(...this.toolUse(id, c.kind === "add" ? "Write" : c.kind === "delete" ? "Delete" : "Edit", { file_path: c.path }));
          if (kind === "completed") out.push(...this.toolResult(id, it.status === "failed"));
        });
        break;
      case "mcp_tool_call":
        out.push(...this.toolUse(it.id, `mcp__${it.server}__${it.tool}`, it.arguments ?? {}));
        if (kind === "completed" || it.status === "completed" || it.status === "failed")
          out.push(
            ...this.toolResult(
              it.id,
              it.status === "failed",
              Array.isArray(it.result?.content) ? it.result.content.map((c) => ({ type: c?.type })) : void 0,
            ),
          );
        break;
      case "web_search":
        out.push(...this.toolUse(it.id, "WebSearch", { query: it.query }));
        if (kind === "completed") out.push(...this.toolResult(it.id, false));
        break;
      case "todo_list":
        out.push(...this.toolUse(it.id, "TodoWrite", { todos: it.items }));
        if (kind === "completed") out.push(...this.toolResult(it.id, false));
        break;
      case "error":
        if (kind === "completed" || kind === "started") out.push({ type: "codex_note", text: it.message });
        break;
    }
    return { messages: out, outside };
  }
  /** one Codex event -> the messages runTask reads (and any file change outside the project) */
  map(ev) {
    const pre = ev.type === "thread.started" ? [] : this.init(null);
    switch (ev.type) {
      case "thread.started":
        return { messages: this.init(ev.thread_id), outside: [] };
      case "turn.started":
        return { messages: pre, outside: [] };
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const r = this.item(ev.type === "item.started" ? "started" : ev.type === "item.updated" ? "updated" : "completed", ev.item);
        return { messages: [...pre, ...r.messages], outside: r.outside };
      }
      case "turn.completed": {
        const u = ev.usage,
          cached = +u?.cached_input_tokens || 0;
        const usage = {
          input_tokens: Math.max(0, (+u?.input_tokens || 0) - cached),
          cache_read_input_tokens: cached,
          cache_creation_input_tokens: +u?.cache_write_input_tokens || 0,
          output_tokens: +u?.output_tokens || 0,
        };
        this.turns++;
        return {
          messages: [
            ...pre,
            {
              type: "assistant",
              message: { id: `codex-turn-${this.threadId ?? "new"}-${this.turns}`, model: this.o.model, content: [], usage },
              parent_tool_use_id: null,
            },
            { type: "result", subtype: "success", is_error: false, usage, total_cost_usd: 0, modelUsage: {} },
          ],
          outside: [],
        };
      }
      case "turn.failed":
        return {
          messages: [
            ...pre,
            {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: [ev.error?.message || "ChatGPT stopped with an error."],
            },
          ],
          outside: [],
        };
      case "error":
        return {
          messages: [
            ...pre,
            { type: "result", subtype: "error_during_execution", is_error: true, errors: [ev.message || "ChatGPT stopped with an error."] },
          ],
          outside: [],
        };
      default:
        return { messages: pre, outside: [] };
    }
  }
}
export function describeMapped(events, o) {
  const m = new CodexMapper(o),
    out = [];
  for (const ev of events) {
    const r = m.map(ev);
    for (const x of r.messages) {
      if (x.type === "system") out.push(`init:${x.session_id}`);
      else if (x.type === "stream_event") out.push(`delta:${x.event.delta.text}`);
      else if (x.type === "assistant")
        for (const b of x.message.content.length ? x.message.content : [{ type: "usage" }])
          out.push(
            b.type === "text"
              ? `text:${b.text}`
              : b.type === "tool_use"
                ? `tool:${b.name}`
                : `usage:${x.message.usage.input_tokens}/${x.message.usage.cache_read_input_tokens}/${x.message.usage.output_tokens}`,
          );
      else if (x.type === "user") for (const b of x.message.content) out.push(`tool_done${b.is_error ? ":error" : ""}`);
      else if (x.type === "result") out.push(`result:${x.subtype}`);
      else if (x.type === "codex_note") out.push(`note:${x.text}`);
    }
    for (const p of r.outside) out.push(`OUTSIDE:${p}`);
  }
  return out;
}
