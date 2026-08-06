// ─── Via Plugin (S1 / KAN-30) ─────────────────────────────────────────────────
//
// Reads the X-Kanon-Client header on every request, normalizes it against the
// closed vocabulary (claude-code | cursor | codex | antigravity | web | cli), and sets
// request.via. Unknown or absent values resolve to null.

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { normalizeVia } from "../shared/via.js";

async function viaPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate with null as the default so Fastify knows the type at boot time
  fastify.decorateRequest("via", null as string | null);

  fastify.addHook("onRequest", async (request) => {
    const headerValue = request.headers["x-kanon-client"];
    // headers can be string | string[] | undefined; we only care about string
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    request.via = normalizeVia(raw);
  });
}

export default fp(viaPlugin, {
  name: "via",
});
