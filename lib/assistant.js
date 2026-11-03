// Cook-mode assistant: short answers about the recipe someone is cooking right now.
import { ExtractError, aiAvailable, askClaude, responseText } from "./extract.js";

const SYSTEM_PROMPT = `You help someone who is cooking a recipe right now, usually with busy hands, so they read your answer at a glance. Answer their question about this recipe in one to three short sentences of plain text, with no markdown or lists. Give specific amounts, times, and temperatures when they help, scaled to the recipe below. If a substitution changes the result, say how. If the question has nothing to do with cooking, say briefly that you can only help with cooking.`;

// history: earlier turns as [{ role: "user" | "assistant", content }], oldest first.
export async function askAssistant(recipe, history, question) {
  if (!aiAvailable()) {
    throw new ExtractError("The assistant needs AI. Add your ANTHROPIC_API_KEY to the .env file and restart Al Dente.", 503);
  }
  const response = await askClaude({
    output_config: { effort: "low" },
    system: `${SYSTEM_PROMPT}\n\nThe recipe:\n${recipeText(recipe)}`,
    messages: [...history, { role: "user", content: question }],
  });
  const answer = responseText(response).trim();
  if (!answer) throw new ExtractError("The assistant didn't have an answer. Try asking another way.", 502);
  return answer;
}

function recipeText(r) {
  const lines = [r.title];
  const facts = [["Makes", r.yield], ["Prep", r.prepTime], ["Cook", r.cookTime], ["Total", r.totalTime]].filter(([, v]) => v);
  if (facts.length) lines.push(facts.map(([k, v]) => `${k}: ${v}`).join(" · "));
  lines.push("", "Ingredients:");
  for (const g of r.ingredientGroups) {
    if (g.name) lines.push(`${g.name}:`);
    lines.push(...g.items.map((item) => `- ${item}`));
  }
  lines.push("", "Steps:");
  let n = 0;
  for (const g of r.stepGroups) {
    if (g.name) lines.push(`${g.name}:`);
    lines.push(...g.steps.map((step) => `${++n}. ${step}`));
  }
  if (r.notes?.length) lines.push("", "Notes:", ...r.notes.map((note) => `- ${note}`));
  return lines.join("\n");
}
