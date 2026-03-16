// network.js — LinkedIn Network Search (embedding + LLM deep search)

(() => {
  const STORAGE_KEY = "linkedin_connections";
  const MAX_LLM_CANDIDATES = 80; // send top N to LLM for deep analysis

  let connections = []; // { name, position, company, url, text }

  // ── DOM refs ──
  const csvInput = document.getElementById("csvFileInput");
  const countBadge = document.getElementById("connectionCount");
  const uploadStatus = document.getElementById("uploadStatus");
  const searchInput = document.getElementById("networkSearchInput");
  const searchBtn = document.getElementById("networkSearchBtn");
  const resultsContainer = document.getElementById("resultsContainer");
  const embeddingResults = document.getElementById("embeddingResults");
  const llmResults = document.getElementById("llmResults");
  const llmSearching = document.getElementById("llmSearching");

  // ── Init: load stored connections, or auto-load bundled default ──
  chrome.storage.local.get(STORAGE_KEY, async (data) => {
    if (data[STORAGE_KEY] && data[STORAGE_KEY].length > 0) {
      connections = data[STORAGE_KEY];
      onConnectionsLoaded();
    } else {
      // Auto-load bundled default_connections.json
      try {
        uploadStatus.textContent = "Loading defaults...";
        const url = chrome.runtime.getURL("default_connections.json");
        const resp = await fetch(url);
        if (resp.ok) {
          const defaultData = await resp.json();
          if (defaultData.length > 0) {
            connections = defaultData;
            chrome.storage.local.set({ [STORAGE_KEY]: connections });
            onConnectionsLoaded();
            uploadStatus.textContent = "✅ Default loaded";
          }
        }
      } catch (e) {
        console.warn("No default connections file found:", e);
      }
    }
  });

  // ── CSV Upload ──
  csvInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadStatus.textContent = "Parsing...";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      if (parsed.length === 0) {
        uploadStatus.textContent = "❌ No valid rows found";
        return;
      }
      connections = parsed;
      // Store in chrome.storage.local
      chrome.storage.local.set({ [STORAGE_KEY]: connections }, () => {
        onConnectionsLoaded();
        uploadStatus.textContent = "✅ Uploaded";
      });
    };
    reader.readAsText(file);
  });

  function onConnectionsLoaded() {
    countBadge.textContent = `${connections.length.toLocaleString()} connections`;
    searchBtn.disabled = false;
  }

  // ── CSV Parser ──
  function parseCSV(raw) {
    const lines = raw.split("\n");
    if (lines.length < 2) return [];

    // Parse header
    const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
    const nameIdx = header.findIndex((h) => h.includes("name"));
    const posIdx = header.findIndex((h) => h.includes("position"));
    const compIdx = header.findIndex((h) => h.includes("company"));
    const urlIdx = header.findIndex((h) => h.includes("url"));

    if (nameIdx === -1) return [];

    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLine(line);
      const name = (cols[nameIdx] || "").trim();
      if (!name) continue;
      const position = (cols[posIdx] || "").trim();
      const company = (cols[compIdx] || "").trim();
      const url = (cols[urlIdx] || "").trim();
      // Pre-compute searchable text (lowercase)
      const text = `${name} ${position} ${company}`.toLowerCase();
      results.push({ name, position, company, url, text });
    }
    return results;
  }

  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  // ── Search triggers ──
  searchBtn.addEventListener("click", () => runSearch());
  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") runSearch();
  });

  async function runSearch() {
    const query = searchInput.value.trim();
    if (!query || connections.length === 0) return;

    searchBtn.disabled = true;
    resultsContainer.classList.add("visible");
    embeddingResults.innerHTML = "";
    llmResults.innerHTML = "";
    llmSearching.style.display = "flex";

    // ── Step 1: Fast keyword + TF-IDF similarity search ──
    const quickResults = keywordSearch(query, connections, 5);
    renderResults(embeddingResults, quickResults, false);

    // ── Step 2: Deep LLM search (async) ──
    const candidates = keywordSearch(query, connections, MAX_LLM_CANDIDATES);
    try {
      const deepResults = await llmDeepSearch(query, candidates);
      llmSearching.style.display = "none";
      renderResults(llmResults, deepResults, true);
    } catch (err) {
      llmSearching.style.display = "none";
      llmResults.innerHTML = `<div class="result-card" style="opacity:0.7">❌ LLM search failed: ${err.message}</div>`;
    }

    searchBtn.disabled = false;
  }

  // ══════════════════════════════════════════════════
  // KEYWORD + TF-IDF SIMILARITY SEARCH
  // ══════════════════════════════════════════════════
  function keywordSearch(query, data, topK) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Build IDF from corpus
    const N = data.length;
    const df = {}; // document frequency per token
    for (const conn of data) {
      const seen = new Set(tokenize(conn.text));
      for (const t of seen) {
        df[t] = (df[t] || 0) + 1;
      }
    }

    // Score each connection
    const scored = data.map((conn) => {
      const docTokens = tokenize(conn.text);
      let score = 0;

      // TF-IDF cosine-ish score
      for (const qt of queryTokens) {
        // Exact match
        const tf = docTokens.filter((t) => t === qt).length;
        if (tf > 0) {
          const idf = Math.log(N / (1 + (df[qt] || 0)));
          score += tf * idf * 3; // boost exact
        }

        // Prefix match (partial)
        const prefixCount = docTokens.filter(
          (t) => t !== qt && (t.startsWith(qt) || qt.startsWith(t))
        ).length;
        if (prefixCount > 0) {
          score += prefixCount * 1.5;
        }

        // Substring match
        if (conn.text.includes(qt)) {
          score += 1;
        }
      }

      // Bonus: consecutive query words found in text (phrase match)
      const queryLower = query.toLowerCase();
      if (conn.text.includes(queryLower)) {
        score += 10;
      }

      return { ...conn, score };
    });

    // Sort descending by score, filter zero-scores
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, topK);
  }

  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  // ══════════════════════════════════════════════════
  // LLM DEEP SEARCH (via OpenRouter)
  // ══════════════════════════════════════════════════
  async function llmDeepSearch(query, candidates) {
    const apiKey = localStorage.getItem("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("Set your OpenRouter API key below first");

    // Format candidates compactly
    const candidateList = candidates
      .map((c, i) => `${i + 1}. ${c.name} | ${c.position || "N/A"} | ${c.company || "N/A"} | ${c.url}`)
      .join("\n");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are a LinkedIn network analyst. Given a search query and a list of LinkedIn connections, identify the TOP 5 most relevant people. Consider:
- Role/title relevance to the query
- Company prestige and relevance
- Seniority and influence level
- Indirect connections (e.g. "AI founders" matches CTOs at AI startups)
- Creative matches the keyword search might miss

Return ONLY a JSON array of exactly 5 objects:
[{"index": <1-based index from list>, "name": "...", "reason": "one-sentence why they match"}]

Be creative — look for non-obvious matches that pure keyword search would miss.`,
          },
          {
            role: "user",
            content: `Search query: "${query}"\n\nConnections (${candidates.length} pre-filtered):\n${candidateList}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "API request failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    let parsed;
    try {
      parsed = JSON.parse(content);
      // Handle both { results: [...] } and direct array
      if (!Array.isArray(parsed)) {
        parsed = parsed.results || parsed.matches || parsed.top || Object.values(parsed)[0];
      }
    } catch {
      throw new Error("Failed to parse LLM response");
    }

    if (!Array.isArray(parsed)) return [];

    // Map back to full connection data
    return parsed
      .filter((r) => r.index && r.index <= candidates.length)
      .map((r) => ({
        ...candidates[r.index - 1],
        reason: r.reason || "",
      }))
      .slice(0, 5);
  }

  // ── Render results ──
  function renderResults(container, results, showReason) {
    if (results.length === 0) {
      container.innerHTML = '<div class="result-card" style="opacity:0.6">No matches found</div>';
      return;
    }
    container.innerHTML = results
      .map(
        (r) => `
        <div class="result-card">
          <a href="${r.url}" target="_blank">${escHtml(r.name)}</a>
          <div class="role">${escHtml(r.position || "")}${r.company ? " · " + escHtml(r.company) : ""}</div>
          ${showReason && r.reason ? `<div class="reason">${escHtml(r.reason)}</div>` : ""}
        </div>`
      )
      .join("");
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
