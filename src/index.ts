import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { fireEvent, wsupgrade } from "./middleware";
import { posts } from "./schema";

import type { Context } from "hono";

export * from "./durable-object";

type QueueMessage = {
  type: "LOG";
  payload: unknown;
};

type Bindings = {
  readonly DB: D1Database;
  readonly QUEUE: Queue<QueueMessage>;
  readonly BUCKET: R2Bucket;
  readonly SHARED_EVENT: DurableObjectNamespace;
};
type Environment = {
  readonly Bindings: Bindings;
};

const sharedEvent = (c: Context<Environment>) => (type: string) => {
  const doId = c.env.SHARED_EVENT.idFromName(type);

  return c.env.SHARED_EVENT.get(doId);
};

const notifier =
  (type: string) => (c: Context<Environment>) => async (data: string) => {
    const obj = sharedEvent(c)(type);

    await obj.fetch(new URL("/event", c.req.url), {
      method: "POST",
      body: data,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

const app = new Hono<Environment>();
app.use("/api/*", cors(), etag(), prettyJSON());
app.use("/subscribe/*", wsupgrade());
app.notFound((c) => c.json({ message: "Not Found", ok: false }, 404));

app.get("/api/posts", async (c) => {
  const db = drizzle(c.env.DB);
  const data = await db.select().from(posts).all();

  return c.json(data);
});
app.get("/subscribe/posts", async (c) => {
  const obj = sharedEvent(c)("posts");
  const response = await obj.fetch(new URL("/events", c.req.url), {
    headers: c.req.headers,
  });

  return response;
});

app.post(
  "/api/post",
  zValidator("json", z.object({ title: z.string(), body: z.string() })),
  fireEvent<Environment>(notifier("posts")),
  async (c) => {
    const res = c.req.valid("json");
    const db = drizzle(c.env.DB);

    await db.insert(posts).values({
      title: res.title,
      body: res.body,
      createdAt: new Date(),
    });
    const result = await db.select().from(posts).all();

    return c.json(result);
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
        }
      }

      if (log.length > 0) {
        await env.BUCKET.put(
          `queues/${Date.now()}.log`,
          JSON.stringify(batch.messages, null, 2)
        );
      }
    } catch (e) {
      batch.retryAll();
    }
  },
};
