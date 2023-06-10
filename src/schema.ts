import { text, integer, sqliteTable } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable("posts", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),

  createdAt: integer("createdAt", { mode: "timestamp" }),
});
