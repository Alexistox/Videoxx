import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ImageOffIcon,
  ImagePlusIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  MessageSquareTextIcon,
  PinIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { isMac } from "../help/keys";
import { Modal, Spinner } from "../components/ui";
import { DEFAULTS, nid, nodeHeight, normalize, refsOf } from "./board";
import { BoardCanvas } from "./BoardCanvas";
import { PromptView } from "./PromptView";
import { KeyDialog } from "./KeyDialog";

const TRASH = isMac ? "Trash" : "Recycle Bin";
export function Thumbnails() {
  const { brand } = useApp();
  return <ThumbnailsPage key={brand} />;
}
function ThumbnailsPage() {
  const { toast, projects, brand, refreshProjects, thumbFor: forVideo, setThumbFor: setForVideo, go } = useApp();
  const thing = brand === "personal" ? "video" : "project";
  const LAST = `cz-board-${brand}`;
  const [boards, setBoards] = useState([]);
  const [board, setBoard] = useState(null);
  const [data, setDataState] = useState(null);
  const [gens, setGens] = useState({});
  const [hf, setHf] = useState(null);
  const [picker, setPicker] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [thumbFor, setThumbFor] = useState(null);
  const [name, setName] = useState("");
  const menuRef = useRef(null);
  useEffect(() => {
    if (!picker) return;
    const down = (e) => {
      const t = e.target;
      if (!menuRef.current?.contains(t) && !t.closest(".th-pick")) setPicker(false);
    };
    const key = (e) => {
      if (e.key === "Escape") setPicker(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [picker]);
  const canvas = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const past = useRef([]),
    future = useRef([]);
  const loadList = useCallback(
    () =>
      api
        .boards(brand)
        .then(setBoards)
        .catch(() => {}),
    [brand],
  );
  const open = useCallback(
    async (id) => {
      try {
        flush();
        let b = typeof id === "string" ? await api.board(id) : await api.boardForProject(id.forProject);
        if (b.brand !== brand) b = await api.board((await api.boards(brand)).find((x) => x.pinned).id);
        owner.current = { id: b.id, data: null };
        setBoard(b);
        setName(b.name);
        setDataState(normalize(b.data));
        past.current = [];
        future.current = [];
        setGens(Object.fromEntries(b.gens.map((g) => [g.id, g])));
        try {
          localStorage.setItem(LAST, b.id);
        } catch {}
      } catch (e) {
        toast(e.message, "bad");
        if (!owner.current) {
          const m = (await api.boards(brand).catch(() => []))?.find((x) => x.pinned);
          if (m && m.id !== id) open(m.id);
        }
      }
    },
    [toast],
  );
  useEffect(() => {
    api
      .hfStatus()
      .then(setHf)
      .catch(() => setHf({ hasKey: false, hint: null, models: [] }));
    (async () => {
      const list = await api.boards(brand);
      setBoards(list);
      if (forVideo) {
        await open({ forProject: forVideo });
        loadList();
        return;
      }
      let last = null;
      try {
        last = localStorage.getItem(LAST);
      } catch {}
      open(list.find((b) => b.id === last)?.id ?? list.find((b) => b.pinned)?.id ?? list[0].id);
    })().catch((e) => toast(e.message, "bad"));
  }, []);
  useEffect(() => () => setForVideo(null), []);
  useEffect(
    () =>
      on("higgsfield:job", (ev) => {
        if (ev.boardId !== board?.id) return;
        setGens((g) => ({
          ...g,
          [ev.id]: {
            ...(g[ev.id] ?? {}),
            id: ev.id,
            board_id: ev.boardId,
            node_id: ev.nodeId,
            status: ev.status,
            file: ev.file ?? null,
            url: ev.url ?? null,
            error: ev.error ?? null,
          },
        }));
        if (ev.status === "completed") loadList();
        if (ev.status === "failed" && ev.error) toast(ev.error, "bad");
      }),
    [board?.id],
  );
  const saveT = useRef(0),
    pending = useRef(null);
  const owner = useRef(null);
  const flush = () => {
    clearTimeout(saveT.current);
    const p = pending.current;
    pending.current = null;
    if (p) api.boardSave(p.id, p.data).catch((e) => toast(e.message, "bad"));
  };
  const persist = useCallback(
    (d) => {
      const id = owner.current?.id;
      if (!id) return;
      clearTimeout(saveT.current);
      pending.current = { id, data: d };
      saveT.current = window.setTimeout(flush, 400);
    },
    [toast],
  );
  const update = useCallback(
    (fn, record = false) => {
      setDataState((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        if (next === prev) return prev;
        if (record) {
          past.current.push(prev);
          if (past.current.length > 120) past.current.shift();
          future.current = [];
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );
  const restoreTo = (target2, cur) => {
    const has = new Set(target2.nodes.map((n) => n.id)),
      gens2 = new Set(target2.nodes.map((n) => n.genId).filter(Boolean));
    const outs = cur.nodes.filter((n) => n.type === "output" && n.genId && !has.has(n.id) && !gens2.has(n.genId)),
      ids = new Set(outs.map((o) => o.id));
    const nodes = [...target2.nodes, ...outs],
      all = new Set(nodes.map((n) => n.id));
    return {
      ...target2,
      nodes,
      edges: [...target2.edges, ...cur.edges.filter((e) => ids.has(e.to) && all.has(e.from) && !target2.edges.some((t) => t.id === e.id))],
      view: cur.view,
      mode: cur.mode,
      compose: cur.compose,
      dismissed: cur.dismissed,
    };
  };
  const undo = () => {
    const p = past.current.pop();
    if (!p || !dataRef.current) return;
    future.current.push(dataRef.current);
    const d = restoreTo(p, dataRef.current);
    setDataState(d);
    persist(d);
  };
  const redo = () => {
    const f = future.current.pop();
    if (!f || !dataRef.current) return;
    past.current.push(dataRef.current);
    const d = restoreTo(f, dataRef.current);
    setDataState(d);
    persist(d);
  };
  const still = (boardId) => owner.current?.id === boardId;
  useEffect(() => () => flush(), []);
  const addFiles = async (paths, at) => {
    if (!board) return [];
    const bid = board.id,
      added = [];
    for (const [i, f] of paths.entries()) {
      try {
        const r = await api.boardAddImage(board.id, f);
        const w = Math.min(360, Math.max(160, r.w ? r.w / 4 : 300));
        added.push({
          id: nid("i_"),
          type: "image",
          x: Math.round(at.x + i * 36),
          y: Math.round(at.y + i * 36),
          w,
          file: r.file,
          name: r.name,
          iw: r.w,
          ih: r.h,
        });
      } catch (e) {
        toast(e.message, "bad");
      }
    }
    if (!still(bid)) return [];
    if (added.length) update((d) => ({ ...d, nodes: [...d.nodes, ...added] }), true);
    return added;
  };
  const addData = async (dataUrl, at) => {
    if (!board) return [];
    const bid = board.id;
    try {
      const r = await api.boardAddImage(bid, dataUrl);
      if (!still(bid)) return [];
      const n = {
        id: nid("i_"),
        type: "image",
        x: Math.round(at.x - 150),
        y: Math.round(at.y - 90),
        w: 300,
        file: r.file,
        name: r.name,
        iw: r.w,
        ih: r.h,
      };
      update((d) => ({ ...d, nodes: [...d.nodes, n] }), true);
      return [n];
    } catch (e) {
      toast(e.message, "bad");
      return [];
    }
  };
  const pickImages = async (at) => {
    const fs = await api.pickFiles("Add images", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]);
    return fs?.length ? addFiles(fs, at) : [];
  };
  const fileOf = (n) => (n.type === "image" ? (n.file ?? null) : n.type === "output" && n.genId ? (gens[n.genId]?.file ?? null) : null);
  const generate = async (nodeId) => {
    const d = dataRef.current;
    if (!d || !board) return;
    let prompt = d.nodes.find((n) => n.id === nodeId);
    if (prompt?.type === "output") prompt = d.nodes.find((n) => n.id === d.edges.find((e) => e.to === prompt.id)?.from);
    if (!prompt || prompt.type !== "prompt") return;
    if (!hf?.hasKey) {
      setKeyOpen(true);
      return;
    }
    const refs = refsOf(d, prompt.id, fileOf);
    if (refs.some((r) => !r.file)) {
      toast("A connected image is still generating. Wait for it, or disconnect it.", "bad");
      return;
    }
    const outs = d.edges
      .filter((e) => e.from === prompt.id)
      .map((e) => d.nodes.find((n) => n.id === e.to))
      .filter((n) => n?.type === "output");
    const id = nid("o_"),
      w = 360;
    const y = outs.length ? Math.max(...outs.map((o) => o.y + nodeHeight(o))) + 44 : prompt.y;
    try {
      const g = await api.hfGenerate(board.id, id, {
        model: prompt.model ?? DEFAULTS.model,
        prompt: prompt.text ?? "",
        refs: refs.map((r) => r.file),
        refNames: refs.map((r) => r.name),
        aspect: prompt.aspect ?? DEFAULTS.aspect,
        resolution: prompt.resolution ?? DEFAULTS.resolution,
        quality: prompt.quality ?? DEFAULTS.quality,
      });
      if (!still(g.board_id)) return;
      setGens((x) => ({ ...x, [g.id]: g }));
      const out = {
        id,
        type: "output",
        x: prompt.x + prompt.w + 90,
        y: Math.round(y),
        w,
        genId: g.id,
        aspectHint: prompt.aspect ?? DEFAULTS.aspect,
      };
      update((b) => ({ ...b, nodes: [...b.nodes, out], edges: [...b.edges, { id: nid("e_"), from: prompt.id, to: id }] }), false);
    } catch (e) {
      toast(e.message, "bad");
      if (/key/i.test(e.message)) setKeyOpen(true);
    }
  };
  const runCompose = async (c) => {
    const d = dataRef.current;
    if (!d) return;
    let y0 = 0,
      x0 = 0;
    const others = d.nodes.filter((n) => !c.refs.includes(n.id));
    if (others.length) {
      y0 = Math.max(...others.map((n) => n.y + nodeHeight(n))) + 140;
      x0 = Math.min(...others.map((n) => n.x));
    }
    const refs = c.refs.map((id) => d.nodes.find((n) => n.id === id)).filter(Boolean);
    const moved = refs.map((n, i) => ({ ...n, x: x0, y: y0 + i * 40 + refs.slice(0, i).reduce((a, r) => a + nodeHeight(r), 0) }));
    const px = x0 + (refs.length ? Math.max(...refs.map((r) => r.w)) + 110 : 0),
      pid = nid("p_");
    const prompt = {
      id: pid,
      type: "prompt",
      x: px,
      y: y0,
      w: 380,
      text: c.text,
      model: c.model,
      aspect: c.aspect,
      resolution: c.resolution,
      quality: c.quality,
    };
    update(
      (b) => ({
        ...b,
        nodes: [...b.nodes.map((n) => moved.find((m) => m.id === n.id) ?? n), prompt],
        edges: [...b.edges, ...refs.map((r) => ({ id: nid("e_"), from: r.id, to: pid }))],
      }),
      true,
    );
    requestAnimationFrame(() => generate(pid));
  };
  const setCompose = (c) => update((d) => ({ ...d, compose: c }), false);
  const attach = async (paths, dataUrl) => {
    const d = dataRef.current;
    if (!d) return;
    const at = d.nodes.length
      ? { x: Math.max(...d.nodes.map((n) => n.x + (n.w || 300))) + 160, y: Math.min(...d.nodes.map((n) => n.y)) }
      : { x: 0, y: 0 };
    const added = dataUrl ? await addData(dataUrl, at) : paths ? await addFiles(paths, at) : await pickImages(at);
    if (added.length) {
      const c = dataRef.current.compose ?? { text: "", refs: [], ...DEFAULTS };
      setCompose({ ...c, refs: [...c.refs, ...added.map((n) => n.id)] });
    }
  };
  const personal = projects;
  const target = personal.find((p) => p.id === (board?.projectId ?? forVideo)) ?? null;
  const useAsThumb = (file) => {
    if (!personal.length) {
      toast(
        brand === "personal"
          ? "Plan a video first (Personal Brand > New video); then its thumbnail can come from here."
          : "Make a project first; then its thumbnail can come from here.",
        "info",
      );
      return;
    }
    if (target) {
      applyThumb(target.id, file);
      return;
    }
    setThumbFor(file);
  };
  const applyThumb = async (projectId, file) => {
    if (!board) return;
    try {
      await api.boardUseAsThumbnail(board.id, file, projectId);
      await refreshProjects();
      setThumbFor(null);
      toast(`Now the thumbnail of "${personal.find((p) => p.id === projectId)?.name}".`, "ok", {
        label: `Open the ${thing}`,
        run: () => {
          setForVideo(null);
          go("editor", projectId);
        },
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const setThumb = (projectId) => {
    if (thumbFor) applyThumb(projectId, thumbFor);
  };
  const newBoard = async () => {
    const b = await api.boardCreate(brand);
    await loadList();
    open(b.id);
    setPicker(false);
  };
  const pickBoard = (id) => {
    setPicker(false);
    if (id !== board?.id) open(id).then(loadList);
  };
  const master = boards.find((b) => b.pinned),
    videoBoards = boards.filter((b) => b.projectId && !b.pinned && personal.some((p) => p.id === b.projectId));
  const otherBoards = boards.filter((b) => !b.pinned && (!b.projectId || !personal.some((p) => p.id === b.projectId)));
  const noBoard = personal.filter((p) => !boards.some((b) => b.projectId === p.id));
  const row = (b, icon) => (
    <button key={b.id} className={b.id === board?.id ? "on" : ""} onClick={() => pickBoard(b.id)}>
      <span className="th-cover">{b.cover ? <img src={b.cover} alt="" /> : <ImageOffIcon size={14} />}</span>
      <span className="grow">
        <b>
          {icon}
          {b.name}
        </b>
        <small>
          {b.nodes}
          {" item"}
          {b.nodes === 1 ? "" : "s"}
          {" · "}
          {ago(b.updated_at)}
        </small>
      </span>
      {b.id === board?.id && <CheckIcon size={14} />}
    </button>
  );
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    const d = dataRef.current;
    if (!d || !board?.orphans.length) return;
    setRestoring(true);
    const x0 = d.nodes.length ? Math.max(...d.nodes.map((n) => n.x + (n.w || 300))) + 160 : 0,
      y0 = d.nodes.length ? Math.min(...d.nodes.map((n) => n.y)) : 0;
    const added = [];
    for (const [i, o] of board.orphans.entries()) {
      const dm = await api.boardDims(board.id, o.file).catch(() => ({ w: 0, h: 0 }));
      added.push({
        id: nid("i_"),
        type: "image",
        x: x0 + (i % 4) * 340,
        y: y0 + Math.floor(i / 4) * 260,
        w: 300,
        file: o.file,
        name: o.generated ? "Generated image" : "Image",
        iw: dm.w,
        ih: dm.h,
      });
    }
    update((b) => ({ ...b, nodes: [...b.nodes, ...added] }), true);
    setBoard((b) => (b ? { ...b, orphans: [] } : b));
    setRestoring(false);
    setTimeout(() => canvas.current?.fit(true), 60);
  };
  const dismissOrphans = () => {
    if (!board) return;
    const files = board.orphans.map((o) => o.file);
    update((d) => ({ ...d, dismissed: [...new Set([...(d.dismissed ?? []), ...files])] }), false);
    setBoard((b) => (b ? { ...b, orphans: [] } : b));
  };
  const delBoard = () => {
    if (!board) return;
    toast(`Delete "${board.name}" and its images? They go to the ${TRASH}.`, "info", {
      label: "Delete",
      run: async () => {
        pending.current = null;
        clearTimeout(saveT.current);
        await api.boardDelete(board.id);
        const list = await api.boards(brand);
        setBoards(list);
        open(list.find((b) => b.pinned)?.id ?? list[0].id);
      },
    });
  };
  const rename = async () => {
    if (!board || !name.trim() || name === board.name) return;
    const b = await api.boardRename(board.id, name);
    setBoard((x) => (x ? { ...x, name: b.name } : x));
    loadList();
  };
  const mode = data?.mode ?? "canvas";
  const setMode = (m) => update((d) => ({ ...d, mode: m }), false);
  return (
    <div className="thumbs page-enter">
      <div className="th-top">
        <div className="th-board">
          <button className="th-pick" onClick={() => setPicker(!picker)} aria-expanded={picker} aria-label="Boards">
            <LayoutGridIcon size={15} strokeWidth={1.7} />
            <ChevronDownIcon size={13} />
          </button>
          <input
            className="th-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            aria-label="Board name"
            size={Math.max(6, name.length)}
          />
          {picker && (
            <div className="th-menu" ref={menuRef}>
              {master && row(master, <PinIcon size={11} className="th-pin" />)}
              {(videoBoards.length > 0 || noBoard.length > 0) && (
                <div className="th-menu-sec">{brand === "personal" ? "Videos" : "Projects"}</div>
              )}
              {videoBoards.map((b) => row(b, <VideoIcon size={11} className="th-pin" />))}
              {noBoard.map((p) => (
                <button key={p.id} className="th-new-video" onClick={() => pickBoard({ forProject: p.id })}>
                  <span className="th-cover">{p.thumb ? <img src={p.thumb} alt="" /> : <VideoIcon size={14} />}</span>
                  <span className="grow">
                    <b>{p.name}</b>
                    <small>Start its board</small>
                  </span>
                </button>
              ))}
              {otherBoards.length > 0 && <div className="th-menu-sec">Boards</div>}
              {otherBoards.map((b) => row(b))}
              <button onClick={newBoard}>
                <span className="th-cover">
                  <PlusIcon size={14} />
                </span>
                <b>New board</b>
              </button>
            </div>
          )}
        </div>
        <div className="seg-ctl" role="tablist" aria-label="View">
          <button role="tab" aria-selected={mode === "canvas"} className={mode === "canvas" ? "on" : ""} onClick={() => setMode("canvas")}>
            <LayoutGridIcon size={13} />
            Canvas
          </button>
          <button role="tab" aria-selected={mode === "prompt"} className={mode === "prompt" ? "on" : ""} onClick={() => setMode("prompt")}>
            <MessageSquareTextIcon size={13} />
            Prompt
          </button>
        </div>
        {target && (
          <span className="th-for" title={`Use as thumbnail puts the image straight on this ${thing}`}>
            <StarIcon size={12} fill="currentColor" />
            {"For "}
            <b className="ellipsis">{target.name}</b>
            {forVideo && !board?.projectId && (
              <button
                aria-label={`Stop making it for this ${thing}`}
                title={`Stop making it for this ${thing}`}
                onClick={() => setForVideo(null)}
              >
                <XIcon size={12} />
              </button>
            )}
          </span>
        )}
        <span className="grow" />
        {hf && (
          <button className={`th-key ${hf.hasKey ? "ok" : ""}`} onClick={() => setKeyOpen(true)} title="Higgsfield API key">
            <KeyRoundIcon size={13} />
            {hf.hasKey ? `Higgsfield · …${hf.hint}` : "Add Higgsfield key"}
          </button>
        )}
        <button
          className="icon-btn"
          title={board?.pinned ? "The Master board stays" : "Delete this board"}
          aria-label="Delete this board"
          onClick={delBoard}
          disabled={!!board?.pinned}
        >
          <TrashIcon size={16} strokeWidth={1.7} />
        </button>
      </div>
      {board && board.orphans.length > 0 && mode === "canvas" && (
        <div className="th-orphans" role="status">
          <ImagePlusIcon size={15} />
          <span className="grow">
            {board.orphans.length}
            {" image"}
            {board.orphans.length === 1 ? " is" : "s are"}
            {" in this board's folder but not on the canvas."}
          </span>
          <button className="btn small" onClick={restore} disabled={restoring}>
            {restoring ? <Spinner size={13} /> : null}
            {"Put "}
            {board.orphans.length === 1 ? "it" : "them"}
            {" back"}
          </button>
          <button className="btn small" onClick={dismissOrphans} disabled={restoring}>
            Dismiss
          </button>
        </div>
      )}
      <div className="th-body">
        {!data || !board || !hf ? (
          <div className="th-loading">
            <Spinner />
          </div>
        ) : mode === "canvas" ? (
          <BoardCanvas
            key={board.id}
            ref={canvas}
            data={data}
            update={update}
            undo={undo}
            redo={redo}
            base={board.base}
            gens={gens}
            models={hf.models}
            hasKey={hf.hasKey}
            generate={generate}
            cancel={(g) => api.hfCancel(g)}
            useAsThumb={useAsThumb}
            addFiles={(f, at) => addFiles(f, at)}
            addData={(u, at) => addData(u, at)}
            pickImages={(at) => {
              pickImages(at);
            }}
            reveal={(f) => api.boardReveal(board.id, f).catch((e) => toast(e.message, "bad"))}
            dragOut={(f) => {
              api.boardStartDrag(board.id, f).catch(() => {});
            }}
            saveAs={(f) =>
              api
                .boardSaveAs(board.id, f)
                .then((p) => p && toast("Saved."))
                .catch((e) => toast(e.message, "bad"))
            }
          />
        ) : (
          <PromptView
            data={data}
            base={board.base}
            toCanvas={() => setMode("canvas")}
            gens={gens}
            models={hf.models}
            hasKey={hf.hasKey}
            setCompose={setCompose}
            attach={attach}
            run={runCompose}
            useAsThumb={useAsThumb}
            reveal={(f) => api.boardReveal(board.id, f)}
            dragOut={(f) => {
              api.boardStartDrag(board.id, f).catch(() => {});
            }}
            saveAs={(f) => api.boardSaveAs(board.id, f).then((p) => p && toast("Saved."))}
            cancel={(g) => api.hfCancel(g)}
            showOnCanvas={(id) => {
              setMode("canvas");
              setTimeout(() => canvas.current?.centerOn(id), 80);
            }}
          />
        )}
      </div>
      {keyOpen && <KeyDialog hf={hf} onClose={() => setKeyOpen(false)} onSaved={(s) => setHf((h) => (h ? { ...h, ...s } : h))} />}
      {thumbFor && board && (
        <Modal title="Use as thumbnail" onClose={() => setThumbFor(null)}>
          <div className="modal-body">
            <div className="th-use">
              <img className="th-use-img" src={board.base + encodeURIComponent(thumbFor)} alt="The image" />
              <div className="th-use-list">
                {personal.map((p) => (
                  <button key={p.id} className="list-row" onClick={() => setThumb(p.id)}>
                    <span className="th-cover">{p.thumb ? <img src={p.thumb} alt="" /> : <ImageOffIcon size={14} />}</span>
                    <span className="grow ellipsis">{p.name}</span>
                    <small>{ago(p.opened_at ?? p.updated_at)}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
