import fs from 'fs';
import { embed, cosineSimilarity } from './embeddings.js';

async function test() {
  const q = await embed("April Jane", true);
  const a = await embed("This is a medical note about April Jane.", false);
  const b = await embed("4mxbeDqNGB9Tp5cBt8AqZ3RDExnvhTbd", false);
  
  console.log(`Similarity (Target): ${cosineSimilarity(q, a)}`);
  console.log(`Similarity (Noise):  ${cosineSimilarity(q, b)}`);
}

test();
