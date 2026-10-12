// "Create slides with AI": the outline becomes designed slides that fit, in a theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const deck = await import(pathToFileURL("src/slides/ai-deck.ts").href);
const photo = { url: "https://images.unsplash.com/photo-1", alt: "A leaf", credit: "Ada Obi", credit_url: "https://unsplash.com/@ada", download_location: "https://api.unsplash.com/photos/x/download" };
const texts = (c) => c.elements.filter((e) => e.type === "text").map((e) => e.text);
const inside = (e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 1600 && e.y + e.h <= 900;

test("the deck opens with a title, ends with a recap, and keeps to the count", () => {
  const o = deck.tidyOutline({ title: "Photosynthesis", slides: [
    { layout: "points", heading: "What plants need", points: ["Light", "Water", "Air"] },
    { layout: "picture", heading: "Leaves", points: ["Green", "Flat"], image_query: "leaf" },
    { layout: "points", heading: "Food", points: ["Sugar"] },
    { layout: "bogus", heading: "Dropped" }
  ] }, 6);
  assert.deepEqual(o.slides.map((s) => s.layout), ["title", "points", "picture", "points", "summary"]);
  assert.deepEqual(o.slides.at(-1).points, ["What plants need", "Leaves", "Food"]);
  const many = deck.tidyOutline({ title: "T", slides: Array.from({ length: 20 }, (_, i) => ({ layout: "points", heading: `S${i}`, points: ["a"] })) }, 8);
  assert.equal(many.slides.length, 8);
  assert.equal(many.slides[0].layout, "title");
});

test("every layout fits the slide, credits its photo, and falls back without one", () => {
  for (const layout of deck.DECK_LAYOUTS) {
    const s = { layout, heading: "A heading that is fairly long for a slide", subheading: "More detail", points: ["One point", "Two points here", "Three"],
      left_heading: "Left", left_points: ["a", "b"], right_heading: "Right", right_points: ["c"], notes: "Say this." };
    for (const theme of Object.keys(deck.THEMES)) {
      const withPhoto = deck.designSlide(s, deck.THEMES[theme], photo);
      for (const e of withPhoto.elements) assert.ok(inside(e), `${layout}/${theme}: ${e.type} off the slide`);
      const pics = withPhoto.elements.filter((e) => e.type === "image");
      if (pics.length) assert.ok(texts(withPhoto).some((t) => t.includes("Ada Obi")), `${layout}: photo credited`);
    }
  }
  const noPhoto = deck.designSlide({ layout: "picture", heading: "Leaves", points: ["Green"] }, deck.THEMES.swift);
  assert.equal(noPhoto.elements.some((e) => e.type === "image"), false);
  assert.ok(texts(noPhoto).includes("Leaves"));
});

test("long text is shortened and shrunk to fit", () => {
  assert.ok(deck.fitSize("x".repeat(400), 600, 200, 64, 20) < 64);
  assert.equal(deck.fitSize("Short", 1400, 140, 64, 40), 64);
  const s = deck.designSlide({ layout: "points", heading: "H".repeat(300), points: Array.from({ length: 9 }, () => "word ".repeat(40)) }, deck.THEMES.swift);
  const [h, body] = s.elements;
  assert.ok(h.text.length <= 90);
  assert.equal(body.text.split("\n").length, 5);
});

test("notes carry the photo credit", () => {
  const d = deck.buildDeck({ title: "T", slides: [{ layout: "title", heading: "T", notes: "Welcome the class." }] }, [photo], "ocean");
  assert.match(d[0].notes, /Welcome the class/);
  assert.match(d[0].notes, /Photo by Ada Obi on Unsplash/);
});
