const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#form");
const input = document.querySelector("#input");
const memoryEl = document.querySelector("#memory");
const connectorsEl = document.querySelector("#connectors");
const modeEl = document.querySelector("#mode");
const fileInput = document.querySelector("#file-input");
const importStatus = document.querySelector("#import-status");
const history = [];
const standalone = location.protocol === "file:";
const memoryKey = "assistente-pessoal-ia-memory";

const connectors = [
  ["Wikipedia", "pesquisar inteligencia artificial", "Resumo enciclopedico rapido."],
  ["Wikidata", "wikidata Brasil", "Conhecimento estruturado global."],
  ["World Bank", "worldbank BR NY.GDP.MKTP.CD", "Indicadores economicos e sociais."],
  ["OpenAlex", "openalex inteligencia artificial", "Pesquisa academica aberta."],
  ["DeepSearch", "deepsearch cancer immunotherapy", "Busca federada em OpenAlex, Crossref, arXiv e PubMed."],
  ["Pesquisa Total", "pesquisar tudo inteligencia artificial no brasil", "Busca ampla em conhecimento, noticias, ciencia, dados, lugares e arquivos."],
  ["Modelo OpenAI", "OPENAI_API_KEY", "Raciocinio avancado quando o servidor estiver configurado."]
];

function defaultMemory() {
  return {
    profile: {
      name: "",
      preferences: [],
      goals: ["Construir um assistente pessoal de IA funcional"]
    },
    notes: [],
    documents: [],
    tasks: [],
    facts: []
  };
}

function readLocalMemory() {
  const saved = localStorage.getItem(memoryKey);
  return saved ? JSON.parse(saved) : defaultMemory();
}

function writeLocalMemory(memory) {
  localStorage.setItem(memoryKey, JSON.stringify(memory));
}

function chunkText(text, chunkSize = 900) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let index = 0; index < normalized.length; index += chunkSize) {
    chunks.push(normalized.slice(index, index + chunkSize));
  }
  return chunks.slice(0, 80);
}

function summarizeText(text, sentenceLimit = 5) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.slice(0, sentenceLimit).join(" ") || text.slice(0, 900);
}

function searchableMemoryItems(memory) {
  return [
    ...(memory.facts || []).map((item) => ({ type: "memoria", text: item.text, createdAt: item.createdAt })),
    ...(memory.notes || []).map((item) => ({ type: "nota", text: item.text, createdAt: item.createdAt })),
    ...(memory.documents || []).flatMap((item) => {
      const chunks = item.chunks?.length ? item.chunks : chunkText(item.text || "");
      return chunks.map((chunk, index) => ({
        type: `documento: ${item.name}`,
        text: chunk,
        source: item.name,
        chunk: index + 1,
        createdAt: item.createdAt
      }));
    }),
    ...(memory.tasks || []).map((item) => ({ type: item.done ? "tarefa concluida" : "tarefa aberta", text: item.text, createdAt: item.createdAt })),
    ...(memory.profile?.goals || []).map((text) => ({ type: "objetivo", text, createdAt: "" })),
    ...(memory.profile?.preferences || []).map((text) => ({ type: "preferencia", text, createdAt: "" }))
  ].filter((item) => item.text);
}

