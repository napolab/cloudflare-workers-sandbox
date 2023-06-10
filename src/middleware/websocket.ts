import type { Env, MiddlewareHandler } from "hono";

export const wsupgrade =
  <E extends Env>(): MiddlewareHandler<E> =>
  async (c, next) => {
    if (c.req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", {
        status: 426,
        statusText: "Upgrade Required",
      });
    }
    await next();
  };
