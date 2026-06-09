/** CSS zoom on document.body (Pricing list menus / portaled tooltips divide by this). */
export function getBodyCssZoom(): number {
  const raw = Number(window.getComputedStyle(document.body).zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
