"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTwoViewFrameQueue = createTwoViewFrameQueue;
// Keep this factory self-contained: its compiled body is also used in the
// webview. Decode off-screen and present that same image, never a new src on the
// visible image (async decoding can otherwise paint an empty/black frame).
function createTwoViewFrameQueue(options) {
    let disposed = false;
    let requested = null;
    let displayed = null;
    let failed = null;
    let decoding = null;
    function pump() {
        if (disposed || decoding || !requested || requested === displayed || requested === failed)
            return;
        const source = requested;
        const image = options.createImage();
        decoding = image;
        image.src = source;
        image.decode().then(() => {
            if (disposed || decoding !== image || requested === displayed)
                return;
            // Finish the current decode even if newer frames arrived. Dropping every
            // completed frame when decoding is slower than delivery would starve the
            // viewer. Next, decode only the newest request, not the intervening frames.
            options.present(image);
            displayed = source;
            failed = null;
        }).catch(error => {
            if (disposed || decoding !== image)
                return;
            failed = source;
            options.onError(error);
        }).finally(() => {
            if (decoding !== image)
                return;
            decoding = null;
            pump();
        });
    }
    return {
        update(source) {
            if (disposed)
                return;
            requested = source;
            pump();
        },
        dispose() {
            disposed = true;
            requested = displayed = failed = null;
            const image = decoding;
            decoding = null;
            image?.removeAttribute("src");
        }
    };
}
//# sourceMappingURL=view2D.js.map