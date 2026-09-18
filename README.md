# GitVerse MCP Server

MCP-сервер (Model Context Protocol) для работы с GitVerse — российским сервисом хостинга репозиториев. Сервер даёт AI-ассистентам (Cursor, Claude Desktop, ZCode и любым MCP-клиентам) доступ к вашим репозиториям, pull request'ам и CI: можно листать и создавать PR, проводить code review — оставлять инлайн-комментарии к диффу, ставить вердикты `approve` / `request changes` / `decline`, назначать исполнителей и лейблы, запускать и разбирать CI-раны вплоть до логов джоб.

Набор из 25 инструментов повторяет семантику популярного [bitbucket-mcp](https://www.npmjs.com/package/bitbucket-mcp): привычные имена (`getPullRequests`, `approvePullRequest`, `addPullRequestComment`…), но поверх REST API GitVerse.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)
![MCP](https://img.shields.io/badge/Model_Context_Protocol-compatible-blueviolet)
[![npm version](https://badge.fury.io/js/%40grigoriy-grisha%2Fgitverse-mcp.svg)](https://www.npmjs.com/package/@grigoriy-grisha/gitverse-mcp)
[![GitHub Repository](https://img.shields.io/badge/GitHub-gitverse--mcp-blue.svg)](https://github.com/grigoriy-grisha/gitverse-mcp)

## ✨ Обзор

Сервер реализует стандарт Model Context Protocol и предоставляет инструменты для:

- **Репозитории** — список своих или репозиториев организации, карточка репозитория
- **Pull request'ы** — список с фильтром по состоянию, создание (включая черновики), правка заголовка/описания/состояния/базовой ветки, коммиты и изменённые файлы PR, таймлайн активности
- **Code review** — инлайн-комментарии к конкретным строкам диффа, комментарии обсуждения (создание/правка/удаление), вердикты: одобрить, запросить изменения, заклонить, снять своё одобрение
- **Назначения** — assignees и labels на PR (PR в GitVerse является issue)
- **CI** — ран-ы GitVerse Actions (аналог Bitbucket Pipelines): список с фильтрами, карточка рана, запуск workflow, джобы и их логи

Все операции выполняются через официальный [публичный REST API GitVerse](https://gitverse.ru/docs/developers/public-api): заголовки `Authorization: Bearer` и вендорный `Accept: application/vnd.gitverse.object+json; version=1` выставляются автоматически, ответы 429 автоматически повторяются с учётом `Retry-After`.

### 🧰 Инструменты на одном экране

| Группа | Инструменты |
| --- | --- |
| **Репозитории** | `listRepositories` · `getRepository` |
| **Pull request'ы** | `getPullRequests` · `createPullRequest` · `createDraftPullRequest` · `getPullRequest` · `updatePullRequest` · `getPullRequestActivity` · `getPullRequestCommits` · `getPullRequestDiff` |
| **Вердикты ревью** | `approvePullRequest` · `unapprovePullRequest` · `requestChanges` · `removeChangeRequest` · `declinePullRequest` |
| **Комментарии** | `getPullRequestComments` · `addPullRequestComment` · `updatePullRequestComment` · `deletePullRequestComment` |
| **CI (Actions)** | `listPipelineRuns` · `getPipelineRun` · `runPipeline` · `getPipelineSteps` · `getPipelineStep` · `getPipelineStepLogs` |

## 🚀 Установка

### Через NPX (рекомендуется)

Запуск без глобальной установки:

```bash
GITVERSE_TOKEN="ваш-токен" npx -y @grigoriy-grisha/gitverse-mcp@latest
```

### Ручная установка

Либо установите глобально или в проект:

```bash
# Глобально
npm install -g @grigoriy-grisha/gitverse-mcp

# Или в проект
npm install @grigoriy-grisha/gitverse-mcp
```

Затем запускайте:

```bash
# Глобальная установка
GITVERSE_TOKEN="ваш-токен" gitverse-mcp

# Установка в проект
GITVERSE_TOKEN="ваш-токен" npx @grigoriy-grisha/gitverse-mcp
```

Требуется **Node.js 20 или выше**.

## ⚙️ Настройка

### Переменные окружения

| Переменная | Описание | Обязательна |
| --- | --- | --- |
| `GITVERSE_TOKEN` | Персональный токен GitVerse (см. [ниже](#создание-токена-gitverse)) | Да |
| `GITVERSE_BASE_URL` | База API. По умолчанию `https://api.gitverse.ru` | Нет |
| `GITVERSE_API_VERSION` | Версия вендорного media type. По умолчанию `1` | Нет |

### Создание токена GitVerse

1. Войдите в ваш аккаунт на [gitverse.ru](https://gitverse.ru)
2. Откройте **Настройки → Управление токенами**
3. Создайте новый токен с правами:
   - **Репозитории**: чтение, запись
   - **Issues / Pull requests**: чтение, запись
   - **CI/CD (Actions)**: чтение, запись — нужно для тулов `*Pipeline*`
4. Скопируйте сгенерированный токен и используйте его как `GITVERSE_TOKEN`

Подробности — в [документации по токенам](https://gitverse.ru/docs/collaborative/authentification/tokens).

## 🔌 Интеграция с клиентами

### ZCode

Добавьте в конфигурацию MCP (`~/.zcode/mcp.json` или настройка проекта):

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server@latest"],
      "env": {
        "GITVERSE_TOKEN": "ваш-токен"
      }
    }
  }
}
```

### Claude Desktop

В файле `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitverse": {
      "command": "npx",
      "args": ["-y", "gitverse-mcp-server@latest"],
      "env": {
        "GITVERSE_TOKEN": "ваш-токен"
      }
    }
  }
}
```

### Cursor

1. Откройте Settings → Extensions → Model Context Protocol
2. Добавьте конфигурацию:

```json
"gitverse": {
  "command": "npx",
  "env": {
    "GITVERSE_TOKEN": "ваш-токен"
  },
  "args": ["-y", "gitverse-mcp-server@latest"]
}
```

### Локальная сборка для разработки

Если правите сервер локально и хотите проверить изменения:

```json
"gitverse-local": {
  "command": "node",
  "env": {
    "GITVERSE_TOKEN": "ваш-токен"
  },
  "args": ["/путь/к/gitverse-mcp-server/dist/index.js"]
}
```

## 🩺 Устранение неполадок

### Ошибки 401 Unauthorized

1. **Проверьте токен**: убедитесь, что используете персональный токен из «Управление токенами», а не пароль аккаунта
2. **Проверьте права токена**: для базовых операций нужно «Репозитории: чтение»; для вердиктов и комментариев — запись
3. **Проверьте токен вручную** через curl:

```bash
curl -H "Authorization: Bearer ваш-токен" \
     -H "Accept: application/vnd.gitverse.object+json; version=1" \
     "https://api.gitverse.ru/user"
```

### Ошибки 429 Too Many Requests

API GitVerse ограничивает **2000 запросов в час** на пользователя. Сервер автоматически повторяет такие запросы с учётом заголовка `Retry-After` (до 3 попыток). Если лимиты всё равно исчерпываются — снизьте частоту вызовов в сценарии ассистента.

### Ошибки 400 VALIDATION_ERROR

Проверьте, что токен передаётся вместе с вендорным заголовком `Accept: application/vnd.gitverse.object+json; version=1` — без него шлюз GitVerse отвечает 400. При работе через этот MCP-сервер заголовок ставится автоматически, ошибка возникает только при ручных curl-проверках.

## 🔧 Доступные инструменты

Сервер предоставляет 25 инструментов для работы с репозиториями, PR и CI. Полный список по группам:

- [Репозитории](#репозитории)
- [Pull request'ы](#pull-requestы)
- [Вердикты ревью](#вердикты-ревью)
- [Комментарии](#комментарии)
- [CI (GitVerse Actions)](#ci-gitverse-actions)

Если не указано иное, листинги (`listRepositories`, `getPullRequests`, `getPullRequestCommits`, `listPipelineRuns`) принимают опциональные параметры пагинации:

- `page` (optional): номер страницы, начиная с 1. По умолчанию возвращается первая страница.
- `per_page` (optional): количество элементов на странице.

### Репозитории

#### `listRepositories`

Возвращает список репозиториев.

**Параметры:**

- `org` (optional): имя организации — если указано, возвращаются репозитории организации; иначе — репозитории текущего пользователя
- `page` (optional), `per_page` (optional): пагинация

#### `getRepository`

Возвращает карточку репозитория.

**Параметры:**

- `owner`: владелец репозитория (пользователь или организация)
- `repo`: имя репозитория

### Pull request'ы

#### `getPullRequests`

Возвращает pull request'ы репозитория.

**Параметры:**

- `owner`: владелец
- `repo`: имя репозитория
- `state` (optional): состояние PR — `open` или `closed`
- `page` (optional), `per_page` (optional): пагинация

#### `createPullRequest`

Создаёт pull request из ветки `head` в ветку `base`.

**Параметры:**

- `owner`: владелец
- `repo`: имя репозитория
- `title`: заголовок PR
- `head`: исходная ветка
- `base`: целевая ветка
- `body` (optional): описание PR (markdown)
- `draft` (optional): создать как черновик
- `assignees` (optional): список username для назначения
- `labels` (optional): список лейблов

**Примечание:** запрос ревьюеров (reviewers) в API GitVerse отсутствует — используйте `assignees`.

#### `createDraftPullRequest`

Создаёт pull request в статусе черновика.

**Параметры:**

- `owner`, `repo`, `title`, `head`, `base` — как у `createPullRequest`
- `body` (optional): описание PR

**Примечание:** эквивалентно `createPullRequest` с `draft: true`.

#### `getPullRequest`

Возвращает карточку конкретного pull request'а.

**Параметры:**

- `owner`: владелец
- `repo`: имя репозитория
- `pull_number`: номер PR

#### `updatePullRequest`

Обновляет pull request: заголовок, описание, состояние, целевую ветку; дополнительно может заменить assignees и labels (через issue-эндпоинт — PR в GitVerse является issue).

**Параметры:**

- `owner`: владелец
- `repo`: имя репозитория
- `pull_number`: номер PR
- `title` (optional): новый заголовок
- `body` (optional): новое описание
- `state` (optional): новое состояние — `open` или `closed`
- `base` (optional): новая целевая ветка
- `assignees` (optional): заменить исполнителей
- `labels` (optional): заменить лейблы

#### `getPullRequestActivity`

Возвращает таймлайн активности pull request'а.

**Параметры:**

- `owner`, `repo`, `pull_number`

#### `getPullRequestCommits`

Возвращает коммиты pull request'а.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `page` (optional), `per_page` (optional): пагинация

#### `getPullRequestDiff`

Возвращает изменённые файлы pull request'а с построчными патчами.

**Параметры:**

- `owner`, `repo`, `pull_number`

### Вердикты ревью

#### `approvePullRequest`

Одобряет pull request — создаёт ревью с вердиктом `APPROVED`.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `body` (optional): комментарий к одобрению

#### `unapprovePullRequest`

Снимает ваше одобрение: находит ваше последнее `APPROVED`-ревью и удаляет его.

**Параметры:**

- `owner`, `repo`, `pull_number`

#### `requestChanges`

Запрашивает изменения — создаёт ревью с вердиктом `REQUEST_CHANGES`.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `body` (optional): что нужно изменить

#### `removeChangeRequest`

Снимает ваш change request — перекрывает его новым ревью с вердиктом `APPROVED` (отдельного эндпоинта в API GitVerse нет).

**Параметры:**

- `owner`, `repo`, `pull_number`
- `body` (optional): комментарий

#### `declinePullRequest`

Заклоняет (закрывает) pull request.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `message` (optional): причина отклонения — публикуется комментарием в обсуждение перед закрытием

### Комментарии

#### `getPullRequestComments`

Возвращает комментарии обсуждения pull request'а.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `since` (optional): только комментарии, созданные после ISO-времени
- `before` (optional): только комментарии, созданные до ISO-времени

#### `addPullRequestComment`

Создаёт комментарий к pull request — общий или инлайн.

**Параметры:**

- `owner`: владелец
- `repo`: имя репозитория
- `pull_number`: номер PR
- `content`: текст комментария (markdown)
- `inline` (optional): инлайн-комментарий к конкретной строке диффа:

```json
{
  "path": "src/file.ts",
  "to": 15
}
```

- `reply_to` (optional): id комментария, на который отвечаем (только для общих комментариев)

**Формат инлайн-комментария:**

- `path`: путь к файлу в диффе
- `to`: номер строки в **новой** версии (добавленные и изменённые строки)

SHA коммита определяется автоматически — отдельно передавать его не нужно.

**Примеры:**

```javascript
// Общий комментарий
addPullRequestComment(owner, repo, 14, "Отличная работа!");

// Инлайн-комментарий к строке 25 файла src/service.ts
addPullRequestComment(owner, repo, 14, "Добавь обработку ошибок", {
  inline: { path: "src/service.ts", to: 25 }
});
```

#### `updatePullRequestComment`

Редактирует комментарий обсуждения.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `comment_id`: id комментария
- `content`: новый текст

#### `deletePullRequestComment`

Удаляет комментарий обсуждения.

**Параметры:**

- `owner`, `repo`, `pull_number`
- `comment_id`: id комментария

### CI (GitVerse Actions)

CI-раны GitVerse Actions — аналог Bitbucket Pipelines.

#### `listPipelineRuns`

Возвращает CI-раны репозитория.

**Параметры:**

- `owner`, `repo`
- `status` (optional): фильтр по статусу — `queued`, `in_progress`, `success`, `failure`, `cancelled`, `unknown`
- `branch` (optional): фильтр по ветке
- `event` (optional): фильтр по событию-триггеру
- `page` (optional), `per_page` (optional): пагинация

#### `getPipelineRun`

Возвращает карточку CI-рана.

**Параметры:**

- `owner`, `repo`
- `run_id`: id рана

#### `runPipeline`

Запускает workflow на ветке или теге.

**Параметры:**

- `owner`, `repo`
- `workflow`: имя файла workflow (например `ci.yml`) или id
- `ref_type`: что передаётся в `ref_name` — `branch` или `tag`
- `ref_name`: имя ветки или тега
- `inputs` (optional): входные параметры workflow (строковые значения)

#### `getPipelineSteps`

Возвращает джобы (шаги) CI-рана.

**Параметры:**

- `owner`, `repo`
- `run_id`: id рана

#### `getPipelineStep`

Возвращает карточку джобы.

**Параметры:**

- `owner`, `repo`
- `job_id`: id джобы

#### `getPipelineStepLogs`

Возвращает логи джобы.

**Параметры:**

- `owner`, `repo`
- `job_id`: id джобы

## ⚠️ Ограничения

Часть возможностей Bitbucket в публичном API GitVerse отсутствует, поэтому соответствующих тулов нет:

- **merge PR** — эндпоинта слияния в API нет (только проверка «смержен ли» и обновление ветки из base)
- **reviewers** при создании PR — есть только assignees
- **переключение draft** после создания (`publishDraftPullRequest` / `convertTodraft`)
- **задачи (tasks)** на PR
- **resolve / reopen** тредов комментариев
- **остановка CI-рана** (cancel отсутствует)
- **commit statuses** — вместо них используйте `listPipelineRuns` с фильтром по ветке

## 🛠 Разработка

### Требования

- Node.js 20 или выше
- npm

### Настройка

```bash
# Клонировать репозиторий
git clone <repo-url>
cd gitverse-mcp-server

# Установить зависимости
npm install

# Собрать проект
npm run build

# Запустить тесты
npm test

# Запустить локально
GITVERSE_TOKEN="ваш-токен" npm start
```

### Структура

```
src/composite.ts   25 тулов: имена и семантика Bitbucket MCP, вызовы API GitVerse
src/client.ts      HTTP-клиент: Bearer + vendor Accept, 429/Retry-After, ошибки
src/server.ts      MCP-сервер: регистрация тулов, аннотации readOnlyHint
src/index.ts       stdio-транспорт, env-конфигурация
test/              vitest: клиент, тулы, e2e по InMemoryTransport
```

## 📄 Лицензия

Проект распространяется по лицензии MIT — подробности в файле [LICENSE](LICENSE).

## 🔗 Ссылки

- [GitHub-репозиторий](https://github.com/grigoriy-grisha/gitverse-mcp)
- [npm-пакет](https://www.npmjs.com/package/gitverse-mcp)
- [Документация публичного API GitVerse](https://gitverse.ru/docs/developers/public-api)
- [Токены GitVerse](https://gitverse.ru/docs/collaborative/authentification/tokens)
- [GitVerse MCP (официальный, hosted)](https://gitverse.ru/docs/ai/mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [bitbucket-mcp — референс набора тулов](https://www.npmjs.com/package/bitbucket-mcp)
