"use strict";
const surveys=require("../survey_data");
const errors=[],ids=new Set(),prompts=new Set();
for(const [index,q] of surveys.entries()){
  if(!q.id||ids.has(q.id))errors.push(`Question ${index+1}: missing or duplicate ID`);ids.add(q.id);
  const prompt=String(q.question||"").trim().toLowerCase();if(!prompt||prompts.has(prompt))errors.push(`${q.id}: empty or duplicate prompt`);prompts.add(prompt);
  if(!Array.isArray(q.answers)||q.answers.length!==5)errors.push(`${q.id}: exactly five answers required`);
  const answerText=new Set();
  for(const a of q.answers||[]){const text=String(a.text||"").trim().toLowerCase();if(!text||answerText.has(text))errors.push(`${q.id}: empty or repeated answer`);answerText.add(text);if(!Number.isInteger(a.points)||a.points<=0)errors.push(`${q.id}: invalid points`);if(!Array.isArray(a.aliases))errors.push(`${q.id}: aliases must be an array`);}
}
if(surveys.length!==200)errors.push(`Expected 200 questions, found ${surveys.length}`);
const general=surveys.filter(q=>q.category==="General Life").length;
if(general<180)errors.push(`Expected at least 180 General Life questions, found ${general}`);
if(errors.length){console.error(errors.join("\n"));process.exit(1)}
console.log(`PASS: ${surveys.length} survey questions validated (${general} General Life, ${surveys.length-general} mixed).`);
