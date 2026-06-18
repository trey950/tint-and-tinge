// Server-side classifier. Identical math to the client SPA; we re-run it
// on the server using the answers stored in Stripe metadata to guarantee
// the PDF and email contain the verified result the customer paid for.

import { SEASONS } from "./seasons.js";

// Questionnaire schema — option deltas in (warmth, value, chroma).
// Must match /public/index.html QUESTIONS array, by id and option index.
export const QUESTIONS = [
  { id: "skin", options: [
    { warmth:0, value:0.6, chroma:0 },
    { warmth:0, value:0.4, chroma:0 },
    { warmth:0, value:0, chroma:0 },
    { warmth:0, value:-0.3, chroma:0 },
    { warmth:0, value:-0.6, chroma:0 },
    { warmth:0, value:-0.9, chroma:0 },
  ]},
  { id: "vein", options: [
    { warmth:-0.8, value:0, chroma:0 },
    { warmth:0.8, value:0, chroma:0 },
    { warmth:0, value:0, chroma:0 },
    { warmth:0, value:0, chroma:-0.2 },
  ]},
  { id: "sun", options: [
    { warmth:-0.4, value:0.4, chroma:0.3 },
    { warmth:0.2, value:0, chroma:0 },
    { warmth:0.6, value:-0.3, chroma:-0.2 },
    { warmth:0.4, value:-0.6, chroma:-0.1 },
  ]},
  { id: "hair", options: [
    { warmth:-0.2, value:0.9, chroma:0.3 },
    { warmth:0.7, value:0.5, chroma:0.2 },
    { warmth:-0.5, value:0.4, chroma:-0.3 },
    { warmth:0.2, value:0.1, chroma:-0.1 },
    { warmth:0.3, value:-0.3, chroma:-0.1 },
    { warmth:0.9, value:-0.2, chroma:0.2 },
    { warmth:0, value:-0.6, chroma:0.2 },
    { warmth:-0.5, value:-0.9, chroma:0.5 },
  ]},
  { id: "eye", options: [
    { warmth:-0.6, value:0.7, chroma:0.3 },
    { warmth:-0.4, value:0, chroma:0.7 },
    { warmth:-0.6, value:0.2, chroma:-0.3 },
    { warmth:0.5, value:0, chroma:0.2 },
    { warmth:0.7, value:0, chroma:-0.3 },
    { warmth:0.7, value:0.2, chroma:0 },
    { warmth:0.3, value:-0.3, chroma:0 },
    { warmth:-0.2, value:-0.7, chroma:0.4 },
  ]},
  { id: "jewelry", options: [
    { warmth:0.8, value:0, chroma:0 },
    { warmth:0.3, value:0.2, chroma:0 },
    { warmth:-0.8, value:0, chroma:0.2 },
    { warmth:-0.6, value:0.3, chroma:0.3 },
    { warmth:0, value:0, chroma:0 },
  ]},
  { id: "white", options: [
    { warmth:-0.7, value:0, chroma:0.5 },
    { warmth:0.7, value:0, chroma:-0.3 },
    { warmth:0, value:0, chroma:0 },
  ]},
  { id: "best", options: [
    { warmth:0.6, value:0.3, chroma:0.4 },
    { warmth:0.8, value:-0.2, chroma:-0.3 },
    { warmth:-0.3, value:0.2, chroma:-0.7 },
    { warmth:-0.4, value:-0.6, chroma:0.4 },
    { warmth:-0.3, value:-0.2, chroma:0.9 },
    { warmth:-0.2, value:0.8, chroma:-0.2 },
  ]},
  { id: "worst", options: [
    { warmth:0.4, value:0.6, chroma:-0.5 },
    { warmth:-0.4, value:-0.3, chroma:0.4 },
    { warmth:0, value:0, chroma:-0.7 },
    { warmth:0, value:0, chroma:0.7 },
    { warmth:-0.7, value:0, chroma:0 },
    { warmth:0.7, value:0, chroma:0 },
  ]},
  { id: "contrast", options: [
    { warmth:0, value:-0.3, chroma:0.7 },
    { warmth:0, value:0, chroma:0 },
    { warmth:0, value:0.3, chroma:-0.7 },
  ]},
];

const clamp = (x) => Math.max(-1, Math.min(1, x));

export function classify(answers) {
  let warmth = 0, value = 0, chroma = 0, answered = 0;
  for (const q of QUESTIONS) {
    const idx = answers[q.id];
    if (idx === undefined || idx === null) continue;
    const o = q.options[idx];
    if (!o) continue;
    warmth += o.warmth;
    value  += o.value;
    chroma += o.chroma;
    answered++;
  }
  if (!answered) throw new Error("No questionnaire answers provided");

  warmth = clamp(warmth / 4);
  value  = clamp(value / 4);
  chroma = clamp(chroma / 4);

  let best = null, bestDist = Infinity;
  for (const [name, data] of Object.entries(SEASONS)) {
    const c = data.coords;
    const d = (warmth - c.warmth)**2 + (value - c.value)**2 + (chroma - c.chroma)**2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  const confidence = Math.max(40, Math.min(98, Math.round(100 - bestDist * 28)));

  return {
    season: best,
    data: SEASONS[best],
    confidence,
    axes: { warmth, value, chroma },
  };
}
