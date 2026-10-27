import { createKnowledgeBase } from './knowledge-base.mjs';
const knowledge = createKnowledgeBase();
console.log(JSON.stringify(knowledge.stats(), null, 2));
knowledge.close();
