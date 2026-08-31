import { request } from "./http.js";
import { toast } from "./ui.js";

let bound = false;

function resetQuickMaterialForm(form) {
  form.reset();
  const date = form.querySelector('[name="capturedAt"]');
  if (date) date.value = new Date().toISOString().slice(0, 10);
}

export function bindQuickMaterialCapture() {
  if (bound) return;
  bound = true;
  const dialog = document.getElementById("quick-material-dialog");
  const form = document.getElementById("quick-material-form");
  const openButton = document.getElementById("quick-material-button");
  if (!dialog || !form || !openButton) return;

  const open = () => {
    resetQuickMaterialForm(form);
    dialog.showModal();
    form.querySelector('[name="rawText"]')?.focus();
  };
  openButton.addEventListener("click", open);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-quick-material]")) open();
  });
  dialog.querySelectorAll("[data-close-quick-material]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = "保存中…"; }
    try {
      await request("/api/writing-materials", { method: "POST", body: JSON.stringify({
        sourceType: data.get("sourceType"),
        capturedAt: data.get("capturedAt"),
        title: data.get("title"),
        rawText: data.get("rawText"),
        tags: String(data.get("tags") || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      }) });
      dialog.close();
      resetQuickMaterialForm(form);
      window.dispatchEvent(new CustomEvent("material-created"));
      toast("素材已放入素材箱", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = "存入素材箱"; }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "m") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable=\"true\"]")) return;
    event.preventDefault();
    if (!dialog.open) open();
  });
}
