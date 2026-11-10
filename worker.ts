// @ts-nocheck -- `.open-next/worker.js` only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";
import { sweepToken } from "./lib/meta/crypto";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

/**
 * OpenNext's Worker plus a cron trigger. Every few minutes the sweep retries
 * failed Meta leads, advances historical imports and reconciles recent leads.
 * It goes through the normal app route so it shares the app's code and config.
 */
export default {
  fetch: handler.fetch,

  async scheduled(_event, env, ctx) {
    if (!env.META_APP_SECRET) return;
    const request = new Request("https://gulbargahomes.com/api/integrations/meta/sweep", {
      method: "POST",
      headers: { "x-meta-sweep-token": await sweepToken(env.META_APP_SECRET) },
    });
    ctx.waitUntil(handler.fetch(request, env, ctx).then((response) => response.text()));
  },
};
