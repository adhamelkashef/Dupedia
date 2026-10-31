/* A local stand-in for the Gemini API, for end-to-end tests with `wrangler dev` only (GEMINI_BASE_URL=http://127.0.0.1:8798).
   It answers like a careful analyst would, using ONLY the sources in the prompt: for opportunities it returns the first
   listed source as one item, plus one item with an invented link (which the Worker must drop). Other jobs get [].
   Run:  node qa/fake-gemini-server.mjs 8798 */
import http from "node:http";
const port = Number(process.argv[2] || 8798);
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const ok = req.headers["x-goog-api-key"] === "local-test-gemini-key";
    if (!ok) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } })); }
    const prompt = JSON.parse(b).contents[0].parts[0].text, m = /\[S1\] (.*)\nURL: (\S+)\nPublished \(as given by the source\): (\S+)/.exec(prompt);
    let out = [];
    if (/commercial opportunities/.test(prompt) && m) out = [
      { title: m[1].slice(0, 120), organization: "As named in the source", location: "New Cairo, Egypt", category: "compound", kind: "project", description: "Taken from source S1 only.", products: ["Outdoor playground"],
        sourceUrl: m[2], sourceOrg: new URL(m[2]).hostname, sourceType: "media", publishedAt: m[3] === "unknown" ? null : m[3], nextAction: "Confirm the project and the amenity package with the developer", contactStrategy: "Through the developer's published sales channel", region: "Egypt", toConfirm: ["Who procures the play areas"] },
      { title: "Invented project", organization: "Nobody", location: "Cairo", category: "compound", kind: "project", description: "x", products: [], sourceUrl: "https://invented.example/none", sourceOrg: "x", sourceType: "media", publishedAt: null, nextAction: "x", contactStrategy: "x", region: "Egypt" } ];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 900 }, modelVersion: "fake-local-gemini" }));
  });
}).listen(port, "127.0.0.1", () => console.log("fake gemini on " + port));
