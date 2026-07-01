// Fetch emojisV2.txt from the ecoji repo at build time
const res = await fetch("https://raw.githubusercontent.com/keith-turner/ecoji/main/emojisV2.txt");
const text = await res.text();
await Bun.write("emojisV2.txt", text);
console.log("✓ Fetched emojisV2.txt");
