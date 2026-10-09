import type { UiPostImage } from "./config";

export type WatermarkSettings = {
  enabled: boolean;
  text: string;
  position: "top" | "center" | "bottom";
  backgroundColor: string;
  textColor: string;
  height: number;
};

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: "",
  position: "bottom",
  backgroundColor: "#000000",
  textColor: "#ffffff",
  height: 10,
};

export function normalizeWatermark(value: unknown): WatermarkSettings {
  const input = (value && typeof value === "object" ? value : {}) as Partial<WatermarkSettings>;
  const color = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return {
    enabled: input.enabled === true,
    text: typeof input.text === "string" ? input.text.slice(0, 200) : "",
    position: input.position === "top" || input.position === "center" ? input.position : "bottom",
    backgroundColor: color(input.backgroundColor, DEFAULT_WATERMARK.backgroundColor),
    textColor: color(input.textColor, DEFAULT_WATERMARK.textColor),
    height: typeof input.height === "number" && Number.isFinite(input.height)
      ? Math.min(50, Math.max(1, input.height)) : DEFAULT_WATERMARK.height,
  };
}

export function drawWatermark(context: CanvasRenderingContext2D, width: number, height: number, settings: WatermarkSettings) {
  const bandHeight = Math.max(1, height * settings.height / 100);
  const y = settings.position === "top" ? 0 : settings.position === "center"
    ? (height - bandHeight) / 2 : height - bandHeight;
  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, y, width, bandHeight);
  context.fillStyle = settings.textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const text = settings.text.trim();
  const fontSize = bandHeight * 0.55;
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  context.font = `600 ${fontSize / rootFontSize}rem ${fontFamily}`;
  const availableWidth = width * 0.92;
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth > availableWidth) {
    context.font = `600 ${fontSize * availableWidth / measuredWidth / rootFontSize}rem ${fontFamily}`;
  }
  context.fillText(text, width / 2, y + bandHeight / 2, availableWidth);
}

export async function watermarkImage(image: UiPostImage, settings: WatermarkSettings): Promise<UiPostImage> {
  if (!settings.enabled) return image;
  if (!settings.text.trim()) throw new Error("Enter watermark text, or turn off watermarks before posting.");
  await document.fonts.load('600 1rem "Inter"');
  const source = new Image();
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new Error(`Unable to load ${image.name} for watermarking.`));
    source.src = image.dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare image watermarks.");
  context.drawImage(source, 0, 0);
  drawWatermark(context, canvas.width, canvas.height, settings);
  const type = image.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const name = image.name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : ".png");
  const dataUrl = canvas.toDataURL(type, 0.95);
  if (!dataUrl.startsWith(`data:${type}`)) throw new Error(`Unable to export ${image.name} with a watermark.`);
  return { ...image, name, type, dataUrl };
}

