/**
 * dsh-429-guard, browser half.
 *
 * 手写 ModuleLoader bundle（无构建步骤）：注册一个 `shell.overlay` 条目，
 * 在 Web UI 渲染一个精美浮窗：盾牌入口胶囊 + 展开卡片（开关、统计、正在
 * 重试呼吸灯）。胶囊支持自由拖动（pointer 事件），位置持久化到
 * localStorage，刷新后保持。所有数据经同源 fetch 到 /guard-api。
 *
 * 适配自 dsh-plugins-market 的 bundle 形态：
 *   - CSS 注入：document.head 挂 <style data-plugin-css>（插件 fiber 生命周期内有效）
 *   - 数据：window.fetch('/guard-api/...')
 */

window.__ModuleLoader__.load({
  id: 'dsh-429-guard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var createElement = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useCallback = React.useCallback

    var CSS = `
.d429g-host { position: fixed; top: 18px; right: 18px; z-index: 2147483600; font-family: inherit; }
.d429g-host.dragging { cursor: grabbing !important; user-select: none !important; }
.d429g-pill {
  display: inline-flex; align-items: center; gap: 8px; cursor: grab; user-select: none; -webkit-user-select: none;
  touch-action: none; padding: 7px 12px 7px 9px; border-radius: 999px;
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-bg-overlay, #fff)) calc(var(--d429g-o, 0.22) * 100%), transparent);
  color: var(--dsw-alias-label-primary, #111);
  border: 1px solid rgba(255,255,255,0.55);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.7),
    0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
  backdrop-filter: blur(12px) saturate(170%); -webkit-backdrop-filter: blur(12px) saturate(170%);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s, background .2s;
}
.d429g-pill:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.6),
    0 8px 22px rgba(0,0,0,0.14), 0 2px 5px rgba(0,0,0,0.08);
}
.d429g-pill:active { transform: translateY(0); }
.d429g-pill.dragging { cursor: grabbing; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 12px 28px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.12); }
.d429g-icon { display: inline-flex; width: 18px; height: 18px; flex: 0 0 18px; pointer-events: none; }
.d429g-icon svg { width: 100%; height: 100%; display: block; }
.d429g-badge {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; font-size: 10px; line-height: 15px;
  text-align: center; font-variant-numeric: tabular-nums; font-weight: 700;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 16%, transparent);
  color: var(--dsw-alias-state-error-primary, #ef4444);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 32%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
  transition: background .2s, color .2s; pointer-events: none;
  animation: d429g-popbadge .3s cubic-bezier(.34,1.56,.64,1);
}
.d429g-badge.idle { background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #9ca3af) 12%, transparent); color: var(--dsw-alias-label-secondary, #6b7280); border-color: color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.1)) 60%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,0.3); animation: none; }
@keyframes d429g-popbadge { 0% { transform: scale(1.4); } 100% { transform: scale(1); } }
.d429g-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; transition: background .2s, box-shadow .2s; pointer-events: none; }
.d429g-dot.on { background: var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)); animation: d429g-pulse 2.6s ease-in-out infinite; }
.d429g-dot.off { background: var(--dsw-alias-label-tertiary, #9ca3af); }
@keyframes d429g-pulse {
  0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 16%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 10%, transparent); }
}
.d429g-pilllabel { font-size: 12px; font-weight: 600; letter-spacing: .01em; white-space: nowrap; pointer-events: none; }
.d429g-pill.retrying { animation: d429g-pillbreathe 1.8s ease-in-out infinite; }
@keyframes d429g-pillbreathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 16px rgba(0,0,0,0.08); }
  50% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 18px color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 32%, transparent); }
}
.d429g-pill.retrying .d429g-dot { background: transparent; width: 10px; height: 10px; flex: 0 0 10px; border: 2px solid color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 26%, transparent); border-top-color: var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)); animation: d429g-spin .9s linear infinite; }
.d429g-pill.retrying .d429g-badge { animation: d429g-badgepulse 1.5s ease-in-out infinite; }
@keyframes d429g-badgepulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
[data-ds-dark-theme] .d429g-pill {
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #0f172a) calc(var(--d429g-o, 0.22) * 100%), transparent);
  border-color: rgba(255,255,255,0.09);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.35);
  backdrop-filter: blur(14px) saturate(130%); -webkit-backdrop-filter: blur(14px) saturate(130%);
}
[data-ds-dark-theme] .d429g-badge { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #f87171) 18%, transparent); color: #fca5a5; border-color: color-mix(in srgb, #f87171 34%, transparent); }
[data-ds-dark-theme] .d429g-badge.idle { background: rgba(255,255,255,0.06); color: var(--dsw-alias-label-tertiary, #94a3b8); border-color: rgba(255,255,255,0.1); }

.d429g-card {
  margin-top: 8px; width: 300px; border-radius: 16px; overflow: hidden;
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-bg-overlay, #fff)) calc(var(--d429g-o, 0.22) * 100%), transparent);
  color: var(--dsw-alias-label-primary, #111);
  border: 1px solid rgba(255,255,255,0.6);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.75),
    0 24px 64px rgba(0,0,0,0.14), 0 6px 16px rgba(0,0,0,0.06);
  backdrop-filter: blur(28px) saturate(170%); -webkit-backdrop-filter: blur(28px) saturate(170%);
  animation: d429g-pop .2s cubic-bezier(.34,1.56,.64,1);
}
@keyframes d429g-pop { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.d429g-hero { padding: 16px 16px 14px; position: relative; overflow: hidden; }
.d429g-hero::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .55;
  background: linear-gradient(180deg, rgba(255,255,255,0.5), transparent 60%);
}
.d429g-herotitle { position: relative; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; letter-spacing: .01em; }
.d429g-herosub { position: relative; margin-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); line-height: 1.55; }
.d429g-close {
  position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 8px; border: none; cursor: pointer; z-index: 2;
  background: transparent; color: var(--dsw-alias-label-tertiary, #9ca3af); display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, color .15s, transform .2s;
}
.d429g-close:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)) 60%, transparent); color: var(--dsw-alias-label-primary, #111); transform: rotate(90deg); }
[data-ds-dark-theme] .d429g-card {
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #0f172a) calc(var(--d429g-o, 0.22) * 100%), transparent);
  border-color: rgba(255,255,255,0.1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 70px rgba(0,0,0,0.55), 0 6px 18px rgba(0,0,0,0.3);
  backdrop-filter: blur(32px) saturate(130%); -webkit-backdrop-filter: blur(32px) saturate(130%);
}
[data-ds-dark-theme] .d429g-hero::before { opacity: 1; background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent 60%); }

.d429g-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 16px; transition: background .15s; }
.d429g-row:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)) 50%, transparent); }
.d429g-row + .d429g-row { border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.08)) 55%, transparent); }
.d429g-rowkey { font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.d429g-rowval { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #111); font-variant-numeric: tabular-nums; }
[data-ds-dark-theme] .d429g-row + .d429g-row { border-top-color: rgba(255,255,255,0.06); }
[data-ds-dark-theme] .d429g-row:hover { background: rgba(255,255,255,0.045); }
[data-ds-dark-theme] .d429g-close:hover { background: rgba(255,255,255,0.07); color: var(--dsw-alias-label-primary, #f1f5f9); }

.d429g-toggle { position: relative; width: 42px; height: 24px; flex: 0 0 42px; cursor: pointer; }
.d429g-toggle input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.d429g-track {
  position: absolute; inset: 0; border-radius: 999px; transition: background .25s, box-shadow .25s;
  background: color-mix(in srgb, var(--dsw-alias-fill-subtle, rgba(0,0,0,0.14)) 70%, transparent);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.14);
}
.d429g-toggle[data-on="true"] .d429g-track {
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 65%, transparent);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.25), 0 0 10px color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 38%, transparent);
}
.d429g-thumb {
  position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.9);
  transition: transform .24s cubic-bezier(.34,1.56,.64,1);
}
.d429g-toggle[data-on="true"] .d429g-thumb { transform: translateX(18px); }

.d429g-active {
  margin: 0 16px 12px; padding: 11px 12px; border-radius: 12px; display: flex; align-items: center; gap: 10px;
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 26%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
  animation: d429g-breathe 2.4s ease-in-out infinite;
}
@keyframes d429g-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 0 color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 0%, transparent); }
  50% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 0 14px color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 22%, transparent); }
}
.d429g-spinner {
  width: 17px; height: 17px; flex: 0 0 17px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 26%, transparent);
  border-top-color: var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6));
  animation: d429g-spin .8s linear infinite;
}
@keyframes d429g-spin { to { transform: rotate(360deg); } }
.d429g-activetxt { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); line-height: 1.5; }
.d429g-activetxt b { color: var(--dsw-alias-label-primary, #111); }

.d429g-foot { display: flex; gap: 8px; padding: 12px 16px 14px; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.08)) 55%, transparent); }
.d429g-btn {
  flex: 1; border: none; border-radius: 9px; padding: 8px 10px; font-size: 12px; cursor: pointer; font-weight: 600;
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-state-business-primary, #3b82f6)) 88%, transparent);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 6px rgba(0,0,0,0.14);
  transition: transform .15s, box-shadow .15s, filter .15s, background .15s;
}
.d429g-btn:hover:not(:disabled) { filter: brightness(1.06); box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 12px rgba(0,0,0,0.18); transform: translateY(-1px); }
.d429g-btn:active:not(:disabled) { transform: translateY(0); }
.d429g-btn:disabled { opacity: 0.55; cursor: default; }
.d429g-btn.ghost {
  background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)) 50%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.12)) 55%, transparent); color: var(--dsw-alias-label-primary, #111);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
}
.d429g-btn.ghost:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08)) 60%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,0.3); }
.d429g-btn.ghost:active:not(:disabled) { transform: translateY(0); }

.d429g-toast {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 2147483601;
  padding: 9px 16px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-bg-overlay, #fff)) calc(var(--d429g-o, 0.22) * 100%), transparent);
  color: var(--dsw-alias-label-primary, #111);
  border: 1px solid color-mix(in srgb, var(--d429g-tint, var(--dsw-alias-brand-primary, #3b82f6)) 30%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.65), 0 8px 24px rgba(0,0,0,0.12);
  backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%);
  animation: d429g-toastin .25s ease;
}
@keyframes d429g-toastin { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }

.d429g-cap {
  width: 64px; padding: 5px 6px; border-radius: 8px; font-size: 12px; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.05)) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.12)) 55%, transparent);
  color: var(--dsw-alias-label-primary, #111); text-align: center;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
  transition: border-color .15s, box-shadow .15s;
}
.d429g-cap:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #3b82f6) 16%, transparent); outline: none; }
.d429g-capun { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9ca3af); }
.d429g-capwrap { display: flex; align-items: center; gap: 6px; }
.d429g-slider {
  -webkit-appearance: none; appearance: none; width: 96px; height: 4px; border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,0.14)) 70%, transparent);
  box-shadow: inset 0 1px 1px rgba(0,0,0,0.1); outline: none; cursor: pointer;
}
.d429g-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,0.16)) 60%, transparent);
  box-shadow: 0 1px 3px rgba(0,0,0,0.25); cursor: pointer;
}
.d429g-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%; background: #fff;
  border: 1px solid rgba(0,0,0,0.16); box-shadow: 0 1px 3px rgba(0,0,0,0.25); cursor: pointer;
}
.d429g-slider:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #3b82f6) 16%, transparent); }
.d429g-color {
  -webkit-appearance: none; appearance: none; width: 26px; height: 26px; padding: 0;
  border: 1px solid rgba(255,255,255,0.5); border-radius: 50%; background: transparent; cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 3px rgba(0,0,0,0.15); overflow: hidden;
}
.d429g-color::-webkit-color-swatch-wrapper { padding: 2px; }
.d429g-color::-webkit-color-swatch { border: none; border-radius: 50%; }
.d429g-color::-moz-color-swatch { border: none; border-radius: 50%; }
.d429g-tintbtn {
  border: 1px solid rgba(255,255,255,0.4); background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
  border-radius: 999px; padding: 3px 10px; font-size: 11px; cursor: pointer; font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35); transition: background .15s, color .15s;
}
.d429g-tintbtn:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)) 55%, transparent); color: var(--dsw-alias-label-primary, #111); }
[data-ds-dark-theme] .d429g-color { border-color: rgba(255,255,255,0.22); box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.3); }
[data-ds-dark-theme] .d429g-tintbtn { border-color: rgba(255,255,255,0.16); color: var(--dsw-alias-label-secondary, #94a3b8); }
.d429g-quotawarn {
  margin: 0 16px 12px; padding: 9px 12px; border-radius: 11px; font-size: 11px; line-height: 1.55;
  color: var(--dsw-alias-label-primary, #111);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 36%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
}
.d429g-dot.quota { background: var(--dsw-alias-state-warn-primary, #f59e0b) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 20%, transparent); animation: none; }
[data-ds-dark-theme] .d429g-toast { background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #0f172a) calc(var(--d429g-o, 0.22) * 100%), transparent); border-color: rgba(255,255,255,0.09); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%); }
`

    var DRAG_KEY = 'd429g-pos'
    var DRAG_EDGE = 8
    var GLASS_KEY = 'd429g-glass'
    var GLASS_DEFAULT = 0.22
    var GLASS_MIN = 0.1
    var GLASS_MAX = 0.9
    var TINT_KEY = 'd429g-tint'
    var TINT_DEFAULT_HEX = '#3b82f6'
    var TINT_HEX_RE = /^#[0-9a-fA-F]{6}$/

    function loadGlass() {
      try {
        var raw = window.localStorage.getItem(GLASS_KEY)
        if (!raw) return GLASS_DEFAULT
        var n = Number(raw)
        if (Number.isFinite(n) && n >= GLASS_MIN && n <= GLASS_MAX) return n
      } catch (e) {}
      return GLASS_DEFAULT
    }

    function saveGlass(v) {
      try { window.localStorage.setItem(GLASS_KEY, String(v)) } catch (e) {}
    }

    function loadTint() {
      try {
        var raw = window.localStorage.getItem(TINT_KEY)
        if (raw && TINT_HEX_RE.test(raw)) return raw
      } catch (e) {}
      return null
    }

    function saveTint(hex) {
      try {
        if (hex && TINT_HEX_RE.test(hex)) window.localStorage.setItem(TINT_KEY, hex)
        else window.localStorage.removeItem(TINT_KEY)
      } catch (e) {}
    }

    function loadPos() {
      try {
        var raw = window.localStorage.getItem(DRAG_KEY)
        if (!raw) return null
        var p = JSON.parse(raw)
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y) && isFinite(p.x) && isFinite(p.y)) {
          return { x: p.x, y: p.y }
        }
      } catch (e) {}
      return null
    }

    function savePos(p) {
      try {
        if (p) window.localStorage.setItem(DRAG_KEY, JSON.stringify(p))
        else window.localStorage.removeItem(DRAG_KEY)
      } catch (e) {}
    }

    function apiFetch(path, options) {
      return window.fetch(path, options).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: '非 JSON 响应 (' + res.status + ')' } })
      })
    }

    function ShieldIcon() {
      return createElement('span', { className: 'd429g-icon' },
        createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          createElement('path', { d: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z' }),
          createElement('path', { d: 'M9 12l2 2 4-4' })
        )
      )
    }

    function CloseIcon() {
      return createElement('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
        createElement('path', { d: 'M6 6l12 12M18 6L6 18' })
      )
    }

    function fmtTime(iso) {
      if (!iso) return '—'
      try {
        var d = new Date(iso)
        var pad = function (n) { return (n < 10 ? '0' : '') + n }
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      } catch (e) { return String(iso) }
    }

    function GuardWidget() {
      var open = useState(false)
      var setOpen = open[1]; open = open[0]
      var state = useState({ enabled: false, caps: { maxRetries: null, maxRetryMs: null }, stats: { retriesTotal: 0, blockedTotal: 0, last429At: null, lastRetryAt: null, lastFailure: null }, active: null })
      var setState = state[1]; state = state[0]
      var toast = useState(null)
      var setToast = toast[1]; toast = toast[0]
      var busy = useState(false)
      var setBusy = busy[1]; busy = busy[0]
      var capInput = useState({ maxRetries: '', maxRetryMs: '' })
      var setCapInput = capInput[1]; capInput = capInput[0]
      var pos = useState(loadPos)
      var setPos = pos[1]; pos = pos[0]
      var dragging = useState(false)
      var setDragging = dragging[1]; dragging = dragging[0]
      var glass = useState(loadGlass)
      var setGlass = glass[1]; glass = glass[0]
      var tint = useState(loadTint)
      var setTint = tint[1]; tint = tint[0]

      var hostRef = useRef(null)
      var posRef = useRef(pos)
      posRef.current = pos
      var dragState = useRef({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 })
      var capsSynced = useRef(false)
      var toastTimerRef = useRef(null)
      var clickTimer = useRef(null)

      function clampXY(x, y) {
        var el = hostRef.current
        var w = el ? el.getBoundingClientRect().width : 140
        var h = el ? el.getBoundingClientRect().height : 36
        var vw = window.innerWidth
        var vh = window.innerHeight
        var maxX = Math.max(DRAG_EDGE, vw - w - DRAG_EDGE)
        var maxY = Math.max(DRAG_EDGE, vh - h - DRAG_EDGE)
        return {
          x: Math.min(Math.max(DRAG_EDGE, x), maxX),
          y: Math.min(Math.max(DRAG_EDGE, y), maxY),
        }
      }

      function onPointerMove(e) {
        var d = dragState.current
        if (!d.active) return
        var dx = e.clientX - d.startX
        var dy = e.clientY - d.startY
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (!d.moved) return
        var c = clampXY(d.origX + dx, d.origY + dy)
        posRef.current = c
        setPos(c)
      }

      function onPointerUp() {
        var d = dragState.current
        d.active = false
        setDragging(false)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
        if (d.moved && posRef.current) savePos(posRef.current)
      }

      function onPillPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        var rect = hostRef.current ? hostRef.current.getBoundingClientRect() : null
        dragState.current = {
          active: true,
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          origX: rect ? rect.left : (pos ? pos.x : 0),
          origY: rect ? rect.top : (pos ? pos.y : 0),
        }
        setDragging(true)
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerUp)
        e.preventDefault()
      }

      function onPillClick() {
        if (dragState.current.moved) {
          dragState.current.moved = false
          return
        }
        // 延迟执行：双击时在 dblclick 到达前取消，避免"点开又关"。
        if (clickTimer.current) clearTimeout(clickTimer.current)
        clickTimer.current = setTimeout(function () {
          clickTimer.current = null
          setOpen(function (v) { return !v })
        }, 260)
      }

      function onPillDoubleClick() {
        if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null }
        setPos(null)
        savePos(null)
      }

      // 展开/折叠导致尺寸变化时，确保位置仍在视口内。
      useEffect(function () {
        if (!pos) return
        var c = clampXY(pos.x, pos.y)
        if (c.x !== pos.x || c.y !== pos.y) setPos(c)
      }, [open])

      useEffect(function () {
        var poll = function () {
          apiFetch('/guard-api/state').then(function (res) {
            if (!res || !res.ok) return
            setState(res)
            // 首次拿到 caps 后回填输入框（避免轮询覆盖用户输入）。
            if (!capsSynced.current && res.caps) {
              capsSynced.current = true
              setCapInput({
                maxRetries: res.caps.maxRetries != null ? String(res.caps.maxRetries) : '',
                maxRetryMs: res.caps.maxRetryMs != null ? String(Math.round(res.caps.maxRetryMs / 1000)) : '',
              })
            }
          }).catch(function () {})
        }
        poll()
        var timer = setInterval(poll, 2000)
        return function () { if (timer) clearInterval(timer) }
      }, [])

      function showToast(msg) {
        setToast(msg)
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(function () { setToast(null) }, 2200)
      }

      function toggle() {
        if (busy) return
        setBusy(true)
        var next = !state.enabled
        apiFetch('/guard-api/enable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        }).then(function (res) {
          if (res && res.ok) {
            setState(res)
            showToast(next ? '已开启 429 无限重试' : '已关闭，恢复默认行为')
          } else {
            showToast((res && res.error) || '切换失败')
          }
        }).catch(function (err) {
          showToast(String(err && err.message || err))
        }).finally(function () { setBusy(false) })
      }

      function resetStats() {
        if (busy) return
        setBusy(true)
        apiFetch('/guard-api/reset', { method: 'POST' }).then(function (res) {
          if (res && res.ok) setState(res); else showToast((res && res.error) || '重置失败')
        }).catch(function (err) { showToast(String(err && err.message || err)) })
          .finally(function () { setBusy(false) })
      }

      function saveCaps() {
        if (busy) return
        setBusy(true)
        var mr = String(capInput.maxRetries || '').trim()
        var ms = String(capInput.maxRetryMs || '').trim()
        apiFetch('/guard-api/caps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maxRetries: mr === '' ? null : Number(mr),
            maxRetryMs: ms === '' ? null : Number(ms) * 1000,
          }),
        }).then(function (res) {
          if (res && res.ok) {
            setState(res)
            setCapInput({
              maxRetries: res.caps && res.caps.maxRetries != null ? String(res.caps.maxRetries) : '',
              maxRetryMs: res.caps && res.caps.maxRetryMs != null ? String(Math.round(res.caps.maxRetryMs / 1000)) : '',
            })
            showToast('设防已保存：' + (res.caps && (res.caps.maxRetries != null || res.caps.maxRetryMs != null) ? '有限次' : '无限'))
          } else {
            showToast((res && res.error) || '保存失败')
          }
        }).catch(function (err) { showToast(String(err && err.message || err)) })
          .finally(function () { setBusy(false) })
      }

      var activeList = state.active && state.active.length ? state.active : null
      var retrying = !!(activeList && activeList.length)
      var retries = (state.stats && state.stats.retriesTotal) || 0
      var lf = state.stats && state.stats.lastFailure
      var isQuota = !!(lf && lf.code === 'QUOTA')
      var quotaWarn = false
      if (isQuota && state.stats.last429At) {
        var age = Date.now() - new Date(state.stats.last429At).getTime()
        if (Number.isFinite(age) && age >= 0 && age < 10 * 60 * 1000) quotaWarn = true
      }

      var hostStyle = { zIndex: 2147483600, '--d429g-o': String(glass) }
      if (tint) hostStyle['--d429g-tint'] = tint
      if (pos) {
        hostStyle.left = pos.x + 'px'
        hostStyle.top = pos.y + 'px'
        hostStyle.right = 'auto'
      }

      function onGlassChange(e) {
        var raw = Number(e.target.value)
        if (!Number.isFinite(raw)) return
        var v = raw / 100
        if (!Number.isFinite(v) || v < GLASS_MIN || v > GLASS_MAX) return
        setGlass(v)
        saveGlass(v)
      }

      function onTintChange(e) {
        var hex = String(e.target.value || '')
        if (!TINT_HEX_RE.test(hex)) return
        setTint(hex)
        saveTint(hex)
      }

      function onTintReset() {
        setTint(null)
        saveTint(null)
      }

      // 折叠胶囊。
      var pill = createElement('div', {
        className: 'd429g-pill' + (dragging ? ' dragging' : '') + (retrying ? ' retrying' : ''),
        role: 'button',
        tabIndex: 0,
        title: (state.enabled ? '429 守卫 · 开启中' : '429 守卫 · 已关闭') + (retrying ? ' · 正在自动重试' : '') + '（拖动移动 · 双击复位右上角）',
        'aria-label': '429 守卫开关',
        onPointerDown: onPillPointerDown,
        onClick: onPillClick,
        onDoubleClick: onPillDoubleClick,
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } },
      },
        createElement(ShieldIcon),
        createElement('span', { className: 'd429g-dot ' + (state.enabled ? 'on' : 'off') + (quotaWarn ? ' quota' : '') }),
        createElement('span', { className: 'd429g-pilllabel' }, '429 守卫'),
        retries > 0
          ? createElement('span', { key: String(retries), className: 'd429g-badge' + (state.enabled ? '' : ' idle'), title: '累计已自动重试 ' + retries + ' 次' }, String(retries))
          : null
      )

      if (!open) {
        return createElement('div', { className: 'd429g-host' + (dragging ? ' dragging' : ''), style: hostStyle, ref: hostRef },
          pill,
          toast ? createElement('div', { className: 'd429g-toast' }, toast) : null
        )
      }

      var lf = state.stats && state.stats.lastFailure
      var lastCode = lf && lf.code ? lf.code : '—'
      var lastStatus = lf && lf.status ? ('HTTP ' + lf.status) : ''
      var capHint = (state.caps && (state.caps.maxRetries != null || state.caps.maxRetryMs != null))
        ? '有限' : '无限'

      var rows = createElement('div', null,
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey' }, '自动无限重试'),
          createElement('label', { className: 'd429g-toggle', 'data-on': state.enabled ? 'true' : 'false', title: state.enabled ? '点击关闭' : '点击开启' },
            createElement('input', { type: 'checkbox', checked: state.enabled, onChange: toggle, disabled: busy, 'aria-label': '429 无限重试开关' }),
            createElement('span', { className: 'd429g-track' }),
            createElement('span', { className: 'd429g-thumb' })
          )
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey', title: '逃生存活阀：留空 = 无限重试' }, '最大重试次数'),
          createElement('span', { className: 'd429g-capwrap' },
            createElement('input', {
              className: 'd429g-cap', type: 'number', min: 1, placeholder: '∞',
              value: capInput.maxRetries,
              onChange: function (e) { setCapInput({ maxRetries: e.target.value, maxRetryMs: capInput.maxRetryMs }) },
              'aria-label': '最大重试次数',
            }),
            createElement('span', { className: 'd429g-capun' }, '次')
          )
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey', title: '逃生存活阀：留空 = 不限时长' }, '最长重试时长'),
          createElement('span', { className: 'd429g-capwrap' },
            createElement('input', {
              className: 'd429g-cap', type: 'number', min: 1, placeholder: '∞',
              value: capInput.maxRetryMs,
              onChange: function (e) { setCapInput({ maxRetries: capInput.maxRetries, maxRetryMs: e.target.value }) },
              'aria-label': '最长重试时长（秒）',
            }),
            createElement('span', { className: 'd429g-capun' }, '秒')
          )
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey', title: '毛玻璃透明度：半透明表面 + 背景模糊的强度' }, '毛玻璃透明度'),
          createElement('span', { className: 'd429g-capwrap' },
            createElement('input', {
              className: 'd429g-slider', type: 'range', min: 10, max: 90, step: 5,
              value: String(Math.round(glass * 100)),
              onChange: onGlassChange,
              'aria-label': '毛玻璃透明度',
            }),
            createElement('span', { className: 'd429g-capun' }, String(Math.round(glass * 100)) + '%')
          )
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey', title: '玻璃着色：自定义毛玻璃底色色调，默认跟随主题品牌色' }, '玻璃颜色'),
          createElement('span', { className: 'd429g-capwrap' },
            createElement('input', {
              className: 'd429g-color', type: 'color', value: tint || TINT_DEFAULT_HEX,
              onChange: onTintChange,
              'aria-label': '玻璃颜色',
            }),
            createElement('button', { className: 'd429g-tintbtn', onClick: onTintReset, title: '恢复默认主题色' }, '默认')
          )
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey' }, '累计重试'),
          createElement('span', { className: 'd429g-rowval' }, String(retries))
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey' }, '最近拦截'),
          createElement('span', { className: 'd429g-rowval' }, fmtTime(state.stats && state.stats.last429At))
        ),
        createElement('div', { className: 'd429g-row' },
          createElement('span', { className: 'd429g-rowkey' }, '最近错误'),
          createElement('span', { className: 'd429g-rowval', title: (lf && lf.message) || '' }, lastCode + (lastStatus ? ' · ' + lastStatus : ''))
        )
      )

      return createElement('div', { className: 'd429g-host' + (dragging ? ' dragging' : ''), style: hostStyle, ref: hostRef },
        pill,
        createElement('div', { className: 'd429g-card' },
          createElement('div', { className: 'd429g-hero' },
            createElement('div', { className: 'd429g-herotitle' },
              createElement(ShieldIcon), '429 / 配额守卫'
            ),
            createElement('div', { className: 'd429g-herosub' },
              '开启后，模型请求遇到 429（含 insufficient_quota / QUOTA）将自动重试（默认无限次），直至成功、达到设防上限或你手动停止。'
            ),
            createElement('button', { className: 'd429g-close', onClick: function () { setOpen(false) }, 'aria-label': '关闭' },
              createElement(CloseIcon)
            )
          ),
          rows,
          quotaWarn
            ? createElement('div', { className: 'd429g-quotawarn' },
                '⚠ 检测到配额耗尽（QUOTA' + (lf && lf.provider ? ' · ' + lf.provider : '') + '）：余额/配额可能已用尽，建议检查账户。当前按「' + capHint + '次」策略继续自动重试。'
              )
            : null,
          activeList
            ? createElement('div', { className: 'd429g-active' },
                createElement('span', { className: 'd429g-spinner' }),
                createElement('span', { className: 'd429g-activetxt' },
                  createElement('b', null, '正在重试'),
                  ' · ' + activeList[0].provider + ' · 第 ' + activeList[0].retry + ' 次'
                )
              )
            : null,
          createElement('div', { className: 'd429g-foot' },
            createElement('button', { className: 'd429g-btn', onClick: toggle, disabled: busy },
              busy ? '处理中…' : (state.enabled ? '关闭守卫' : '开启守卫')
            ),
            createElement('button', { className: 'd429g-btn ghost', onClick: saveCaps, disabled: busy }, '应用设防'),
            createElement('button', { className: 'd429g-btn ghost', onClick: resetStats, disabled: busy || !retries }, '清零')
          )
        ),
        toast ? createElement('div', { className: 'd429g-toast' }, toast) : null
      )
    }

    function apply(ctx) {
      // 注入样式（生命周期随插件 fiber）。
      var tagId = 'dsh-429-guard/guard.css'
      if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
        var tag = document.createElement('style')
        tag.setAttribute('data-plugin', 'dsh-429-guard')
        tag.setAttribute('data-plugin-css', tagId)
        tag.textContent = CSS
        document.head.appendChild(tag)
      }

      var slots = ctx.get('slots')
      if (slots === undefined) return
      ctx.effect(function () {
        return ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-429-guard', order: 9999, label: '429 守卫' },
            GuardWidget
          )
        })
      }, '429-guard: register shell.overlay float widget')
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})

//# sourceMappingURL=client.js.map