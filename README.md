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
| `GITVERSE_TOOLS` | — | Список имён инструментов через запятую (allowlist) |
| `GITVERSE_EXCLUDE_TOOLS` | — | Список имён инструментов через запятую (denylist) |

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
