const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

async function run() {
  const res = await fetch(`${url}/rest/v1/items?select=name&limit=10000`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  const data = await res.json();
  
  const words = {};
  for (const row of data) {
    if (!row.name) continue;
    const tokens = row.name.toLowerCase().split(/[^a-z0-9]+/);
    for (const t of tokens) {
      if (t) words[t] = (words[t] || 0) + 1;
    }
  }
  
  const sorted = Object.entries(words).sort((a,b) => b[1] - a[1]);
  console.log("Top 50 words:");
  console.log(sorted.slice(0, 50).map(x => `${x[0]}: ${x[1]}`).join('\n'));
  
  // Look for specific patterns
  const shoePatterns = new Set();
  const cPatterns = new Set();
  const bPatterns = new Set();
  for (const row of data) {
    if (!row.name) continue;
    const name = row.name.toLowerCase();
    const tokens = name.split(/[^a-z0-9]+/);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === 'shoe') {
        if (i > 0) shoePatterns.add(tokens[i-1] + ' shoe');
      }
      if (tokens[i] === 'c' && i < tokens.length - 1) {
          cPatterns.add('c ' + tokens[i+1]);
      }
      if (tokens[i] === 'b' && i < tokens.length - 1) {
          bPatterns.add('b ' + tokens[i+1]);
      }
    }
  }
  console.log("\nWhat comes before 'shoe':", Array.from(shoePatterns).slice(0, 20));
  console.log("\nWhat follows 'c ':", Array.from(cPatterns).slice(0, 20));
  console.log("\nWhat follows 'b ':", Array.from(bPatterns).slice(0, 20));
}
run();
