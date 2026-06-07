# Assistente Pessoal IA

MVP de um assistente pessoal extensivel. Ele roda localmente, guarda memoria, cria tarefas, calcula e consulta conectores publicos. Tambem esta preparado para usar um modelo de IA quando uma chave de API for configurada.

## O que ja funciona

- Chat local no navegador.
- Memoria persistente no navegador ou em `work/assistant-data/memory.json`.
- Notas locais pesquisaveis.
- Importacao manual de arquivos `.txt`, `.md`, `.json` e `.csv`.
- Documentos importados em trechos pesquisaveis com fonte.
- Lista simples de tarefas.
- Calculadora local.
- Conectores publicos: Wikipedia, Wikidata, World Bank, OpenAlex, Crossref, arXiv e PubMed.
- DeepSearch: busca federada em bases abertas da web profunda academica/cientifica.
- Pesquisa Total: busca ampla em conhecimento geral, noticias, ciencia, dados publicos, lugares e arquivos abertos.
- Busca geral opcional com Brave Search via `BRAVE_SEARCH_API_KEY`.
- Modo com modelo OpenAI via `OPENAI_API_KEY`.
- Painel visual com conectores disponiveis.
- Exportacao da memoria em JSON.

## Como abrir rapido no navegador

Link direto:

```text
https://cdn.jsdelivr.net/gh/Luisfvsc/scofield-ai-solutions@main/public/index.html
```

Ou, se o GitHub Pages estiver ativado:

```text
https://luisfvsc.github.io/scofield-ai-solutions/
```

Se voce baixou/clonou o projeto, abra:

```text
outputs/abrir-assistente.html
```

A memoria fica salva no armazenamento local do navegador.

## Como rodar com servidor

```powershell
$env:OPENAI_API_KEY="sua-chave-aqui"
$env:OPENAI_MODEL="gpt-4.1-mini"
$env:BRAVE_SEARCH_API_KEY="sua-chave-brave-opcional"
node server.js
```

Se nao definir `OPENAI_API_KEY`, o assistente roda em modo local com ferramentas e conectores publicos.

## Comandos uteis

- `lembrar que prefiro respostas diretas`
- `nota ideia para domingo`
- `buscar memoria domingo`
- `documentos`
- `resumir documento nome-do-arquivo`
- `exportar memoria`
- `tarefa pagar contas na segunda`
- `minhas tarefas`
- `42 * 18 / 3`
- `pesquisar inteligencia artificial`
- `pesquisar tudo inteligencia artificial no brasil`
- `wikidata Brasil`
- `worldbank BR NY.GDP.MKTP.CD`
- `openalex artificial intelligence`
- `deepsearch cancer immunotherapy`

## Proximo salto tecnico

1. Memoria semantica: trocar a busca por palavras por embeddings e ranking por relevancia.
2. Busca geral real: configurar `BRAVE_SEARCH_API_KEY` para cobrir praticamente qualquer assunto da web aberta.
3. Resumo inteligente: usar o modelo para resumir documentos longos com perguntas e respostas.
4. Ranking avancado: deduplicar resultados, pontuar por relevancia, ano, citacoes e fonte.
5. Permissoes: cada conector deve ter escopo claro, logs e confirmacoes para acoes sensiveis.

## Observacao importante

Nenhum assistente deve ter acesso irrestrito a "todos os bancos de dados do mundo". A versao certa e segura usa conectores autorizados, auditoria, limites de permissao e confirmacoes para acoes sensiveis.

DeepSearch aqui significa web profunda legitima: bases abertas, cientificas, academicas e governamentais que buscadores comuns nem sempre exploram bem. O projeto nao faz invasao, bypass de login, raspagem proibida, acesso a paywall, nem busca em conteudo ilegal.
