import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMediaCard,
  youtubeEmbed,
  safeMediaUrl,
} from "../../web/lib/media";
const card = {
  id: "id",
  room: "room",
  kind: "image",
  origin: "web",
  status: "ready",
  title: "Photo",
  url: "https://example.org/photo.png",
};
test("media cards reject foreign rooms and unsafe URLs", () => {
  assert.ok(parseMediaCard(card, "room"));
  assert.equal(parseMediaCard(card, "other"), null);
  for (const url of [
    "javascript:alert(1)",
    "http://example.org",
    "https://127.0.0.1/",
    "https://169.254.169.254/",
    "https://user:pw@example.org/",
  ]) {
    assert.equal(safeMediaUrl(url), false);
    assert.equal(parseMediaCard({ ...card, url }, "room"), null);
  }
  assert.equal(parseMediaCard({ ...card, url: undefined }, "room"), null);
});
test("video embeds are constructed from allowed YouTube hosts and IDs only", () => {
  assert.equal(
    youtubeEmbed("https://www.youtube.com/watch?v=abcdefghijk"),
    "https://www.youtube-nocookie.com/embed/abcdefghijk",
  );
  for (const url of [
    "https://evil.org/watch?v=abcdefghijk",
    "https://youtube.com.evil.org/watch?v=abcdefghijk",
    "https://youtube.com/watch?v=<script>",
  ])
    assert.equal(youtubeEmbed(url), null);
});
