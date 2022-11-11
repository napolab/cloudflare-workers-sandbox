import { Hono } from "hono";
import { validator } from "hono/validator";

type Bindings = {
  DB: any;
};
type Environment = {
  Bindings: Bindings;
};

const app = new Hono<Environment>();

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

export default app;