function searchMemory(memory, query) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];

  return searchableMemoryItems(memory)
    .map((item) => {
      const haystack = `${item.type} ${item.text}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function formatMemoryResults(results) {
  if (!results.length) return "Nao encontrei nada na memoria com esses termos.";
  return results
    .map((item, index) => {
      const source = item.source ? ` | fonte: ${item.source}${item.chunk ? ` #${item.chunk}` : ""}` : "";
      return `${index + 1}. [${item.type}${source}] ${item.text.slice(0, 420)}`;
    })
    .join("\n\n");
}

function findDocument(memory, query) {
  const needle = query.toLowerCase();
  return (memory.documents || []).find((doc) => doc.name.toLowerCase().includes(needle));
}

function downloadMemory(memory) {
  const blob = new Blob([JSON.stringify(memory, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `assistente-memoria-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportMemory() {
  if (standalone) {
    downloadMemory(readLocalMemory());
    addMessage("assistant", "Memoria exportada em JSON.", "Usou: Exportacao de memoria");
    return;
  }

  const response = await fetch("api/memory");
  const memory = await response.json();
  downloadMemory(memory);
  addMessage("assistant", "Memoria exportada em JSON.", "Usou: Exportacao de memoria");
}

function clearChat() {
  history.length = 0;
  messagesEl.innerHTML = "";
  addMessage("assistant", "Conversa limpa. A memoria continua salva.");
}

async function importDocument(file) {
  const maxSize = 1_000_000;
  if (!file) return;
  if (file.size > maxSize) {
    importStatus.textContent = "Arquivo grande demais para este MVP. Limite: 1 MB.";
    return;
  }

  const text = await file.text();
  if (!text.trim()) {
    importStatus.textContent = "Esse arquivo nao tem texto legivel.";
    return;
  }

  if (standalone) {
    const memory = readLocalMemory();
    memory.documents ||= [];
    memory.documents.push({
      name: file.name,
      text: text.slice(0, 120000),
      chunks: chunkText(text),
      size: text.length,
      createdAt: new Date().toISOString()
    });
    writeLocalMemory(memory);
  } else {
    const response = await fetch("api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao importar documento.");
  }

  importStatus.textContent = `${file.name} importado para a memoria.`;
  addMessage("assistant", `Documento importado: ${file.name}\nAgora voce pode usar: buscar memoria termo`, "Usou: Importacao de documento");
  await refreshMemory();
}

function addMessage(role, content, meta = "") {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  item.textContent = content;
  if (meta) {
    const small = document.createElement("div");
    small.className = "meta";
    small.textContent = meta;
    item.appendChild(small);
  }
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function refreshMemory() {
  if (standalone) {
    memoryEl.textContent = JSON.stringify(readLocalMemory(), null, 2);
    return;
  }
  const response = await fetch("api/memory");
  const data = await response.json();
  memoryEl.textContent = JSON.stringify(data, null, 2);
}

async function refreshConnectors() {
  modeEl.textContent = standalone ? "Modo navegador ativo" : "Modo servidor ativo";
  if (standalone) {
    renderConnectors(
      connectors.map(([name, command, description]) => ({
        name,
        command,
        description,
        enabled: name !== "Modelo OpenAI"
      }))
    );
    return;
  }

  try {
    const response = await fetch("api/connectors");
    renderConnectors(await response.json());
  } catch {
    renderConnectors([]);
  }
}

function renderConnectors(items) {
  connectorsEl.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = `${item.name} ${item.enabled ? "" : "(inativo)"}`;
    detail.textContent = item.command;
    li.title = item.description || "";
    li.append(title, detail);
    connectorsEl.appendChild(li);
  });
}

function calculatorExpression(message) {
  const expression = message
    .replace(/,/g, ".")
    .match(/[-+*/().\d\s]{3,}/g)
    ?.sort((a, b) => b.length - a.length)[0];
  return expression && /[+\-*/]/.test(expression) ? expression.trim() : null;
}

function calculate(expression) {
  if (!/^[-+*/().\d\s]+$/.test(expression)) return null;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function standaloneWikipedia(query) {
  const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
  return `${data.title}\n\n${data.extract}\n\nFonte: ${data.content_urls?.desktop?.page || ""}`;
}

async function standaloneWikipediaItems(query) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({ action: "query", list: "search", srsearch: query, format: "json", origin: "*", srlimit: "5" });
  const data = await fetchJson(url);
  return (data.query?.search || []).map((item) => ({
    source: "Wikipedia",
    title: item.title,
    year: "",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(" ", "_"))}`,
    detail: item.snippet?.replace(/<[^>]+>/g, "") || ""
  }));
}

async function standaloneWikidata(query) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "pt",
    format: "json",
    limit: "1",
    origin: "*"
  });
  const data = await fetchJson(searchUrl);
  const entity = data.search?.[0];
  if (!entity) return "Nenhuma entidade encontrada.";
  return `${entity.label} (${entity.id})\n\n${entity.description || ""}\nFonte: https://www.wikidata.org/wiki/${entity.id}`;
}

async function standaloneWikidataItem(query) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "pt",
    format: "json",
    limit: "1",
    origin: "*"
  });
  const data = await fetchJson(searchUrl);
  const entity = data.search?.[0];
  if (!entity) return [];
  return [
    {
      source: "Wikidata",
      title: `${entity.label} (${entity.id})`,
      year: "",
      url: `https://www.wikidata.org/wiki/${entity.id}`,
      detail: entity.description || ""
    }
  ];
}

async function standaloneWorldBank(country, indicator) {
  const data = await fetchJson(
    `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=6`
  );
  const rows = Array.isArray(data?.[1]) ? data[1].filter((item) => item.value !== null).slice(0, 5) : [];
  if (!rows.length) return "Nenhum dado recente encontrado.";
  return `${rows[0].indicator?.value || indicator}\n${rows[0].country?.value || country}\n\n${rows
    .map((item) => `${item.date}: ${Number(item.value).toLocaleString("pt-BR")}`)
    .join("\n")}`;
}

