interface DecodableImage {
  src: string;
  decode(): Promise<void>;
  removeAttribute(name: string): void;
}

// Keep this factory self-contained: its compiled body is also used in the
// webview. Decode off-screen and present that same image, never a new src on the
// visible image (async decoding can otherwise paint an empty/black frame).
export function createTwoViewFrameQueue<Image extends DecodableImage>(options: {
  createImage(): Image;
  present(image: Image): void;
  onError(error: unknown): void;
}) {
  let disposed = false;
  let requested: string | null = null;
  let displayed: string | null = null;
  let failed: string | null = null;
  let decoding: Image | null = null;

  function pump(): void {
    if (disposed || decoding || !requested || requested === displayed || requested === failed) return;
    const source = requested;
    const image = options.createImage();
    decoding = image;
    image.src = source;
    image.decode().then(() => {
      if (disposed || decoding !== image || requested === displayed) return;
      // Finish the current decode even if newer frames arrived. Dropping every
      // completed frame when decoding is slower than delivery would starve the
      // viewer. Next, decode only the newest request, not the intervening frames.
      options.present(image);
      displayed = source;
      failed = null;
    }).catch(error => {
      if (disposed || decoding !== image) return;
      failed = source;
      options.onError(error);
    }).finally(() => {
      if (decoding !== image) return;
      decoding = null;
      pump();
    });
  }

  return {
    update(source: string): void {
      if (disposed) return;
      requested = source;
      pump();
    },
    dispose(): void {
      disposed = true;
      requested = displayed = failed = null;
      const image = decoding;
      decoding = null;
      image?.removeAttribute("src");
    }
  };
}