export function initializeWatermarkControls(onError: (message: string) => void) {
  const root = document.querySelector<HTMLElement>("#watermark-settings");
  const enabled = root?.querySelector<HTMLInputElement>("#watermark-enabled");
  const fields = root?.querySelector<HTMLFieldSetElement>("fieldset");
  const text = root?.querySelector<HTMLInputElement>("#watermark-text");
  const position = root?.querySelector<HTMLSelectElement>("#watermark-position");
  const backgroundColor = root?.querySelector<HTMLInputElement>("#watermark-background-color");
  const textColor = root?.querySelector<HTMLInputElement>("#watermark-text-color");
  const height = root?.querySelector<HTMLInputElement>("#watermark-height");
  const preview = root?.querySelector<HTMLCanvasElement>("canvas");
  const status = root?.querySelector<HTMLElement>("[role=status]");
  const picker = root?.querySelector<HTMLElement>("#watermark-color-picker");
  const pickerTitle = root?.querySelector<HTMLElement>("#watermark-color-picker-title");
  const swatches = Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-color-target]") ?? []);
  const channels = Array.from(root?.querySelectorAll<HTMLInputElement>("[data-color-channel]") ?? []);
  let activeColor: HTMLInputElement | undefined;

  function closePicker(restoreFocus = false) {
    if (picker) picker.hidden = true;
    const trigger = swatches.find((button) => button.dataset.colorTarget === activeColor?.id);
    swatches.forEach((button) => button.setAttribute("aria-expanded", "false"));
    activeColor = undefined;
    if (restoreFocus) trigger?.focus();
  }

  function renderColors() {
    swatches.forEach((button) => {
      const color = button.dataset.colorTarget === backgroundColor?.id ? settings.backgroundColor : settings.textColor;
      button.style.backgroundColor = color;
    });
    if (!settings.enabled) closePicker();
    if (activeColor) {
      const color = activeColor === backgroundColor ? settings.backgroundColor : settings.textColor;
      channels.forEach((channel, index) => {
        channel.value = String(parseInt(color.slice(1 + index * 2, 3 + index * 2), 16));
        const output = channel.parentElement?.querySelector("output");
        if (output) output.textContent = channel.value;
      });
    }
  }
  const storageKey = "imageWatermarkSettings";
  let settings = { ...DEFAULT_WATERMARK };
  let saveQueue = Promise.resolve();
  let edited = false;

  function render() {
    if (!enabled || !fields || !text || !position || !backgroundColor || !textColor || !height) return;
    enabled.checked = settings.enabled;
    fields.disabled = !settings.enabled;
    text.value = settings.text;
    position.value = settings.position;
    backgroundColor.value = settings.backgroundColor;
    textColor.value = settings.textColor;
    height.value = String(settings.height);
    renderColors();
    const context = preview?.getContext("2d");
    if (preview && context) {
      const gradient = context.createLinearGradient(0, 0, preview.width, preview.height);
      gradient.addColorStop(0, "#b8e2ef");
      gradient.addColorStop(1, "#448a67");
      context.fillStyle = gradient;
      context.fillRect(0, 0, preview.width, preview.height);
      if (settings.enabled) drawWatermark(context, preview.width, preview.height, { ...settings, text: settings.text || "Your watermark" });
    }
  }

  root?.addEventListener("input", (event) => {
    if (![enabled, text, position, backgroundColor, textColor, height].includes(event.target as HTMLInputElement)) return;
    edited = true;
    const validColor = (control: HTMLInputElement | null | undefined, fallback: string) =>
      control && /^#[0-9a-f]{6}$/i.test(control.value) ? control.value : fallback;
    settings = normalizeWatermark({ enabled: enabled?.checked, text: text?.value,
      position: position?.value, backgroundColor: validColor(backgroundColor, settings.backgroundColor),
      textColor: validColor(textColor, settings.textColor), height: Number(height?.value) });
    // Keep an incomplete number field editable until focus leaves it.
    const draftHeight = height?.value;
    const editingColor = event.target === backgroundColor || event.target === textColor ? event.target as HTMLInputElement : undefined;
    const draftColor = editingColor?.value;
    render();
    if (height && document.activeElement === height) height.value = draftHeight ?? "";
    if (editingColor && document.activeElement === editingColor) editingColor.value = draftColor ?? "";
    const snapshot = { ...settings };
    if (status) status.textContent = "Saving settings…";
    saveQueue = saveQueue.then(async () => {
      try {
        await chrome.storage.local.set({ [storageKey]: snapshot });
        if (status) status.textContent = "Settings saved on this device.";
      } catch {
        if (status) status.textContent = "Unable to save settings. Change a setting to retry.";
        onError("Unable to save watermark settings.");
      }
    });
  });
  swatches.forEach((button) => button.addEventListener("click", () => {
    const control = button.dataset.colorTarget === backgroundColor?.id ? backgroundColor : textColor;
    if (!control || !picker) return;
    if (activeColor === control) { closePicker(); return; }
    activeColor = control;
    picker.hidden = false;
    swatches.forEach((swatch) => swatch.setAttribute("aria-expanded", String(swatch === button)));
    if (pickerTitle) pickerTitle.textContent = control === backgroundColor ? "Background color" : "Text color";
    renderColors();
    channels[0]?.focus({ preventScroll: true });
  }));
  channels.forEach((channel) => channel.addEventListener("input", () => {
    if (!activeColor) return;
    activeColor.value = "#" + channels.map((input) => Number(input.value).toString(16).padStart(2, "0")).join("");
    activeColor.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  root?.querySelector("#watermark-color-picker-close")?.addEventListener("click", () => closePicker(true));
  picker?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closePicker(true); }
  });
  [backgroundColor, textColor].forEach((control) => control?.addEventListener("blur", render));
  height?.addEventListener("change", render);
  render();
  void document.fonts.ready.then(render);
  const ready = chrome.storage.local.get(storageKey).then((stored) => {
    if (!edited) settings = normalizeWatermark(stored[storageKey]);
    render();
  }).catch(() => onError("Unable to load watermark settings."));
  return {
    async snapshot() {
      await ready;
      if (settings.enabled && !settings.text.trim()) {
        throw new Error("Enter watermark text, or turn off watermarks before posting.");
      }
      return { ...settings };
    },
  };
}
