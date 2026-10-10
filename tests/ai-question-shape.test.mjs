// "Write with AI": Claude's drafts become importer questions, and survive the
// browser's round trip (questions -> importer text -> parsed again) unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { toImported } = await import(pathToFileURL("src/lib/ai-question-shape.ts").href);
const { parseQuestions, questionsToText } = await import(pathToFileURL("src/lib/question-import.ts").href);
const QUIZ = ["mcq", "multi_select", "true_false", "fill_blank", "short", "open"];
const draft = (d) => ({ options: [], answers: [], explanation: "", topic: "", ...d });

test("good drafts map to importer questions and survive the round trip", () => {
  const drafts = [
    draft({ kind: "mcq", prompt: "What is the capital of Nigeria?", options: [{ label: "Lagos", is_correct: false }, { label: "Abuja", is_correct: true }, { label: "Kano", is_correct: false }, { label: "Ibadan", is_correct: false }], explanation: "Abuja has been the capital since 1991.", topic: "Geography" }),
    draft({ kind: "multi_select", prompt: "Which of these are prime numbers?", options: [{ label: "2", is_correct: true }, { label: "4", is_correct: false }, { label: "7", is_correct: true }, { label: "9", is_correct: false }], topic: "Numbers" }),
    draft({ kind: "true_false", prompt: "Water boils at 100 °C at sea level.", options: [{ label: "True", is_correct: true }, { label: "False", is_correct: false }] }),
    draft({ kind: "fill_blank", prompt: "The capital of Nigeria is ___.", answers: ["Abuja"] }),
    draft({ kind: "short", prompt: "Explain why the Moon shines at night.", answers: ["It reflects light from the Sun."], explanation: "The Moon makes no light of its own." })
  ];
  const qs = drafts.map(toImported);
  assert.ok(qs.every(Boolean));
  assert.equal(qs[0].options.find((o) => o.is_correct).label, "Abuja");
  assert.deepEqual(qs[3].answer_key, { blanks: [["Abuja"]] });
  assert.match(qs[4].explanation, /^Expected answer: It reflects light from the Sun\./);
  assert.equal(qs[4].points, 5);

  const again = parseQuestions(questionsToText(qs), QUIZ);
  assert.equal(again.filter((q) => !q.problem).length, 5, JSON.stringify(again.filter((q) => q.problem)));
  assert.deepEqual(again.map((q) => q.kind), ["mcq", "multi_select", "true_false", "fill_blank", "short"]);
  assert.deepEqual(again[1].options.filter((o) => o.is_correct).map((o) => o.label), ["2", "7"]);
  assert.equal(again[0].topic, "Geography");
});

test("drafts that don't hold together are dropped", () => {
  const bad = [
    draft({ kind: "mcq", prompt: "Two right answers?", options: [{ label: "A", is_correct: true }, { label: "B", is_correct: true }] }),
    draft({ kind: "mcq", prompt: "No right answer?", options: [{ label: "A", is_correct: false }, { label: "B", is_correct: false }] }),
    draft({ kind: "fill_blank", prompt: "No blank here.", answers: ["x"] }),
    draft({ kind: "fill_blank", prompt: "Two blanks ___ and ___.", answers: ["one"] }),
    draft({ kind: "true_false", prompt: "   ", options: [{ label: "True", is_correct: true }, { label: "False", is_correct: false }] })
  ];
  assert.deepEqual(bad.map(toImported), [null, null, null, null, null]);
});
