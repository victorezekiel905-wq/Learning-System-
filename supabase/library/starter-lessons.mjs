// SwiftCipher's starter library: ready-made lessons on the Nigerian curriculum.
// Each becomes a library_lessons row (migration 1060); teachers copy one into their
// school and edit it. Facts checked by hand; keep every question unambiguous.
//
// Shape: { id, title, subject, level, description, slides: [{ kind, content } | { kind: "activity", activity }] }
// Question options mark the right answer with is_correct.

const mc = (prompt, options, right, explanation, topic) => ({
  kind: "mcq", prompt, points: 1, explanation, topic,
  options: options.map((label, i) => ({ label, is_correct: i === right }))
});
const tf = (prompt, isTrue, explanation, topic) => ({
  kind: "true_false", prompt, points: 1, explanation, topic,
  options: [{ label: "True", is_correct: isTrue }, { label: "False", is_correct: !isTrue }]
});
const title = (heading, body) => ({ kind: "title", content: { heading, body } });
const text = (heading, body) => ({ kind: "text", content: { heading, body } });
const quiz = (questions, name = "Check your understanding") => ({ kind: "activity", activity: { kind: "quiz", title: name, questions } });

export const STARTER_LESSONS = [
  {
    id: "5c1f0a00-0000-4000-8000-000000000001", title: "Light: where it comes from", subject: "Basic Science", level: "JSS 1",
    description: "Luminous and non-luminous objects, light travelling in straight lines, shadows, and transparent, translucent and opaque materials.",
    slides: [
      title("Light", "Where light comes from, and how we see things"),
      text("Luminous and non-luminous objects", "- **Luminous** objects give out their own light: the Sun, a candle flame, a torch bulb, a firefly.\n- **Non-luminous** objects do not make light. We see them because light bounces off them into our eyes: the Moon, a mirror, a book, your desk."),
      text("Light travels in straight lines", "- Light moves in straight lines. That is why we cannot see round corners.\n- When an opaque object blocks light, a **shadow** forms behind it.\n- **Transparent** materials (clear glass) let light through. **Translucent** materials (frosted glass) let some through. **Opaque** materials (wood) let none through."),
      quiz([
        mc("Which of these gives out its own light?", ["The Moon", "The Sun", "A mirror", "A window"], 1, "The Sun makes its own light. The Moon only reflects sunlight.", "Sources of light"),
        mc("Why can we see the Moon at night?", ["It makes its own light", "It reflects light from the Sun", "It is very hot", "It is close to the Earth"], 1, "The Moon is non-luminous: sunlight bounces off it to our eyes.", "Sources of light"),
        tf("Light travels in straight lines.", true, "That is why shadows have sharp edges and we cannot see round corners.", "How light travels"),
        mc("Which material is opaque?", ["Clear glass", "Frosted glass", "Wood", "Clean water"], 2, "Wood lets no light through, so it is opaque.", "Materials and light"),
        mc("A shadow forms when…", ["light passes through glass", "an opaque object blocks light", "a mirror reflects light", "a candle is lit"], 1, "Light cannot pass through an opaque object, so the space behind it is dark.", "Shadows")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000002", title: "Equivalent fractions", subject: "Mathematics", level: "JSS 1",
    description: "Fractions with the same value, making them by multiplying or dividing, and simplifying.",
    slides: [
      title("Equivalent fractions", "Same value, different names"),
      text("What makes fractions equivalent?", "- Equivalent fractions have the **same value**.\n- Multiply or divide the **top and bottom by the same number**: 1/2 = 2/4 = 3/6 = 5/10.\n- To simplify, divide the top and bottom by a common factor: 6/8 = 3/4 (both divided by 2)."),
      text("Worked example", "Is 3/4 equal to 9/12?\n\nMultiply the top and bottom of 3/4 by 3: 3 × 3 = 9 and 4 × 3 = 12.\n\nSo **3/4 = 9/12**."),
      quiz([
        mc("Which fraction is equivalent to 1/2?", ["2/3", "3/6", "2/5", "1/4"], 1, "3/6: the top and bottom of 1/2 are both multiplied by 3.", "Equivalent fractions"),
        mc("Simplify 6/8.", ["3/4", "2/3", "1/2", "6/4"], 0, "Divide the top and bottom by 2: 6/8 = 3/4.", "Simplifying fractions"),
        tf("2/3 and 4/6 are equivalent fractions.", true, "Multiply the top and bottom of 2/3 by 2 to get 4/6.", "Equivalent fractions"),
        mc("3/5 is equal to how many twentieths?", ["9/20", "12/20", "15/20", "8/20"], 1, "5 × 4 = 20, so multiply the top by 4 too: 3 × 4 = 12.", "Equivalent fractions"),
        mc("Which fraction is in its simplest form?", ["4/10", "6/9", "5/7", "8/12"], 2, "5 and 7 have no common factor except 1.", "Simplifying fractions")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000003", title: "Simple interest", subject: "Mathematics", level: "SS 1",
    description: "The formula I = PRT ÷ 100, the amount at the end, and finding the time.",
    slides: [
      title("Simple interest", "What money earns, or costs, over time"),
      text("The formula", "Simple interest **I = P × R × T ÷ 100**\n\n- **P** is the principal: the money saved or borrowed.\n- **R** is the rate: the percentage per year.\n- **T** is the time in years."),
      text("Worked example", "Ada saves ₦20,000 at 5% simple interest a year for 3 years.\n\nI = 20,000 × 5 × 3 ÷ 100 = **₦3,000**\n\nThe amount at the end is 20,000 + 3,000 = **₦23,000**."),
      quiz([
        mc("Find the simple interest on ₦10,000 at 10% a year for 2 years.", ["₦1,000", "₦2,000", "₦12,000", "₦200"], 1, "I = 10,000 × 10 × 2 ÷ 100 = ₦2,000.", "Simple interest"),
        mc("In I = PRT ÷ 100, what does P stand for?", ["Profit", "Principal", "Percentage", "Period"], 1, "P is the principal: the money saved or borrowed.", "Simple interest"),
        mc("₦5,000 is saved at 4% simple interest for 5 years. What is the amount at the end?", ["₦5,200", "₦6,000", "₦1,000", "₦5,400"], 1, "I = 5,000 × 4 × 5 ÷ 100 = ₦1,000, so the amount is ₦6,000.", "Amount"),
        tf("With simple interest, the interest is the same every year.", true, "Simple interest is always worked out on the principal, so each year earns the same.", "Simple interest"),
        mc("How long will ₦8,000 take to earn ₦1,600 at 5% simple interest?", ["2 years", "4 years", "5 years", "8 years"], 1, "T = I × 100 ÷ (P × R) = 1,600 × 100 ÷ (8,000 × 5) = 4 years.", "Finding the time")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000004", title: "Parts of speech", subject: "English", level: "JSS 2",
    description: "Nouns, verbs, adjectives and adverbs, and how to spot them in a sentence.",
    slides: [
      title("Parts of speech", "The jobs words do in a sentence"),
      text("Four key parts of speech", "- **Noun**: names a person, place or thing (Tunde, Kano, book).\n- **Verb**: shows an action or a state (run, write, is).\n- **Adjective**: describes a noun (tall, blue, clever).\n- **Adverb**: describes a verb, and often ends in -ly (quickly, quietly, well)."),
      text("Spot them", "In **The clever girl answered quickly**:\n\n- clever: adjective\n- girl: noun\n- answered: verb\n- quickly: adverb"),
      quiz([
        mc("In \"The dog barked loudly\", which word is the verb?", ["dog", "barked", "loudly", "The"], 1, "Barked is the action.", "Verbs"),
        mc("Which word is an adjective?", ["happily", "beautiful", "run", "Lagos"], 1, "Beautiful describes a noun, as in \"a beautiful song\".", "Adjectives"),
        mc("In \"She sang sweetly\", what part of speech is \"sweetly\"?", ["Noun", "Verb", "Adjective", "Adverb"], 3, "Sweetly tells us how she sang, so it describes the verb.", "Adverbs"),
        tf("\"Abuja\" is a noun.", true, "Abuja names a place.", "Nouns"),
        mc("Which sentence has an adjective describing a noun?", ["He runs fast.", "The red car stopped.", "They laughed.", "Come here now."], 1, "Red describes the noun car.", "Adjectives")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000005", title: "Nigeria: states and capital", subject: "Social Studies", level: "JSS 1",
    description: "The 36 states and the FCT, the capital, independence, and the six geopolitical zones.",
    slides: [
      title("Nigeria, our country", "States, capital and zones"),
      text("Key facts", "- Nigeria has **36 states** and the **Federal Capital Territory (FCT)**.\n- The capital is **Abuja**. It replaced Lagos as the capital in **1991**.\n- Nigeria became independent on **1 October 1960**.\n- The states are grouped into **six geopolitical zones**: North Central, North East, North West, South East, South South and South West."),
      quiz([
        mc("How many states does Nigeria have?", ["30", "36", "37", "40"], 1, "36 states, plus the Federal Capital Territory.", "States"),
        mc("What is the capital of Nigeria?", ["Lagos", "Abuja", "Kano", "Ibadan"], 1, "Abuja has been the capital since 1991.", "Capital"),
        mc("When did Nigeria become independent?", ["1 October 1960", "1 October 1963", "12 June 1993", "29 May 1999"], 0, "Nigeria became independent on 1 October 1960.", "History"),
        tf("Lagos is still Nigeria's capital.", false, "Abuja replaced Lagos as the capital in 1991.", "Capital"),
        mc("How many geopolitical zones are there in Nigeria?", ["Four", "Five", "Six", "Seven"], 2, "North Central, North East, North West, South East, South South and South West.", "Geopolitical zones")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000006", title: "Photosynthesis", subject: "Biology", level: "SS 1",
    description: "How green plants make food: raw materials, products, chlorophyll, chloroplasts and stomata.",
    slides: [
      title("Photosynthesis", "How green plants make their food"),
      text("What happens", "Green plants make glucose from **carbon dioxide** and **water**, using **light energy** trapped by **chlorophyll**. Oxygen is given off.\n\ncarbon dioxide + water → glucose + oxygen (in light, with chlorophyll)"),
      text("Where it happens", "- In the **chloroplasts**, mostly in the cells of leaves.\n- Carbon dioxide enters the leaf through tiny pores called **stomata**.\n- Water travels up from the roots through the **xylem**."),
      quiz([
        mc("Which gas do plants take in for photosynthesis?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"], 1, "Carbon dioxide is one of the two raw materials, with water.", "Raw materials"),
        mc("Which green pigment traps light energy?", ["Haemoglobin", "Chlorophyll", "Melanin", "Keratin"], 1, "Chlorophyll in the chloroplasts traps light.", "Chlorophyll"),
        mc("Which of these is a product of photosynthesis?", ["Carbon dioxide", "Water", "Glucose", "Nitrogen"], 2, "The products are glucose and oxygen.", "Products"),
        tf("Photosynthesis takes place in the chloroplasts.", true, "Chloroplasts contain the chlorophyll that traps light.", "Where it happens"),
        mc("Through which openings does carbon dioxide enter a leaf?", ["Xylem", "Stomata", "Roots", "Phloem"], 1, "Stomata are tiny pores, mostly on the underside of the leaf.", "Where it happens")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000007", title: "States of matter", subject: "Basic Science", level: "Primary 5",
    description: "Solids, liquids and gases, and melting, freezing, evaporation and condensation.",
    slides: [
      title("States of matter", "Solids, liquids and gases"),
      text("Three states", "- **Solids** keep their shape (stone, ice, wood).\n- **Liquids** flow and take the shape of their container (water, oil, milk).\n- **Gases** spread out to fill any space (air, steam, cooking gas)."),
      text("Changing state", "- Heating ice makes it **melt** into water.\n- Heating water makes it **evaporate** into steam.\n- Cooling steam makes it **condense** back into water.\n- Cooling water makes it **freeze** into ice."),
      quiz([
        mc("Which of these is a liquid?", ["Stone", "Milk", "Air", "Ice"], 1, "Milk flows and takes the shape of its container.", "Liquids"),
        mc("What happens when ice is heated?", ["It freezes", "It melts", "It condenses", "It stays the same"], 1, "Heat turns solid ice into liquid water: melting.", "Changing state"),
        tf("A gas spreads out to fill any space.", true, "That is why you can smell cooking from another room.", "Gases"),
        mc("Water turning into steam is called…", ["freezing", "melting", "evaporation", "condensation"], 2, "Heating a liquid until it becomes a gas is evaporation.", "Changing state"),
        mc("Which of these is a solid?", ["Water", "Steam", "Wood", "Oil"], 2, "Wood keeps its shape.", "Solids")
      ])
    ]
  },
  {
    id: "5c1f0a00-0000-4000-8000-000000000008", title: "Place value", subject: "Mathematics", level: "Primary 4",
    description: "Thousands, hundreds, tens and units, and the value of each digit.",
    slides: [
      title("Place value", "What each digit is worth"),
      text("Thousands, hundreds, tens and units", "In **4,725**:\n\n- 4 is in the **thousands** place: 4,000\n- 7 is in the **hundreds** place: 700\n- 2 is in the **tens** place: 20\n- 5 is in the **units** place: 5\n\n4,000 + 700 + 20 + 5 = 4,725"),
      quiz([
        mc("What is the value of 6 in 3,642?", ["6", "60", "600", "6,000"], 2, "6 is in the hundreds place, so it is worth 600.", "Place value"),
        mc("Which number has 8 in the tens place?", ["8,123", "1,284", "2,348", "8,000"], 1, "In 1,284 the digits are 1 thousand, 2 hundreds, 8 tens and 4 units.", "Place value"),
        mc("Write 5,000 + 300 + 40 + 2 as a number.", ["5,342", "5,432", "534", "50,342"], 0, "5 thousands, 3 hundreds, 4 tens and 2 units make 5,342.", "Expanded form"),
        tf("In 9,105, the digit 0 is in the tens place.", true, "9 thousands, 1 hundred, 0 tens and 5 units.", "Place value"),
        mc("What is the value of 9 in 9,051?", ["9", "90", "900", "9,000"], 3, "9 is in the thousands place, so it is worth 9,000.", "Place value")
      ])
    ]
  }
];
