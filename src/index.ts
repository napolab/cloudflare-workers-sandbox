import { Hono } from "hono";
import { validator } from "hono/validator";

type QueueMessage =
  | {
      type: "LOG";
      payload: unknown;
    }
  | {
      type: "POSTS";
      payload: unknown;
    };

type Bindings = {
  readonly DB: D1Database;
  readonly QUEUE: Queue<QueueMessage>;
  readonly BUCKET: R2Bucket;
};
type Environment = {
  readonly Bindings: Bindings;
};

const app = new Hono<Environment>();

app.get("/websocket", (c) => {
  const upgradeHeader = c.req.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const { 0: client, 1: server } = new WebSocketPair();

  server.accept();
  server.send("hello");

  server.addEventListener("message", (e) => {
    server.send(e.data);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

app.post("/queue", async (c) => {
  try {
    const data = await c.req.json();
    await c.env.QUEUE.send({ type: "LOG", payload: data ?? {} });

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

    await c.env.QUEUE.send({ type: "POSTS", payload: out });

    return c.json(out);
  }
);

export default {
  ...app,
  async queue(batch: MessageBatch<QueueMessage>, env: Bindings): Promise<void> {
    const random = Math.random();

    try {
      if (random > 0.5) throw new Error("random error");
      const log: Message<QueueMessage>[] = [];
      const posts: Message<QueueMessage>[] = [];

      for (const message of batch.messages) {
        switch (message.body.type) {
          case "LOG":
            log.push(message);
            break;
          case "POSTS":
            posts.push(message);
            break;
        }
      }

      if (log.length > 0) {
        await env.BUCKET.put(
          `queues/${Date.now()}.log`,
          JSON.stringify(batch.messages, null, 2)
        );
      }
      if (posts.length > 0) {
        const json = JSON.stringify(
          posts.map((post) => post.body.payload),
          null,
          2
        );

        const ws = new WebSocket("ws://127.0.0.1:8787/websocket");
        ws.send(json);
        ws.close();
      }
    } catch (e) {
      console.log(e);
      batch.retryAll();
    }
  },
};