async function standaloneWorldBankCatalog(query) {
  const data = await fetchJson("https://api.worldbank.org/v2/indicator?format=json&per_page=200");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(data?.[1]) ? data[1] : [])
    .filter((item) => {
      const text = `${item.name} ${item.sourceNote || ""}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    })
    .slice(0, 6)
    .map((item) => ({
      source: "World Bank Data",
      title: item.name,
      year: "",
      url: `https://data.worldbank.org/indicator/${item.id}`,
      detail: item.id
    }));
}

async function standaloneOpenAlex(query) {
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({ search: query, per_page: "5", sort: "cited_by_count:desc" });
  const data = await fetchJson(url);
  const results = data.results || [];
  if (!results.length) return "Nenhum trabalho encontrado.";
  return results
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}\nAno: ${item.publication_year || "n/d"} | Citacoes: ${item.cited_by_count || 0}\n${
          item.primary_location?.landing_page_url || item.id
        }`
    )
    .join("\n\n");
}

async function standaloneOpenAlexItems(query) {
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({ search: query, per_page: "5", sort: "cited_by_count:desc" });
  const data = await fetchJson(url);
  return (data.results || []).map((item) => ({
    source: "OpenAlex",
    title: item.title,
    year: item.publication_year,
    url: item.primary_location?.landing_page_url || item.id,
    detail: `Citacoes: ${item.cited_by_count || 0}`
  }));
}

async function standaloneCrossref(query) {
  const url = new URL("https://api.crossref.org/works");
  url.search = new URLSearchParams({ query, rows: "5", sort: "is-referenced-by-count", order: "desc" });
  const data = await fetchJson(url);
  return (data.message?.items || []).map((item) => ({
    source: "Crossref",
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    year: item.published?.["date-parts"]?.[0]?.[0] || item.created?.["date-parts"]?.[0]?.[0],
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
    detail: item.DOI ? `DOI: ${item.DOI}` : ""
  }));
}

async function standaloneArxiv(query) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.search = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: "5",
    sortBy: "relevance",
    sortOrder: "descending"
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
    const published = entry.match(/<published>(.*?)<\/published>/)?.[1]?.slice(0, 4);
    const id = entry.match(/<id>(.*?)<\/id>/)?.[1]?.trim();
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim();
    return { source: "arXiv", title, year: published, url: id, detail: summary?.slice(0, 160) || "" };
  });
}

async function standalonePubMed(query) {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.search = new URLSearchParams({ db: "pubmed", term: query, retmode: "json", retmax: "5", sort: "relevance" });
  const searchData = await fetchJson(searchUrl);
  const ids = searchData.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.search = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
  const summary = await fetchJson(summaryUrl);
  return ids.map((id) => {
    const item = summary.result?.[id] || {};
    return {
      source: "PubMed",
      title: item.title,
      year: item.pubdate?.match(/\d{4}/)?.[0],
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      detail: item.fulljournalname || ""
    };
  });
}

async function standaloneGdelt(query) {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.search = new URLSearchParams({ query, mode: "ArtList", format: "json", maxrecords: "8", sort: "HybridRel" });
  const data = await fetchJson(url);
  return (data.articles || []).map((item) => ({
    source: "GDELT News",
    title: item.title,
    year: item.seendate?.slice(0, 4),
    url: item.url,
    detail: [item.domain, item.sourcecountry, item.seendate].filter(Boolean).join(" | ")
  }));
}

async function standaloneInternetArchive(query) {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.search = new URLSearchParams({
    q: query,
    fl: "identifier,title,creator,year,mediatype",
    rows: "6",
    page: "1",
    output: "json"
  });
  const data = await fetchJson(url);
  return (data.response?.docs || []).map((item) => ({
    source: "Internet Archive",
    title: item.title || item.identifier,
    year: item.year,
    url: `https://archive.org/details/${item.identifier}`,
    detail: [item.creator, item.mediatype].filter(Boolean).join(" | ")
  }));
}

