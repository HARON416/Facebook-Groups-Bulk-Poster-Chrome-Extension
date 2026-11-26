// A connectivity probe only needs response headers. Always close the body:
// dropping a Response can leave native network buffers alive until a later GC,
// which is particularly expensive in a worker running for many hours.
export async function probePostingUrl(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    const reachable = response.type !== "opaqueredirect";
    try {
      await response.body?.cancel();
    } catch {
      // Headers already establish reachability even if cancellation races an
      // abort or the server closes the stream.
    }
    return reachable;
  } catch {
    return false;
  }
}
