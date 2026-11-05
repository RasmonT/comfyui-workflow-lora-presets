// LoRA Preset (saved in workflow) - frontend
// Presets are stored in the hidden "presets_data" widget, so they are saved with the workflow.
import { app } from "../../scripts/app.js";

const NODE = "WorkflowLoraPreset";
const NO_PRESETS = "(no presets)";
const LORA_TYPES = ["LoraLoaderModelOnly", "LoraLoader"];

const W = (node, name) => node.widgets?.find((w) => w.name === name);

function getData(node) {
  try { const d = JSON.parse(W(node, "presets_data")?.value || "{}"); return d && typeof d === "object" ? d : {}; }
  catch { return {}; }
}
function setData(node, data) {
  const w = W(node, "presets_data");
  if (w) w.value = JSON.stringify(data);
  refresh(node);
  app.graph?.setDirtyCanvas(true, true);
}
function refresh(node) {
  const combo = W(node, "preset");
  if (!combo) return;
  const names = Object.keys(getData(node));
  combo.options.values = names.length ? names : [NO_PRESETS];
  if (!combo.options.values.includes(combo.value)) combo.value = combo.options.values[0];
  node.setDirtyCanvas?.(true, true);
}
function hideDataWidget(node) {
  const w = W(node, "presets_data");
  if (!w) return;
  w.hidden = true;
  w.computeSize = () => [0, -4];
  const i = node.inputs?.findIndex((inp) => inp.name === "presets_data");
  if (i != null && i !== -1) node.removeInput(i);
}

// all nodes that feed into this node (they are already applied before the preset)
function upstream(node, seen = new Set()) {
  for (let i = 0; i < (node.inputs?.length || 0); i++) {
    const n = node.getInputNode?.(i);
    if (n && !seen.has(n.id)) { seen.add(n.id); upstream(n, seen); }
  }
  return seen;
}
function graphNodes() {
  return app.graph?._nodes || app.graph?.nodes || [];
}
function enabledLoras(node) {
  const skip = upstream(node);
  return graphNodes()
    .filter((n) => LORA_TYPES.includes(n.type) && n.mode === 0 && !skip.has(n.id))
    .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0])
    .map((n) => [W(n, "lora_name")?.value, Number(W(n, "strength_model")?.value ?? 1)])
    .filter(([name, s]) => name && s !== 0);
}

async function askText(title, value = "") {
  const d = app.extensionManager?.dialog;
  if (d?.prompt) { try { return await d.prompt({ title, message: title, defaultValue: value }); } catch { /* fall back */ } }
  return window.prompt(title, value);
}
async function askConfirm(msg) {
  const d = app.extensionManager?.dialog;
  if (d?.confirm) { try { return await d.confirm({ title: "LoRA Preset", message: msg }); } catch { /* fall back */ } }
  return window.confirm(msg);
}
function textDialog(title, text, onSave) {
  const bg = document.createElement("div");
  Object.assign(bg.style, { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" });
  const box = document.createElement("div");
  Object.assign(box.style, { background: "#222", color: "#ddd", padding: "16px", borderRadius: "10px", width: "min(760px,92vw)", boxShadow: "0 8px 30px #000", fontFamily: "sans-serif" });
  box.innerHTML = `<div style="font-weight:600;margin-bottom:8px">${title}</div>
    <div style="font-size:12px;opacity:.7;margin-bottom:8px">Format: { "Preset name": [ ["lora_file.safetensors", 0.6], ["other.safetensors", 0.5] ] }</div>`;
  const ta = document.createElement("textarea");
  Object.assign(ta.style, { width: "100%", height: "360px", background: "#111", color: "#eee", border: "1px solid #444", borderRadius: "6px", fontFamily: "monospace", fontSize: "13px", padding: "8px", boxSizing: "border-box" });
  ta.value = text;
  const err = document.createElement("div");
  Object.assign(err.style, { color: "#f77", fontSize: "12px", minHeight: "16px", marginTop: "6px" });
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" });
  const mk = (label, bgc) => { const b = document.createElement("button"); b.textContent = label;
    Object.assign(b.style, { padding: "6px 16px", border: "none", borderRadius: "6px", background: bgc, color: "#fff", cursor: "pointer" }); return b; };
  const cancel = mk("Cancel", "#555"), save = mk("Save", "#2f7d32");
  cancel.onclick = () => bg.remove();
  save.onclick = () => {
    try { const d = JSON.parse(ta.value || "{}"); if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("must be an object { ... }");
      for (const [k, v] of Object.entries(d)) if (!Array.isArray(v) || v.some((x) => !Array.isArray(x) || typeof x[0] !== "string" || isNaN(Number(x[1])))) throw new Error(`bad entries in "${k}"`);
      onSave(d); bg.remove();
    } catch (e) { err.textContent = "Invalid JSON: " + e.message; }
  };
  row.append(cancel, save); box.append(ta, err, row); bg.append(box);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) bg.remove(); });
  document.body.append(bg); ta.focus();
}

async function saveEnabled(node) {
  const items = enabledLoras(node);
  if (!items.length) { window.alert?.("No enabled LoRA loaders found (bypassed / muted ones are skipped)."); return; }
  const list = items.map(([n, s]) => `${n} @ ${s}`).join("\n");
  const name = (await askText(`New preset name\n\n${list}`, ""))?.trim();
  if (!name) return;
  const data = getData(node);
  if (data[name] && !(await askConfirm(`Preset "${name}" exists. Overwrite?`))) return;
  data[name] = items;
  setData(node, data);
  W(node, "preset").value = name;
}

app.registerExtension({
  name: "rasmont.WorkflowLoraPreset",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      hideDataWidget(this); refresh(this);
      return r;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      hideDataWidget(this); refresh(this);
      return r;
    };

    const getMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (_, options) {
      const r = getMenu?.apply(this, arguments);
      const node = this;
      const cur = W(node, "preset")?.value;
      const has = cur && cur !== NO_PRESETS && getData(node)[cur];
      options.unshift(
        { content: "💾 LoRA Preset: save enabled LoRAs as preset…", callback: () => saveEnabled(node) },
        { content: "✏️ LoRA Preset: edit all presets (JSON)…", callback: () => textDialog("Edit presets (saved in this workflow)", JSON.stringify(getData(node), null, 2), (d) => setData(node, d)) },
        { content: "📥 LoRA Preset: import / paste presets…", callback: () => textDialog("Paste presets to add (merged, same names are replaced)", "", (d) => setData(node, { ...getData(node), ...d })) },
        { content: `📋 LoRA Preset: copy "${has ? cur : "-"}" to clipboard`, disabled: !has,
          callback: async () => { await navigator.clipboard?.writeText(JSON.stringify({ [cur]: getData(node)[cur] }, null, 2)); } },
        { content: `🔤 LoRA Preset: rename "${has ? cur : "-"}"…`, disabled: !has,
          callback: async () => { const n = (await askText("New name", cur))?.trim(); if (!n || n === cur) return;
            const d = getData(node); const out = {}; for (const [k, v] of Object.entries(d)) out[k === cur ? n : k] = v; setData(node, out); W(node, "preset").value = n; } },
        { content: `🗑️ LoRA Preset: delete "${has ? cur : "-"}"`, disabled: !has,
          callback: async () => { if (!(await askConfirm(`Delete preset "${cur}"?`))) return; const d = getData(node); delete d[cur]; setData(node, d); } },
        null,
      );
      return r;
    };
  },
});