async function standaloneOpenStreetMap(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: query, format: "json", limit: "5" });
  const data = await fetchJson(url);
  return data.map((item) => ({
    source: "OpenStreetMap",
    title: item.display_name,
    year: "",
    url: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`,
    detail: [item.type, item.class].filter(Boolean).join(" | ")
  }));
}

async function standaloneDeepSearch(query) {
  const searches = await Promise.allSettled([
    standaloneOpenAlexItems(query),
    standaloneCrossref(query),
    standaloneArxiv(query),
    standalonePubMed(query)
  ]);
  const results = searches.flatMap((result) => (result.status === "fulfilled" ? result.value : [])).filter((item) => item.title).slice(0, 16);
  if (!results.length) return "Nao encontrei resultados nas bases profundas abertas.";
  return results
    .map(
      (item, index) =>
        `${index + 1}. [${item.source}] ${item.title}\nAno: ${item.year || "n/d"}${item.detail ? ` | ${item.detail}` : ""}\n${item.url || ""}`
    )
    .join("\n\n");
}

function formatTotalSearch(results, query) {
  if (!results.length) return "Nao encontrei resultados nas fontes abertas configuradas.";
  const grouped = new Map();
  for (const item of results) {
    if (!grouped.has(item.source)) grouped.set(item.source, []);
    grouped.get(item.source).push(item);
  }
  const sections = [...grouped.entries()].map(([source, items]) => {
    const lines = items
      .slice(0, 6)
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n${item.year ? `Ano: ${item.year} | ` : ""}${item.detail || ""}\n${item.url || ""}`
      )
      .join("\n\n");
    return `${source}\n${lines}`;
  });
  return `Pesquisa Total: ${query}\n\n${sections.join("\n\n---\n\n")}`;
}

