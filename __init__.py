"""LoRA Preset (saved in workflow)

Presets live INSIDE the node (saved with the workflow), so anyone who loads your
workflow gets your presets too. No preset files on disk.

Right-click the node:
  - Save enabled LoRAs as preset...   (collects every active LoRA loader in the graph)
  - Edit presets (JSON)... / Import / Copy / Rename / Delete
"""
import json
import logging
import os

import comfy.sd
import comfy.utils
import folder_paths

NO_PRESETS = "(no presets)"
WEB_DIRECTORY = "./web"


def _parse(data):
    try:
        d = json.loads(data or "{}")
    except Exception as e:
        raise ValueError(f"[LoRA Preset] presets data is not valid JSON: {e}")
    if not isinstance(d, dict):
        raise ValueError("[LoRA Preset] presets data must be a JSON object")
    return d


class WorkflowLoraPreset:
    _cache = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "preset": ([NO_PRESETS], {"tooltip": "Right-click the node to save / edit presets. Presets are stored in the workflow."}),
            "strength_multiplier": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05,
                                               "tooltip": "Scales all LoRA strengths of the preset (1.0 = as saved)."}),
            "presets_data": ("STRING", {"default": "{}", "tooltip": "Internal: presets stored in the workflow (hidden)."}),
        }}

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("MODEL", "info")
    FUNCTION = "apply"
    CATEGORY = "loaders"
    DESCRIPTION = "Apply a named LoRA combination. Presets are saved inside the workflow - right-click the node to create them from your enabled LoRA loaders."

    @classmethod
    def VALIDATE_INPUTS(cls, preset, presets_data):
        try:
            data = _parse(presets_data)
        except ValueError as e:
            return str(e)
        if preset != NO_PRESETS and preset not in data:
            return f"Preset '{preset}' not found in this node. Right-click the node to create it."
        return True

    def _load(self, path):
        mtime = os.path.getmtime(path)
        hit = self._cache.get(path)
        if hit is None or hit[0] != mtime:
            if len(self._cache) >= 6:
                self._cache.pop(next(iter(self._cache)))
            sd, meta = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
            self._cache[path] = (mtime, sd, meta)
        return self._cache[path][1], self._cache[path][2]

    def apply(self, model, preset, strength_multiplier, presets_data):
        items = [] if preset == NO_PRESETS else _parse(presets_data).get(preset, [])
        missing = [it[0] for it in items if folder_paths.get_full_path("loras", it[0]) is None]
        if missing:
            raise FileNotFoundError(f"[LoRA Preset] '{preset}': missing LoRA file(s) in models/loras: {', '.join(missing)}")
        info = []
        for it in items:
            name, strength = it[0], float(it[1]) * strength_multiplier
            if strength == 0:
                continue
            lora, meta = self._load(folder_paths.get_full_path("loras", name))
            model, _ = comfy.sd.load_lora_for_models(model, None, lora, strength, 0, lora_metadata=meta)
            info.append(f"{name} @ {strength:.2f}")
        text = f"{preset}: " + (", ".join(info) if info else "no LoRA")
        logging.info(f"[LoRA Preset] {text}")
        return (model, text)


NODE_CLASS_MAPPINGS = {"WorkflowLoraPreset": WorkflowLoraPreset}
NODE_DISPLAY_NAME_MAPPINGS = {"WorkflowLoraPreset": "LoRA Preset (saved in workflow)"}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
