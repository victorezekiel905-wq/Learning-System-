// The question importer: text, exam papers and spreadsheets into questions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { parseQuestions, tableToText, MARK } = await import(pathToFileURL("src/lib/question-import.ts").href);
const QUIZ = ["mcq", "multi_select", "true_false", "fill_blank", "matching", "ordering", "categorize", "short", "open", "draw", "code", "file"];
const MC = ["mcq", "multi_select", "true_false"];
const right = (q) => q.options.filter((o) => o.is_correct).map((o) => o.label);

test("numbered questions with lettered options and an Answer line", () => {
  const qs = parseQuestions(`1. What is the capital of Nigeria?
A. Lagos
B. Abuja
C. Kano
D. Ibadan
Answer: B
Topic: Geography

2) 2 + 2 = ?
(a) 3
(b) 4
(c) 5
Ans: (b)
Points: 2`, MC);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].kind, "mcq");
  assert.equal(qs[0].prompt, "What is the capital of Nigeria?");
  assert.deepEqual(qs[0].options.map((o) => o.label), ["Lagos", "Abuja", "Kano", "Ibadan"]);
  assert.deepEqual(right(qs[0]), ["Abuja"]);
  assert.equal(qs[0].topic, "Geography");
  assert.deepEqual(right(qs[1]), ["4"]);
  assert.equal(qs[1].points, 2);
  assert.ok(qs.every((q) => !q.problem));
});

test("answers marked with *, (correct), [x] or Word formatting; options on one line", () => {
  const qs = parseQuestions(`Q1. Pick the even number
A. 3
B. 8 *
C. 5

Question 2: Which is a mammal?
- Shark
- Whale (correct)
- Eagle

3. Select the primes
[x] 2
[ ] 4
[x] 7

4. Choose the vowel
A. b   B. e   C. k   D. t
Answer: B

5. Which planet is largest?
A. Mars
B. Jupiter${MARK}
C. Venus`, MC);
  assert.equal(qs.length, 5);
  assert.deepEqual(right(qs[0]), ["8"]);
  assert.deepEqual(right(qs[1]), ["Whale"]);
  assert.equal(qs[2].kind, "multi_select");
  assert.deepEqual(right(qs[2]), ["2", "7"]);
  assert.deepEqual(qs[3].options.map((o) => o.label), ["b", "e", "k", "t"]);
  assert.deepEqual(right(qs[3]), ["e"]);
  assert.deepEqual(right(qs[4]), ["Jupiter"]);
  assert.ok(qs.every((q) => !q.problem), JSON.stringify(qs.map((q) => q.problem)));
});

test("formatting that covers every option is not taken as the answer", () => {
  const [q] = parseQuestions(`1. Which is a fruit?\nA. Mango${MARK}\nB. Yam${MARK}`, MC);
  assert.match(q.problem, /which option is right/);
});

test("answer by option text, several letters, and true / false", () => {
  const qs = parseQuestions(`1. Capital of Ghana?
A. Accra
B. Kumasi
Answer: Accra

2. Which are colours?
A. Red
B. Dog
C. Blue
Answer: A and C

3. The sun is a star.
Answer: True

4. Fish can fly.
A. True
B. False
Answer: F`, MC);
  assert.deepEqual(right(qs[0]), ["Accra"]);
  assert.equal(qs[1].kind, "multi_select");
  assert.deepEqual(right(qs[1]), ["Red", "Blue"]);
  assert.equal(qs[2].kind, "true_false");
  assert.deepEqual(qs[2].options.map((o) => o.label), ["True", "False"]);
  assert.deepEqual(right(qs[2]), ["True"]);
  assert.deepEqual(right(qs[3]), ["False"]);
});

test("unnumbered questions, wrapped lines and equations stay in the right place", () => {
  const qs = parseQuestions(`Solve for x.
2x + 3 = 7
A. 1
B. 2
Answer: B
Which is bigger?
A. 1.5 litres
B. 900 ml
Answer: A`, MC);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].prompt, "Solve for x.\n2x + 3 = 7");
  assert.deepEqual(right(qs[0]), ["2"]);
  assert.equal(qs[1].prompt, "Which is bigger?");
  assert.deepEqual(qs[1].options.map((o) => o.label), ["1.5 litres", "900 ml"]);
});

test("a missing or wrong answer is reported, not guessed", () => {
  const [a, b] = parseQuestions(`1. What is 3 x 3?\nA. 6\nB. 9\n\n2. What is 2 x 2?\nA. 4\nB. 5\nAnswer: E`, MC);
  assert.match(a.problem, /which option is right/);
  assert.match(b.problem, /isn't there|doesn't match/);
});