async function standaloneTotalSearch(query) {
  const searches = await Promise.allSettled([
    standaloneWikipediaItems(query),
    standaloneWikidataItem(query),
    standaloneGdelt(query),
    standaloneInternetArchive(query),
    standaloneOpenStreetMap(query),
    standaloneWorldBankCatalog(query),
    Promise.allSettled([standaloneOpenAlexItems(query), standaloneCrossref(query), standaloneArxiv(query), standalonePubMed(query)]).then((items) =>
      items.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    )
  ]);
  const seen = new Set();
  const results = searches
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.title)
    .filter((item) => {
      const key = `${item.source}:${item.url || item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 36);
  return formatTotalSearch(results, query);
}

async function standaloneAssistant(message) {
  const memory = readLocalMemory();
  const lower = message.toLowerCase();
  const expression = calculatorExpression(message);
  const result = expression ? calculate(expression) : null;

  if (result !== null) return { reply: `Resultado: ${result}`, used: ["Calculadora local"] };

  if (lower.startsWith("lembrar ") || lower.startsWith("lembre ")) {
    const text = message.replace(/^lembra(r|e)\s+/i, "").trim();
    memory.facts.push({ text, createdAt: new Date().toISOString() });
    writeLocalMemory(memory);
    return { reply: "Memorizei isso no navegador.", used: ["Memoria local"] };
  }

  if (lower.startsWith("nota ")) {
    const text = message.replace(/^nota\s+/i, "").trim();
    memory.notes.push({ text, createdAt: new Date().toISOString() });
    writeLocalMemory(memory);
    return { reply: "Nota salva na memoria.", used: ["Notas locais"] };
  }

  if (lower.startsWith("buscar memoria ") || lower.startsWith("procurar memoria ")) {
    const query = message.replace(/^(buscar|procurar)\s+memoria\s+/i, "").trim();
    return { reply: formatMemoryResults(searchMemory(memory, query)), used: ["Busca na memoria"] };
  }

  if (lower === "documentos") {
    const docs = memory.documents || [];
    return {
      reply: docs.length
        ? docs.map((doc, index) => `${index + 1}. ${doc.name} (${doc.size || doc.text.length} caracteres)`).join("\n")
        : "Nenhum documento importado ainda.",
      used: ["Documentos locais"]
    };
  }

  if (lower.startsWith("resumir documento ")) {
    const query = message.replace(/^resumir\s+documento\s+/i, "").trim();
    const doc = findDocument(memory, query);
    if (!doc) return { reply: "Nao encontrei documento com esse nome.", used: ["Resumo de documento"] };
    return {
      reply: `${doc.name}\n\n${summarizeText(doc.text || (doc.chunks || []).join(" "))}`,
      used: ["Resumo de documento"]
    };
  }

  if (lower === "exportar memoria") {
    downloadMemory(memory);
    return { reply: "Memoria exportada em JSON.", used: ["Exportacao de memoria"] };
  }

  if (lower.startsWith("tarefa ") || lower.startsWith("adicionar tarefa ")) {
    const text = message.replace(/^(adicionar\s+)?tarefa\s+/i, "").trim();
    memory.tasks.push({ text, done: false, createdAt: new Date().toISOString() });
    writeLocalMemory(memory);
    return { reply: "Tarefa adicionada.", used: ["Lista de tarefas"] };
  }

  if (lower.includes("minhas tarefas")) {
    const tasks = memory.tasks.filter((task) => !task.done);
    return {
      reply: tasks.length
        ? `Tarefas abertas:\n${tasks.map((task, index) => `${index + 1}. ${task.text}`).join("\n")}`
        : "Voce nao tem tarefas abertas agora.",
      used: ["Lista de tarefas"]
    };
  }

  try {
    if (lower.startsWith("pesquisar ") || lower.startsWith("wikipedia ")) {
      const query = message.replace(/^(pesquisar|wikipedia)\s+/i, "").trim();
      return { reply: await standaloneWikipedia(query), used: ["Wikipedia"] };
    }

    if (lower.startsWith("wikidata ")) {
      const query = message.replace(/^wikidata\s+/i, "").trim();
      return { reply: await standaloneWikidata(query), used: ["Wikidata"] };
    }

    if (lower.startsWith("worldbank ")) {
      const [, country = "BR", indicator = "NY.GDP.MKTP.CD"] = message.split(/\s+/);
      return { reply: await standaloneWorldBank(country, indicator), used: ["World Bank"] };
    }

    if (lower.startsWith("openalex ")) {
      const query = message.replace(/^openalex\s+/i, "").trim();
      return { reply: await standaloneOpenAlex(query), used: ["OpenAlex"] };
    }

    if (lower.startsWith("deepsearch ") || lower.startsWith("busca profunda ")) {
      const query = message.replace(/^(deepsearch|busca\s+profunda)\s+/i, "").trim();
      return { reply: await standaloneDeepSearch(query), used: ["DeepSearch", "OpenAlex", "Crossref", "arXiv", "PubMed"] };
    }

    if (lower.startsWith("pesquisar tudo ") || lower.startsWith("buscar tudo ") || lower.startsWith("omnipesquisa ")) {
      const query = message.replace(/^(pesquisar|buscar)\s+tudo\s+|^omnipesquisa\s+/i, "").trim();
      return {
        reply: await standaloneTotalSearch(query),
        used: ["Pesquisa Total", "Wikipedia", "Wikidata", "GDELT", "Internet Archive", "OpenStreetMap", "World Bank", "DeepSearch"]
      };
    }
  } catch (error) {
    return {
      reply: `O conector nao respondeu agora. ${error.message}`,
      used: ["Conector publico"]
    };
  }

  return {
    reply:
      "Estou funcionando direto no navegador. Posso guardar memorias, criar tarefas, calcular e consultar conectores publicos.\n\n" +
      "Experimente: `pesquisar tudo inteligencia artificial no brasil`, `nota ideia para domingo`, `documentos`, `resumir documento nome`, `buscar memoria domingo`, `deepsearch cancer immunotherapy`, `wikidata Brasil`, `worldbank BR NY.GDP.MKTP.CD`, `openalex artificial intelligence`.",
    used: ["Modo navegador"]
  };
}

async function sendMessage(message) {
  addMessage("user", message);
  input.value = "";
  input.disabled = true;
  addMessage("assistant", "Pensando...");
  const pending = messagesEl.lastElementChild;

  try {
    let data;
    if (standalone) {
      data = await standaloneAssistant(message);
    } else {
      const response = await fetch("api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history })
      });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao responder.");
    }
    pending.textContent = data.reply;
    if (data.used?.length) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `Usou: ${data.used.join(", ")}`;
      pending.appendChild(meta);
    }
    history.push({ role: "user", content: message }, { role: "assistant", content: data.reply });
    await refreshMemory();
  } catch (error) {
    pending.textContent = `Erro: ${error.message}`;
  } finally {
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (message) sendMessage(message);
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.action === "export") exportMemory();
    if (button.dataset.action === "clear-chat") clearChat();
  });
});

fileInput.addEventListener("change", async () => {
  try {
    await importDocument(fileInput.files?.[0]);
  } catch (error) {
    importStatus.textContent = `Erro: ${error.message}`;
  } finally {
    fileInput.value = "";
  }
});

addMessage(
  "assistant",
  "Scofield Intelligence Desk online. Pronto para pesquisa total, analise de fontes, memoria local e documentos autorizados."
);
refreshConnectors();
refreshMemory();
