import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = path.join(__dirname, "work", "assistant-data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const CONNECTORS = [
  {
    id: "wikipedia",
    name: "Wikipedia",
    status: "publico",
    command: "pesquisar inteligencia artificial",
    description: "Resumo enciclopedico rapido."
  },
  {
    id: "wikidata",
    name: "Wikidata",
    status: "publico",
    command: "wikidata Brasil",
    description: "Conhecimento estruturado global."
  },
  {
    id: "worldbank",
    name: "World Bank",
    status: "publico",
    command: "worldbank BR NY.GDP.MKTP.CD",
    description: "Indicadores economicos e sociais."
  },
  {
    id: "openalex",
    name: "OpenAlex",
    status: "publico",
    command: "openalex inteligencia artificial",
    description: "Artigos, autores e instituicoes academicas."
  },
  {
    id: "deepsearch",
    name: "DeepSearch",
    status: "publico",
    command: "deepsearch cancer immunotherapy",
    description: "Busca federada em bases abertas: OpenAlex, Crossref, arXiv e PubMed."
  },
  {
    id: "total-search",
    name: "Pesquisa Total",
    status: "publico + opcional",
    command: "pesquisar tudo inteligencia artificial no brasil",
    description: "Busca ampla em conhecimento geral, noticias, ciencia, dados, lugares e arquivos abertos."
  },
  {
    id: "openai",
    name: "Modelo OpenAI",
    status: "requer chave",
    command: "OPENAI_API_KEY",
    description: "Raciocinio avancado e conversa natural."
  }
];

async function ensureData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(
      MEMORY_FILE,
      JSON.stringify(
        {
          profile: {
            name: "",
            preferences: [],
            goals: ["Construir um assistente pessoal de IA funcional"]
          },
          notes: [],
          documents: [],
          tasks: [],
          facts: []
        },
        null,
        2
      )
    );
  }
}

async function readJson(file) {
  await ensureData();
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function extractCalculatorExpression(message) {
  const cleaned = message
    .replace(/,/g, ".")
    .match(/[-+*/().\d\s]{3,}/g)
    ?.sort((a, b) => b.length - a.length)[0];
  if (!cleaned || !/[+\-*/]/.test(cleaned)) return null;
  return cleaned.trim();
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
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchWikipedia(query) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  return {
    title: data.title,
    summary: data.extract,
    url: data.content_urls?.desktop?.page
  };
}

async function searchWikipediaSearch(query) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    format: "json",
    origin: "*",
    srlimit: "5"
  });
  const data = await fetchJson(url);
  return (data.query?.search || []).map((item) => ({
    source: "Wikipedia",
    title: item.title,
    year: "",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(" ", "_"))}`,
    detail: item.snippet?.replace(/<[^>]+>/g, "") || ""
  }));
}

async function searchWikidata(query) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "pt",
    format: "json",
    limit: "1",
    origin: "*"
  });
  const searchData = await fetchJson(searchUrl);
  const entity = searchData.search?.[0];
  if (!entity) throw new Error("Nenhuma entidade encontrada.");

  const entityData = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${entity.id}.json`);
  const record = entityData.entities?.[entity.id];
  const label = record?.labels?.pt?.value || record?.labels?.en?.value || entity.label;
  const description = record?.descriptions?.pt?.value || record?.descriptions?.en?.value || entity.description || "";
  const aliases = (record?.aliases?.pt || record?.aliases?.en || []).slice(0, 5).map((item) => item.value);
  return {
    id: entity.id,
    label,
    description,
    aliases,
    url: `https://www.wikidata.org/wiki/${entity.id}`
  };
}

