DROP TABLE IF EXISTS posts;

CREATE TABLE posts (
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

INSERT INTO posts (title, body) VALUES ('title', 'body');
