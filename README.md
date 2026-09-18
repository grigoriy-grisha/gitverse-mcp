# gitverse-mcp-server

MCP-сервер (Model Context Protocol) для GitVerse с набором тулов в стиле Bitbucket MCP: репозитории, pull request'ы, ревью, комментарии и CI. Локальный stdio-сервер, работает с официальным REST API GitVerse.

**25 тулов**: PR-цикл целиком — создание (в т.ч. draft), чтение диффа и коммитов, инлайн- и обсуждение-комментарии, вердикты (`approve` / `request changes` / `decline` / `unapprove`), назначение исполнителей и лейблов, плюс CI-раны Actions (аналог Bitbucket Pipelines) вплоть до логов джоб.

An MCP (Model Context Protocol) server exposing Bitbucket-style tools for GitVerse: repositories, pull requests, reviews, comments and CI (GitVerse Actions as the Pipelines analog).

## Возможности / Highlights

- **Знакомый набор тулов** — имена и семантика повторяют Bitbucket MCP: `getPullRequests`, `approvePullRequest`, `addPullRequestComment` и т.д.
- **Инлайн-комментарии к диффу** — `addPullRequestComment` с `inline: {path, to}`; SHA коммита подставляется автоматически.
- **Вердикты** — `approvePullRequest`, `requestChanges`, `declinePullRequest` и `unapprovePullRequest` (сам находит и удаляет ваше APPROVED-ревью).
- **CI** — `listPipelineRuns`, `runPipeline`, `getPipelineStepLogs`: GitVerse Actions как аналог Pipelines.
- **Аутентификация GitVerse** — заголовки `Authorization: Bearer` и вендорный `Accept: application/vnd.gitverse.object+json; version=1` выставляются автоматически.
- **Rate limit** — ответы 429 автоматически повторяются с учётом `Retry-After`.
- **Валидация аргументов** — Zod-схемы для всех параметров.

## Установка / Install

Без установки — через npx:

```bash
GITVERSE_TOKEN=<ваш_токен> npx -y gitverse-mcp-server
```

Или глобально:

```bash
npm install -g gitverse-mcp-server
```

Требуется Node.js >= 20.

## Получение токена

Создайте персональный токен в GitVerse: **Настройки → Управление токенами** ([документация](https://gitverse.ru/docs/collaborative/authentification/tokens)). Выдайте права read/write на нужные сущности — API не работает без токена.

## Настройка MCP-клиентов

### ZCode

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server"],
      "env": {
        "GITVERSE_TOKEN": "<ваш_токен>"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server"],
      "env": {
        "GITVERSE_TOKEN": "<ваш_токен>"
      }
    }
  }
}
```

### Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `GITVERSE_TOKEN` | — | Персональный токен GitVerse (обязателен) |
| `GITVERSE_BASE_URL` | `https://api.gitverse.ru` | База API (можно указать мок-сервер) |
| `GITVERSE_API_VERSION` | `1` | Версия вендорного media type |

## Инструменты / Available tools

### Репозитории

| Тул | Описание |
|---|---|
| `listRepositories` | Список репозиториев (свои или организации, `org`), page/per_page |
| `getRepository` | Карточка репозитория |

### Pull request'ы

| Тул | Описание |
|---|---|
| `getPullRequests` | Список PR, фильтр `state` (open/closed) |
| `createPullRequest` | Создание PR (title, head→base, body, draft, assignees, labels) |
| `createDraftPullRequest` | Создание черновика |
| `getPullRequest` | Карточка PR |
| `updatePullRequest` | Правка title/body/state/base + assignees/labels |
| `getPullRequestActivity` | Активность (timeline) PR |
| `getPullRequestCommits` | Коммиты PR |
| `getPullRequestDiff` | Изменённые файлы с патчами |

### Вердикты

| Тул | Описание |
|---|---|
| `approvePullRequest` | Одобрить (APPROVED-ревью) |
| `unapprovePullRequest` | Снять своё одобрение |
| `requestChanges` | Запросить изменения (REQUEST_CHANGES-ревью) |
| `removeChangeRequest` | Снять свой change request (новым APPROVED-ревью) |
| `declinePullRequest` | Заклонить PR (опционально с комментарием-причиной) |

### Комментарии

| Тул | Описание |
|---|---|
| `getPullRequestComments` | Обсуждение PR |
| `addPullRequestComment` | Общий комментарий или инлайн: `inline: {path, to}` |
| `updatePullRequestComment` | Правка комментария |
| `deletePullRequestComment` | Удаление комментария |

### CI (GitVerse Actions)

| Тул | Описание |
|---|---|
| `listPipelineRuns` | Список CI-ранов (фильтры status/branch/event) |
| `getPipelineRun` | Карточка рана |
| `runPipeline` | Запуск workflow на ветке/теге |
| `getPipelineSteps` | Джобы рана |
| `getPipelineStep` | Карточка джобы |
| `getPipelineStepLogs` | Логи джобы |

### Примеры

```text
addPullRequestComment(owner, repo, pull_number, "Отличная работа!")

addPullRequestComment(owner, repo, pull_number, "Добавь обработку ошибок", {
  inline: { path: "src/service.ts", to: 25 },
})
```

## Ограничения API GitVerse

Некоторые возможности Bitbucket в публичном API GitVerse отсутствуют, поэтому соответствующих тулов нет: merge PR, reviewers при создании (только assignees), переключение draft после создания, задачи (tasks), resolve/reopen тредов, остановка CI-рана, commit statuses (используйте `listPipelineRuns` по ветке).

## Разработка / Development

```bash
git clone <repo>
cd gitverse-mcp-server
npm install
npm test       # vitest: клиент, композитные тула, e2e по InMemoryTransport
npm run build  # tsc -> dist/
```

## Архитектура

```
src/composite.ts   25 тулов: имена/семантика Bitbucket MCP, вызовы API GitVerse
src/client.ts      HTTP-клиент: Bearer + vendor Accept, 429/retry, ошибки
src/server.ts      MCP-сервер: регистрация тулов, аннотации readOnlyHint
src/index.ts       stdio-транспорт, env-конфигурация
```

## Похожие проекты

- [mcp.gitverse.ru](https://gitverse.ru/docs/ai/mcp) — официальный удалённый MCP-сервер GitVerse (42 инструмента, только hosted).
- [`gitverse-mcp`](https://www.npmjs.com/package/gitverse-mcp) — обёртка над `@onreza/gitverse-sdk`, 66 низкоуровневых тулов.

Отличие этого пакета: семантические композитные тула уровня «провести ревью», а не отдельные REST-ручки.

## License

MIT