async function searchWorldBank(country, indicator) {
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=6`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.[1]) ? data[1].filter((item) => item.value !== null).slice(0, 5) : [];
  if (!rows.length) throw new Error("Nenhum dado recente encontrado.");
  return {
    indicator: rows[0].indicator?.value || indicator,
    country: rows[0].country?.value || country,
    values: rows.map((item) => ({ year: item.date, value: item.value }))
  };
}

async function searchGdelt(query) {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.search = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "8",
    sort: "HybridRel"
  });
  const data = await fetchJson(url);
  return (data.articles || []).map((item) => ({
    source: "GDELT News",
    title: item.title,
    year: item.seendate?.slice(0, 4),
    url: item.url,
    detail: [item.domain, item.sourcecountry, item.seendate].filter(Boolean).join(" | ")
  }));
}

async function searchInternetArchive(query) {
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

async function searchOpenStreetMap(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "json",
    limit: "5"
  });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "AssistentePessoalIA/0.1 local research app" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.map((item) => ({
    source: "OpenStreetMap",
    title: item.display_name,
    year: "",
    url: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`,
    detail: [item.type, item.class].filter(Boolean).join(" | ")
  }));
}

async function searchWorldBankCatalog(query) {
  const url = "https://api.worldbank.org/v2/indicator?format=json&per_page=200";
  const data = await fetchJson(url);
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

async function searchBrave(query) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return [];
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.search = new URLSearchParams({ q: query, count: "8" });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.web?.results || []).map((item) => ({
    source: "Brave Search",
    title: item.title,
    year: "",
    url: item.url,
    detail: item.description || ""
  }));
}

async function searchOpenAlex(query) {
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({
    search: query,
    per_page: "5",
    sort: "cited_by_count:desc"
  });
  const data = await fetchJson(url);
  return (data.results || []).map((item) => ({
    title: item.title,
    year: item.publication_year,
    citedBy: item.cited_by_count,
    url: item.primary_location?.landing_page_url || item.id
  }));
}

async function searchCrossref(query) {
  const url = new URL("https://api.crossref.org/works");
  url.search = new URLSearchParams({
    query,
    rows: "5",
    sort: "is-referenced-by-count",
    order: "desc"
  });
  const data = await fetchJson(url);
  return (data.message?.items || []).map((item) => ({
    source: "Crossref",
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    year: item.published?.["date-parts"]?.[0]?.[0] || item.created?.["date-parts"]?.[0]?.[0],
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
    detail: item.DOI ? `DOI: ${item.DOI}` : ""
  }));
}

async function searchArxiv(query) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.search = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: "5",
    sortBy: "relevance",
    sortOrder: "descending"
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

async function searchPubMed(query) {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.search = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmode: "json",
    retmax: "5",
    sort: "relevance"
  });
  const searchData = await fetchJson(searchUrl);
  const ids = searchData.esearchresult?.idlist || [];
  if (!ids.length) return [];

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.search = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json"
  });
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

async function deepSearch(query) {
  const searches = await Promise.allSettled([
    searchOpenAlex(query).then((items) =>
      items.map((item) => ({
        source: "OpenAlex",
        title: item.title,
        year: item.year,
        url: item.url,
        detail: `Citacoes: ${item.citedBy || 0}`
      }))
    ),
    searchCrossref(query),
    searchArxiv(query),
    searchPubMed(query)
  ]);

  return searches
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.title)
    .slice(0, 16);
}

async function totalSearch(query) {
  const searches = await Promise.allSettled([
    searchBrave(query),
    searchWikipediaSearch(query),
    searchWikidata(query).then((item) => [
      {
        source: "Wikidata",
        title: `${item.label} (${item.id})`,
        year: "",
        url: item.url,
        detail: item.description
      }
    ]),
    searchGdelt(query),
    searchInternetArchive(query),
    searchOpenStreetMap(query),
    searchWorldBankCatalog(query),
    deepSearch(query)
  ]);

  const seen = new Set();
  return searches
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.title)
    .filter((item) => {
      const key = `${item.source}:${item.url || item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 36);
}

function formatWorldBank(result) {
  return `${result.indicator}\n${result.country}\n\n${result.values
    .map((item) => `${item.year}: ${Number(item.value).toLocaleString("pt-BR")}`)
    .join("\n")}`;
}

function formatOpenAlex(results) {
  if (!results.length) return "Nenhum trabalho encontrado.";
  return results
    .map((item, index) => `${index + 1}. ${item.title}\nAno: ${item.year || "n/d"} | Citacoes: ${item.citedBy || 0}\n${item.url}`)
    .join("\n\n");
}

function formatDeepSearch(results) {
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

async function askOpenAI(messages, memory) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Voce e um assistente pessoal em portugues. Seja util, direto e seguro. Use a memoria local do usuario quando for relevante."
        },
        {
          role: "system",
          content: `Memoria local atual: ${JSON.stringify(memory).slice(0, 8000)}`
        },
        ...messages.slice(-12)
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro no modelo: ${errorText}`);
  }

  const data = await response.json();
  return data.output_text || data.output?.[0]?.content?.[0]?.text || "";
}

