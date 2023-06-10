import type { Context, Env, MiddlewareHandler } from "hono";

type Notifier<E extends Env> = {
  (c: Context<E>): (data: string) => Promise<void>;
};

export const fireEvent =
  <E extends Env>(notifier: Notifier<E>): MiddlewareHandler =>
  async (c, next) => {
    await next();

    const pair = await c.res.body?.tee();
    if (!pair) return;
    const [fst, snd] = pair;

    c.res = new Response(fst, c.res);
    const stream = await snd.getReader().read();

    const data = new TextDecoder().decode(stream.value);
    await notifier(c)(data);
  };
