# gitverse-mcp-server

MCP-сервер (Model Context Protocol), покрывающий **весь публичный REST API GitVerse** — все операции генерируются автоматически из официальной OpenAPI-спецификации [`gitverse/rest-api-description`](https://gitverse.ru/gitverse/rest-api-description).

**157 инструментов из 157 операций API** — репозитории, issues, pull requests, комментарии и ревью, releases и вложения, Actions (workflows, runs, jobs, secrets, variables, runners, artifacts), webhooks, packages, pages, organizations и teams, labels, emails, favorites (звёзды), поиск, миграции и Smartclass.

---

An MCP (Model Context Protocol) server covering the **full GitVerse public REST API**. All tools are generated from the official OpenAPI specification, so coverage is 157/157 API operations and stays complete when the spec evolves.

## Возможности / Highlights

- **Полное покрытие** — каждая операция API становится MCP-инструментом, ничего не пропущено.
- **Генерация из спеки** — `npm run fetch-spec && npm run generate` обновляет сервер под новую версию API.
- **Валидация аргументов** — Zod-схемы для всех параметров (path / query / body), выведенные из спеки.
- **Аутентификация GitVerse** — заголовки `Authorization: Bearer` и вендорный `Accept: application/vnd.gitverse.object+json; version=1` выставляются автоматически.
- **Rate limit** — ответы 429 автоматически повторяются с учётом `Retry-After`.
- **Загрузка файлов** — вложения к issues, комментариям и release-ассетам передаются через `attachment_path` (локальный файл) или `attachment_base64`.
- **Фильтрация инструментов** — `GITVERSE_TOOLS` / `GITVERSE_EXCLUDE_TOOLS` для клиентов, которым не нужны все 157.

## Установка / Install

Не требует установки — запускайте через npx:

```bash
GITVERSE_TOKEN=<ваш_токен> npx -y gitverse-mcp-server
```

Или глобально:

```bash
npm install -g gitverse-mcp-server
```

Требуется Node.js >= 20.

## Получение токена

Создайте персональный токен в GitVerse: **Настройки → Управление токенами** ([документация](https://gitverse.ru/docs/collaborative/authentification/tokens)). Выдайте права read/write на нужные сущности (репозитории, issues, CI/CD и т.д.) — API не работает без токена.

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
| `GITVERSE_TOKEN` | — | Персональный токен GitVerse (обязателен для реального API) |
| `GITVERSE_BASE_URL` | `https://api.gitverse.ru` | База API (можно указать мок-сервер) |
| `GITVERSE_API_VERSION` | `1` | Версия вендорного media type |
| `GITVERSE_PROFILE` | — | Встроенный профиль инструментов: `pr` (ревью и работа с PR) |
| `GITVERSE_TOOLS` | — | Список имён инструментов через запятую (allowlist) |
| `GITVERSE_EXCLUDE_TOOLS` | — | Список имён инструментов через запятую (denylist) |

Приоритет фильтров: `GITVERSE_TOOLS` → `GITVERSE_PROFILE` → все тула; `GITVERSE_EXCLUDE_TOOLS` применяется поверх любого варианта.

## Профиль `bitbucket` — семантические тула как в Bitbucket MCP

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server"],
      "env": {
        "GITVERSE_TOKEN": "<ваш_токен>",
        "GITVERSE_PROFILE": "bitbucket"
      }
    }
  }
}
```

25 тулов с привычными по Bitbucket MCP именами и семантикой:

- **Репозитории**: `listRepositories` (свои или организации), `getRepository`.
- **PR**: `getPullRequests` (+state), `createPullRequest`, `createDraftPullRequest`, `getPullRequest`, `updatePullRequest` (title/body/state/base + assignees/labels), `getPullRequestActivity` (timeline), `getPullRequestCommits`, `getPullRequestDiff` (файлы с патчами).
- **Вердикты**: `approvePullRequest`, `unapprovePullRequest` (находит и удаляет ваше APPROVED-ревью), `requestChanges`, `removeChangeRequest` (перекрывает change request новым APPROVED-ревью), `declinePullRequest` (закрытие, опционально с комментарием).
- **Комментарии**: `getPullRequestComments`, `addPullRequestComment` — общий или **инлайн** (`inline: {path, to}` — SHA коммита подставляется автоматически), `updatePullRequestComment`, `deletePullRequestComment`.
- **CI (Pipelines → Actions)**: `listPipelineRuns` (фильтры status/branch/event), `getPipelineRun`, `runPipeline` (dispatch workflow на ветку/тег), `getPipelineSteps`, `getPipelineStep`, `getPipelineStepLogs`.

Чего из набора Bitbucket MCP **нет и не может быть** в публичном API GitVerse: `mergePullRequest` (эндпоинта merge нет), `reviewers` при создании PR (только assignees), `publishDraftPullRequest` / `convertTodraft` (поле draft не переключается), `getPullRequestTasks` (тасков нет), `resolveComment` / `reopenComment`, `stopPipeline` (нет cancel), `getPullRequestStatuses` (нет commit statuses — заменяется `listPipelineRuns` по ветке), `getPullRequestDiffStat` / `getPullRequestPatch` (данные внутри `getPullRequestDiff`).

## Профиль `pr` — ревью и работа с pull request'ами

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server"],
      "env": {
        "GITVERSE_TOKEN": "<ваш_токен>",
        "GITVERSE_PROFILE": "pr"
      }
    }
  }
}
```

