/**
 * @module httpCapped
 *
 * Read a `fetch()` body with a hard byte ceiling.
 *
 * These lived in `vite.config.js` until the amenity pack needed them from a
 * standalone build script, and a build script must not import the dev server's
 * config to read one JSON document. `vite.config.js` re-exports both names, so
 * every caller there is unchanged.
 */

/**
 * Read a fetch() Response body as text with a hard byte cap. Rejects early on an
 * oversized Content-Length, then streams with a running cap so a chunked or
 * length-omitted response cannot blow past the limit. Throws { code:'RESPONSE_TOO_LARGE' }.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Release the socket. Refusing on the header and then walking away leaves
    // undici holding an open connection until GC gets to it, which is the
    // resource this cap exists to protect.
    try { await response.body?.cancel?.(); } catch { /* no-op */ }
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Parse a fetch() JSON response only after enforcing a hard byte cap.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<any>}
 */
export async function readResponseJsonCapped(response, maxBytes) {
  return JSON.parse(await readResponseTextCapped(response, maxBytes));
}
