import { Hono } from "hono";
import { validator } from "hono/validator";

type Bindings = {
  readonly DB: D1Database;
  readonly QUEUE: Queue;
  readonly BUCKET: R2Bucket;
};
type Environment = {
  readonly Bindings: Bindings;
};

const app = new Hono<Environment>();

app.post("/queue", async (c) => {
  try {
    const data = await c.req.json();
    await c.env.QUEUE.send({ time: Date.now(), ...(data ?? {}) });

    return c.text("ok");
  } catch (e) {
    if (e instanceof Error) {
      return c.json({ message: e.message, name: e.name });
    } else {
      return c.json({ message: JSON.stringify(e), name: "unknown-error" });
    }
  }
});

app.get("/posts", async (c) => {
  const stmt = c.env.DB.prepare("select * from posts;");
  const out = await stmt.all();

  return c.json(out.results);
});

app.post(
  "/post",
  validator((v) => ({
    title: v.json("title").isRequired(),
    body: v.json("body").isRequired(),
  })),
  async (c) => {
    const res = c.req.valid();

    const stmt = c.env.DB.prepare(
      "insert into posts (title, body) values (?, ?)"
    );
    const out = await stmt.bind(res.title, res.body).run();

    return c.json(out);
  }
);

export default {
  ...app,
  async queue(batch: MessageBatch<unknown>, env: Bindings): Promise<void> {
    const random = Math.random();

    try {
      if (random > 0.5) throw new Error("random error");

      await env.BUCKET.put(
        `queues/${Date.now()}.log`,
        JSON.stringify(batch.messages, null, 2)
      );
    } catch {
      batch.retryAll();
    }
  },
};