23 инструмента, закрыт весь цикл code review:

- **Чтение**: карточка репозитория и файлы (`get_repos`, `get_repos_contents`), список/карточка PR (`get_repos_pulls`, `get_repos_pulls_pull_number`), коммиты и изменённые файлы PR (`get_repos_pulls_commits`, `get_repos_pulls_files`), сравнение веток (`get_repos_compare`), статусы лейблов (`get_repos_labels`).
- **Ревью**: инлайн-комментарии к диффу (`post_repos_pulls_comments`), ревью целиком с вердиктом `APPROVED` / `REQUEST_CHANGES` / `COMMENT` (`get/post_repos_pulls_reviews`, отправка pending-ревью через `post_repos_pulls_reviews_events`), обсуждение в PR (`get/post/patch_repos_issues_comments` — PR является issue).
- **Управление PR**: создание и правка (`post_repos_pulls`, `patch_repos_pulls` — title/body/state/base), обновление ветки из base (`put_repos_pulls_update_branch`), проверка смерженности (`get_repos_pulls_merge`).
- **Автор(ы) и лейблы**: `patch_repos_issues` принимает `assignees` и `labels` — PR в API GitVerse является issue, поэтому назначение исполнителей, снятие, метки и смена state идут через него (`index` = номер PR).

## Примеры работы / Usage examples

Инструменты названы по шаблону `<method>_<путь_без_параметров>`:

| Инструмент | API | Что делает |
|---|---|---|
| `get_repos` | `GET /repos/{owner}/{repo}` | Карточка репозитория |
| `get_repos_commits` | `GET /repos/{owner}/{repo}/commits` | Список коммитов (+`page`, `per_page`, `sha`, `path`…) |
| `post_repos_pulls_comments` | `POST .../pulls/{pull_number}/comments` | Комментарий к диффу PR |
| `post_repos_issues_comments_attachments` | `POST .../comments/{comment_id}/attachments` | Загрузка вложения (multipart) |
| `post_repos_actions_workflows_dispatches` | `POST .../workflows/{workflow}/dispatches` | Запуск workflow |
| `get_search_users` | `GET /search/users` | Поиск пользователей |
| `delete_repos` | `DELETE /repos/{owner}/{repo}` | Удаление репозитория |

Полный список — запросом `tools/list` или в [документации API](https://gitverse.ru/docs/developers/public-api).

## Разработка / Development

```bash
git clone <repo>
cd gitverse-mcp-server
npm install
npm run fetch-spec   # скачать актуальную спеку в spec/openapi.json
npm run generate     # сгенерировать src/generated/tools.ts
npm test             # vitest: генератор + клиент + e2e по InMemoryTransport
npm run build        # tsc -> dist/
```

Обновление под новую версию API GitVerse — две команды: `npm run fetch-spec 1.11 && npm run generate`.

## Архитектура

```
scripts/fetch-spec.ts   скачивает официальную OpenAPI-спеку (Swagger 2.0)
scripts/generate.ts     кодогенерация: операция -> ToolSpec + Zod-схема
src/generated/tools.ts  157 инструментов (генерируется, не редактировать)
src/client.ts           HTTP-клиент: Bearer + vendor Accept, 429/retry, ошибки
src/server.ts           MCP-сервер: registerTool, аннотации readOnlyHint
src/index.ts            stdio-транспорт, env-конфигурация
```

## Похожие проекты

- [mcp.gitverse.ru](https://gitverse.ru/docs/ai/mcp) — официальный удалённый MCP-сервер GitVerse (42 инструмента, только hosted).
- [`gitverse-mcp`](https://www.npmjs.com/package/gitverse-mcp) — обёртка над `@onreza/gitverse-sdk`, 66 инструментов.

Отличие этого пакета: полное покрытие API (157/157), генерация из официальной спеки, локальный запуск, загрузка файлов и env-фильтрация.

## License

MIT
