"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isViewMouseState = isViewMouseState;
exports.createViewMouseInput = createViewMouseInput;
function isViewMouseState(value) {
    if (!value || typeof value !== "object")
        return false;
    const state = value;
    return typeof state.inside === "boolean" && typeof state.down === "boolean"
        && (!state.down || state.inside)
        && Number.isFinite(state.u) && state.u >= 0 && state.u < 1
        && Number.isFinite(state.v) && state.v >= 0 && state.v < 1;
}
// Self-contained factory shared by tests and the generated webview. Only motion
// is coalesced; presses, releases and leaving the view are sent immediately.
function createViewMouseInput(options) {
    let state = { inside: false, down: false, u: 0, v: 0 };
    let sent = state;
    let pending;
    let disposed = false;
    function flush() {
        if (pending !== undefined)
            options.cancel(pending);
        pending = undefined;
        if (disposed || (state.inside === sent.inside && state.down === sent.down
            && state.u === sent.u && state.v === sent.v))
            return;
        sent = state;
        options.send(state);
    }
    function reset() {
        state = { ...state, inside: false, down: false };
        flush();
    }
    return {
        update(point, image, immediate = false) {
            if (disposed)
                return;
            if (!image || image.width <= 0 || image.height <= 0 || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
                reset();
                return;
            }
            const scale = Math.min(image.width / image.naturalWidth, image.height / image.naturalHeight);
            const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
            const u = (point.x - image.left - (image.width - width) / 2) / width;
            const v = (point.y - image.top - (image.height - height) / 2) / height;
            const inside = u >= 0 && u < 1 && v >= 0 && v < 1;
            const next = inside ? { inside, down: point.down, u, v } : { ...state, inside: false, down: false };
            const transition = next.inside !== state.inside || next.down !== state.down;
            state = next;
            if (immediate || transition)
                flush();
            else if (pending === undefined)
                pending = options.schedule(flush);
        },
        reset,
        dispose() {
            reset();
            disposed = true;
        }
    };
}
//# sourceMappingURL=viewMouse.js.map