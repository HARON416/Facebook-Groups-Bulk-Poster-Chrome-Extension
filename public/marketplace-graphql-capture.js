(() => {
  const targetFriendlyName =
    "MarketplaceYouSellingFastActiveSectionPaginationQuery";
  const captureEventName = "__soar_marketplace_graphql_captured__";
  const readyEventName = "__soar_marketplace_graphql_capture_ready__";

  window.__soarRestoreMarketplaceGraphqlCapture?.();

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  let restored = false;

  const headersToObject = (headersLike) => {
    const headers = {};
    try {
      new Headers(headersLike || {}).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } catch (_) {}
    return headers;
  };

  const bodyToText = async (bodyLike, request) => {
    if (typeof bodyLike === "string") return bodyLike;
    if (bodyLike instanceof URLSearchParams) return bodyLike.toString();
    if (bodyLike instanceof FormData)
      return new URLSearchParams(bodyLike).toString();
    if (request) {
      try {
        return await request.clone().text();
      } catch (_) {
        return "";
      }
    }
    return "";
  };

  const restore = () => {
    if (!restored) {
      restored = true;
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalXhrOpen;
      XMLHttpRequest.prototype.setRequestHeader = originalXhrSetRequestHeader;
      XMLHttpRequest.prototype.send = originalXhrSend;
      delete window.__soarRestoreMarketplaceGraphqlCapture;
    }
  };

  window.__soarRestoreMarketplaceGraphqlCapture = restore;
  const restoreTimeout = window.setTimeout(restore, 100000);

  const isTargetRequest = (url, headers, bodyText) => {
    if (!String(url).includes("/api/graphql")) return false;
    if (headers["x-fb-friendly-name"] === targetFriendlyName) return true;
    const body = new URLSearchParams(bodyText);
    return (
      body.get("fb_api_req_friendly_name") === targetFriendlyName ||
      bodyText.includes(targetFriendlyName)
    );
  };

  const capture = (request) => {
    const body = new URLSearchParams(request.body);
    const detail = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      cookie: document.cookie,
      fbDtsg: body.get("fb_dtsg") || "",
      lsd: body.get("lsd") || "",
      userId: body.get("__user") || "",
      aaid: body.get("__aaid") || "",
      rev: body.get("__rev") || "",
      hsi: body.get("__hsi") || "",
      hs: body.get("__hs") || "",
      s: body.get("__s") || "",
      jazoest: body.get("jazoest") || "",
      docId: body.get("doc_id") || "",
    };
    window.clearTimeout(restoreTimeout);
    restore();
    window.dispatchEvent(
      new CustomEvent(captureEventName, { detail: JSON.stringify(detail) }),
    );
  };

  window.fetch = async function (...args) {
    const [input, init = {}] = args;
    const request = input instanceof Request ? input : null;
    const url = request?.url || String(input || "");
    const headers = {
      ...headersToObject(request?.headers),
      ...headersToObject(init.headers),
    };
    const bodyText = await bodyToText(init.body, request);
    const response = await originalFetch.apply(this, args);
    try {
      if (isTargetRequest(url, headers, bodyText)) {
        capture({
          url,
          method: init.method || request?.method || "GET",
          headers,
          body: bodyText,
        });
      }
    } catch (error) {
      console.warn("Marketplace GraphQL capture failed:", error);
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__soarMarketplaceGraphqlCapture = {
      method,
      url: String(url),
      headers: {},
    };
    return originalXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__soarMarketplaceGraphqlCapture) {
      this.__soarMarketplaceGraphqlCapture.headers[name.toLowerCase()] = value;
    }
    return originalXhrSetRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (bodyLike) {
    try {
      const request = this.__soarMarketplaceGraphqlCapture;
      const body =
        typeof bodyLike === "string"
          ? bodyLike
          : bodyLike instanceof URLSearchParams
            ? bodyLike.toString()
            : bodyLike instanceof FormData
              ? new URLSearchParams(bodyLike).toString()
              : "";
      if (request && isTargetRequest(request.url, request.headers, body)) {
        capture({
          url: request.url,
          method: request.method || "GET",
          headers: request.headers,
          body,
        });
      }
    } catch (error) {
      console.warn("Marketplace GraphQL XHR capture failed:", error);
    }
    return originalXhrSend.call(this, bodyLike);
  };

  window.dispatchEvent(new CustomEvent(readyEventName));
})();