test("other question types in a quiz", () => {
  const qs = parseQuestions(`1. The chemical symbol for water is ........
Answer: H2O | h2o

2. Match each animal to its group.
Lion = Mammal
Eagle -> Bird

3. Put these in order, smallest first.
Type: Order
1. Atom
2. Cell
3. Organ

4. Sort these numbers.
Type: Groups
Even: 2, 4
Odd: 3, 5

5. Explain why the sky looks blue.

6. ___ is the capital of Kenya and ___ of Uganda.
Answer: Nairobi; Kampala`, QUIZ);
  assert.deepEqual(qs.map((q) => q.kind), ["fill_blank", "matching", "ordering", "categorize", "open", "fill_blank"]);
  assert.equal(qs[0].prompt, "The chemical symbol for water is ___");
  assert.deepEqual(qs[0].answer_key, { blanks: [["H2O", "h2o"]] });
  assert.deepEqual(qs[1].config.left.map((x) => x.label), ["Lion", "Eagle"]);
  assert.deepEqual(qs[1].answer_key.pairs, { l1: "r1", l2: "r2" });
  assert.deepEqual(qs[2].config.items.map((x) => x.label), ["Atom", "Cell", "Organ"]);
  assert.equal(qs[3].config.categories.length, 2);
  assert.equal(Object.keys(qs[3].answer_key.placements).length, 4);
  assert.deepEqual(qs[5].answer_key, { blanks: [["Nairobi"], ["Kampala"]] });
  assert.ok(qs.every((q) => !q.problem), JSON.stringify(qs.map((q) => q.problem)));
});

test("questions fit the slide: polls, open-ended, and kinds the slide can't hold", () => {
  const [poll] = parseQuestions(`1. Favourite subject?\nA. Maths\nB. Art`, ["poll"]);
  assert.equal(poll.kind, "poll");
  assert.ok(!poll.problem);
  assert.ok(poll.options.every((o) => !o.is_correct));
  const [open] = parseQuestions(`1. Describe your weekend.`, ["open"]);
  assert.equal(open.kind, "open");
  const [blank] = parseQuestions(`1. Water is ___.\nAnswer: wet`, MC);
  assert.match(blank.problem, /fill in the blanks/);
});

test("spreadsheets with a header row, and without one", () => {
  const withHeader = tableToText([
    ["Question", "Option A", "Option B", "Option C", "Answer", "Topic"],
    ["Capital of Nigeria?", "Lagos", "Abuja", "Kano", "B", "Geography"],
    ["", "", "", "", "", ""],
    ["5 x 5?", "10", "25", "", "25", ""]
  ]);
  const qs = parseQuestions(withHeader, MC);
  assert.equal(qs.length, 2);
  assert.deepEqual(right(qs[0]), ["Abuja"]);
  assert.equal(qs[0].topic, "Geography");
  assert.deepEqual(qs[1].options.map((o) => o.label), ["10", "25"]);
  assert.deepEqual(right(qs[1]), ["25"]);

  const bare = parseQuestions(tableToText([["Largest ocean?", "Atlantic", "Pacific", "Indian", "B"]]), MC);
  assert.deepEqual(right(bare[0]), ["Pacific"]);
});

test("tidied text reads back as the same questions", async () => {
  const { questionsToText } = await import(pathToFileURL("src/lib/question-import.ts").href);
  const source = `Which planet is largest?
A. Mars
B. Jupiter${MARK}
C. Venus
Topic: Space

2. Match them.
Lion = Mammal
Eagle = Bird

3. Order these.
Type: Order
- Seed
- Plant

4. Even or odd?
Type: Groups
Even: 2, 4
Odd: 3

5. Rivers flow into ___.
Answer: the sea | seas
Points: 2`;
  const first = parseQuestions(source, QUIZ);
  const again = parseQuestions(questionsToText(first), QUIZ);
  const shape = (qs) => qs.map((q) => ({ kind: q.kind, prompt: q.prompt, points: q.points, topic: q.topic, options: q.options,
    left: q.config.left, items: q.config.items?.map((i) => i.label), cats: q.config.categories, blanks: q.answer_key.blanks, problem: q.problem }));
  assert.ok(first.every((q) => !q.problem), JSON.stringify(first.map((q) => q.problem)));
  assert.deepEqual(shape(again), shape(first));
  assert.deepEqual(right(first[0]), ["Jupiter"]);
});

test("a title above numbered questions is skipped; Word paragraphs never continue an option", async () => {
  const { questionsToText } = await import(pathToFileURL("src/lib/question-import.ts").href);
  const word = `Mid-term test: Basic Science
Answer all questions.
1. Which organ pumps blood?
A. Lungs
B. Heart${MARK}
The process plants use to make food is called ........
Answer: photosynthesis
2. Pick one
A. X
B. Y
Answer: Q`;
  const qs = parseQuestions(word, QUIZ, { paragraphs: true });
  assert.deepEqual(qs.map((q) => q.kind), ["mcq", "fill_blank", "mcq"]);
  assert.deepEqual(right(qs[0]), ["Heart"]);
  assert.deepEqual(qs[1].answer_key, { blanks: [["photosynthesis"]] });
  assert.ok(qs[2].problem);
  // Tidying keeps the question that needs a fix exactly as written.
  assert.match(questionsToText(qs), /3\. Pick one\nA\. X\nB\. Y\nAnswer: Q$/);
});