async function localAssistant(message, memory) {
  const lower = message.toLowerCase();
  const expression = extractCalculatorExpression(message);
  const result = expression ? calculate(expression) : null;

  if (result !== null) return { reply: `Resultado: ${result}`, used: ["Calculadora local"] };

  if (lower.startsWith("lembrar ") || lower.startsWith("lembre ")) {
    const text = message.replace(/^lembra(r|e)\s+/i, "").trim();
    memory.facts.push({ text, createdAt: new Date().toISOString() });
    await writeJson(MEMORY_FILE, memory);
    return { reply: "Memorizei isso para usar nas proximas conversas.", used: ["Memoria local"] };
  }

  if (lower.startsWith("nota ")) {
    const text = message.replace(/^nota\s+/i, "").trim();
    memory.notes.push({ text, createdAt: new Date().toISOString() });
    await writeJson(MEMORY_FILE, memory);
    return { reply: "Nota salva na memoria.", used: ["Notas locais"] };
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

  if (lower.startsWith("buscar memoria ") || lower.startsWith("procurar memoria ")) {
    const query = message.replace(/^(buscar|procurar)\s+memoria\s+/i, "").trim();
    return { reply: formatMemoryResults(searchMemory(memory, query)), used: ["Busca na memoria"] };
  }

  if (lower === "exportar memoria") {
    return { reply: JSON.stringify(memory, null, 2), used: ["Exportacao de memoria"] };
  }

  if (lower.startsWith("tarefa ") || lower.startsWith("adicionar tarefa ")) {
    const text = message.replace(/^(adicionar\s+)?tarefa\s+/i, "").trim();
    memory.tasks.push({ text, done: false, createdAt: new Date().toISOString() });
    await writeJson(MEMORY_FILE, memory);
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

  if (lower.startsWith("pesquisar ") || lower.startsWith("wikipedia ")) {
    const query = message.replace(/^(pesquisar|wikipedia)\s+/i, "").trim();
    try {
      const wiki = await searchWikipedia(query);
      return { reply: `${wiki.title}\n\n${wiki.summary}\n\nFonte: ${wiki.url}`, used: ["Wikipedia"] };
    } catch (error) {
      return { reply: `Nao consegui consultar a Wikipedia agora. ${error.message}`, used: ["Wikipedia"] };
    }
  }

  if (lower.startsWith("wikidata ")) {
    const query = message.replace(/^wikidata\s+/i, "").trim();
    try {
      const data = await searchWikidata(query);
      return {
        reply: `${data.label} (${data.id})\n\n${data.description}\n\nAliases: ${data.aliases.join(", ") || "n/d"}\nFonte: ${data.url}`,
        used: ["Wikidata"]
      };
    } catch (error) {
      return { reply: `Nao consegui consultar a Wikidata agora. ${error.message}`, used: ["Wikidata"] };
    }
  }

  if (lower.startsWith("worldbank ")) {
    const [, country = "BR", indicator = "NY.GDP.MKTP.CD"] = message.split(/\s+/);
    try {
      const data = await searchWorldBank(country, indicator);
      return { reply: formatWorldBank(data), used: ["World Bank"] };
    } catch (error) {
      return { reply: `Nao consegui consultar o World Bank agora. ${error.message}`, used: ["World Bank"] };
    }
  }

  if (lower.startsWith("openalex ")) {
    const query = message.replace(/^openalex\s+/i, "").trim();
    try {
      const data = await searchOpenAlex(query);
      return { reply: formatOpenAlex(data), used: ["OpenAlex"] };
    } catch (error) {
      return { reply: `Nao consegui consultar o OpenAlex agora. ${error.message}`, used: ["OpenAlex"] };
    }
  }

  if (lower.startsWith("deepsearch ") || lower.startsWith("busca profunda ")) {
    const query = message.replace(/^(deepsearch|busca\s+profunda)\s+/i, "").trim();
    try {
      const data = await deepSearch(query);
      return { reply: formatDeepSearch(data), used: ["DeepSearch", "OpenAlex", "Crossref", "arXiv", "PubMed"] };
    } catch (error) {
      return { reply: `Nao consegui fazer a busca profunda agora. ${error.message}`, used: ["DeepSearch"] };
    }
  }

  if (lower.startsWith("pesquisar tudo ") || lower.startsWith("buscar tudo ") || lower.startsWith("omnipesquisa ")) {
    const query = message.replace(/^(pesquisar|buscar)\s+tudo\s+|^omnipesquisa\s+/i, "").trim();
    try {
      const data = await totalSearch(query);
      return {
        reply: formatTotalSearch(data, query),
        used: ["Pesquisa Total", "Wikipedia", "Wikidata", "GDELT", "Internet Archive", "OpenStreetMap", "World Bank", "DeepSearch"]
      };
    } catch (error) {
      return { reply: `Nao consegui fazer a Pesquisa Total agora. ${error.message}`, used: ["Pesquisa Total"] };
    }
  }

  const facts = memory.facts.slice(-4).map((item) => `- ${item.text}`).join("\n");
  return {
    reply:
      "Estou em modo local. Posso calcular, guardar memorias, criar tarefas e consultar conectores publicos.\n\n" +
      "Exemplos: `lembrar que prefiro respostas curtas`, `nota ideia para domingo`, `buscar memoria domingo`, `tarefa revisar agenda`, `minhas tarefas`, `pesquisar tudo inteligencia artificial no brasil`, `wikidata Brasil`, `worldbank BR NY.GDP.MKTP.CD`, `openalex artificial intelligence`, `deepsearch cancer immunotherapy`.\n\n" +
      (facts ? `Memorias recentes:\n${facts}` : "Para ativar raciocinio avancado, defina OPENAI_API_KEY e reinicie o servidor."),
    used: ["Modo local"]
  };
}

async function handleChat(req, res) {
  try {
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return sendJson(res, 400, { error: "Mensagem vazia." });

    const memory = await readJson(MEMORY_FILE);
    const modelReply = await askOpenAI([...history, { role: "user", content: message }], memory);
    if (modelReply) return sendJson(res, 200, { reply: modelReply, used: ["Modelo OpenAI", "Memoria local"] });

    const local = await localAssistant(message, memory);
    return sendJson(res, 200, local);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleMemory(req, res) {
  if (req.method === "GET") return sendJson(res, 200, await readJson(MEMORY_FILE));
  if (req.method === "PUT") {
    const body = await readBody(req);
    await writeJson(MEMORY_FILE, body);
    return sendJson(res, 200, body);
  }
  return sendJson(res, 405, { error: "Metodo nao suportado." });
}

async function handleDocuments(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Metodo nao suportado." });
  const body = await readBody(req);
  const name = String(body.name || "documento.txt").slice(0, 160);
  const text = String(body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "Documento vazio." });

  const memory = await readJson(MEMORY_FILE);
  memory.documents ||= [];
  memory.documents.push({
    name,
    text: text.slice(0, 120000),
    chunks: chunkText(text),
    size: text.length,
    createdAt: new Date().toISOString()
  });
  await writeJson(MEMORY_FILE, memory);
  return sendJson(res, 200, { ok: true, count: memory.documents.length, name });
}

async function handleConnectors(req, res) {
  return sendJson(
    res,
    200,
    CONNECTORS.map((connector) => ({
      ...connector,
      enabled: connector.id !== "openai" || Boolean(process.env.OPENAI_API_KEY)
    }))
  );
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

await ensureData();

http
  .createServer(async (req, res) => {
    if (req.url?.startsWith("/api/chat") && req.method === "POST") return handleChat(req, res);
    if (req.url?.startsWith("/api/connectors")) return handleConnectors(req, res);
    if (req.url?.startsWith("/api/documents")) return handleDocuments(req, res);
    if (req.url?.startsWith("/api/memory")) return handleMemory(req, res);
    return serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Assistente rodando em http://localhost:${PORT}`);
  });
