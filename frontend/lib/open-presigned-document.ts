/**
 * Open a document in a new tab after fetching a presigned URL.
 * Uses a synchronous about:blank window (user-gesture safe) then assigns the URL.
 * Do not use window.open(..., "noopener") before assign — many browsers return null.
 */
export function openPresignedDocumentInNewTab(
  fetchUrl: () => Promise<{ url: string }>,
): void {
  if (typeof window === "undefined") return;
  const w = window.open("about:blank", "_blank");
  if (w == null) {
    window.alert(
      "Could not open a new tab. Allow popups for this site and try again.",
    );
    return;
  }
  void fetchUrl()
    .then(({ url }) => {
      w.location.assign(url);
    })
    .catch((err) => {
      w.close();
      window.alert(
        err instanceof Error ? err.message : "Failed to open document",
      );
    });
}
