import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { fireEvent } from "./middleware";
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

const notifier = (c: Context<Environment>) => async (data: string) => {
  const doId = c.env.SHARED_EVENT.idFromName("A");
  const obj = c.env.SHARED_EVENT.get(doId);
  const url = new URL(c.req.url);
  url.pathname = "/event";

  await obj.fetch(url.href, {
    method: "POST",
    body: data,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

const app = new Hono<Environment>();
app.use("*", prettyJSON());

app.get("/posts", async (c) => {
  const db = drizzle(c.env.DB);
  const data = await db.select().from(posts).all();

  return c.json(data);
});

app.get("/posts-events", async (c) => {
  const doId = c.env.SHARED_EVENT.idFromName("A");
  const obj = c.env.SHARED_EVENT.get(doId);

  const url = new URL(c.req.url);
  url.pathname = "/events";
  const response = await obj.fetch(url, {
    headers: c.req.headers,
  });

  return response;
});

app.post(
  "/post",
  zValidator("json", z.object({ title: z.string(), body: z.string() })),
  fireEvent<Environment>(notifier),
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
