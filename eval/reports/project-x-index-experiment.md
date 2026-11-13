> Privacy: client identifiers and paths are anonymized as Project X / project-x. Affected queries and example paths are illustrative, not verbatim log strings or executable local paths.

# Тест: проектные документы Project X в Knowledge Router

Выполнено 3 ноября 2026. В отдельный локальный vault добавлены 19 исходных документов Project X: README, SUMMARY, README test-utils и Markdown из трёх ноябрьских задач (weeks 1–3). Требования task.md адаптированы в три SKILL.md; для общих документов создан четвёртый overview-навык. Остальные источники скопированы без изменений как references. Итог: 147 → 167 индексируемых документов. Исходный coding vault и его индекс не изменялись.

## Что получилось

Повторены все 13 запросов из ноябрьских логов с исходными constraints, limit и path hints. Сравнение использует свежую базовую сборку coding vault и её копию с новым доменом project-x. Метаданные новых навыков получены из заголовков и Goal задач, без ручных keywords по тестовым запросам.

- 5 primary routes изменились в сторону Project X. Это покрытие проектными документами, а не автоматически пять исправленных ошибок.
- Запрос privacy/access control вместо пустой выдачи получил decisions.md, D4 — server-side visibility clamps.
- Catalog filters вместо общего React Query получил проектную задачу и grounded-plan.
- Featured content вместо Error Boundaries получил проектную задачу, decisions и integration map.
- Public profile/privacy вместо пустой выдачи получил Findings задачи featured content, но confidence всего 0.138; полнота ответа о допустимых полях этим не доказана.
- PostgreSQL search переключился с database на проектную задачу. Это компромисс: проектный контекст появился, но общее руководство database при одном навыке исчезло. Выданные execution-разделы не обязательно самые полезные для FTS.
- URL-backed state всё ещё выбирает React Query; backend authorization всё ещё выбирает frontend/routing. Добавление корпуса не исправляет само ранжирование.
- Ошибка --domain auth остаётся ошибкой; явный --skill auth по-прежнему выбирает frontend/auth.
- С явным --domain project-x проектная выдача доступна для 12 из 13 запросов (кроме запроса об общих contract/validation principles). В этом диагностическом прогоне исходный skill constraint снимается, поэтому он не считается сравнением одинаковых запросов.

## Сравнение маршрутов

|   № | Запрос                                                                                  | Coding vault            | С Project X                                 |
| --: | --------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------- |
|   1 | search feature privacy access control data exposure courses mentors                     | пусто                   | project-x/postgres-search-foundation        |
|   2 | PostgreSQL full-text search indexed backend                                             | backend/database        | project-x/postgres-search-foundation        |
|   3 | contracts and validation schema compatibility shared principles                         | common/engineering      | common/engineering                          |
|   4 | postgresql search indexing trigram migration constraint                                 | backend/database        | backend/database                            |
|   5 | global search catalog filters sorting URL state search semantics domain rules           | frontend/react-query    | project-x/global-search-catalog-filters     |
|   6 | URL-backed search filter state query params react router                                | frontend/react-query    | frontend/react-query                        |
|   7 | filtering sorting pagination API query validation backend                               | backend/api             | backend/api                                 |
|   8 | mentor discovery featured content admin-managed sections access boundary privacy roles  | frontend/error-handling | project-x/mentor-discovery-featured-content |
|   9 | admin role authorization who can manage featured mentors content moderation permissions | Unknown domain: auth    | Unknown domain: auth                        |
|  10 | admin role authorization manage featured content permissions mentor visibility privacy  | frontend/auth           | frontend/auth                               |
|  11 | admin role authorization guard protected endpoints                                      | frontend/routing        | frontend/routing                            |
|  12 | public user profile fields privacy exposure                                             | пусто                   | project-x/mentor-discovery-featured-content |
|  13 | react-query mutations query invalidation cache                                          | frontend/react-query    | frontend/react-query                        |

## Попробовать вручную

Из корня knowledge-router:

```bash
./scripts/knowledge search "admin role authorization guard protected endpoints" \
  --vault .knowledge/project-x-experiment-november-2026-v2/vault \
  --domain project-x --json
```

CLI проверен: этот запрос возвращает featured-content и раздел execution.md с endpoint/DTO контрактами, guards и ролями. Чтобы проверить автоматическую маршрутизацию, уберите --domain project-x.

## Воспроизвести

Используйте новый --output для каждого запуска. Сначала npm run build, если dist не собран. Node.js 22+ должен быть доступен.

```bash
node scripts/experiment-project-x.mjs \
  --coding-vault /home/pentagon-admin/Documents/apps/obsidian-vaults/coding \
  --project /home/pentagon-admin/Documents/apps/project-x \
  --logs /home/pentagon-admin/Documents/apps/flow-forge-tui/runs \
  --output .knowledge/project-x-experiment-next
```

Полное сравнение, source manifest и SHA-256: [comparison.json](/home/pentagon-admin/Documents/apps/knowledge-router/.knowledge/project-x-experiment-november-2026-v2/comparison.json). Индекс и копии документов лежат в .knowledge, которая исключена из Git. Скрипт создаёт локальные артефакты и не переключает конфигурацию Flow Forge/Project X.

## Ограничения

Это snapshot документации на сегодня: планы и execution-отчёты написаны после исходных запросов. Результаты не измеряют историческое качество и не имеют независимой экспертной разметки. Отчёты выполнения являются утверждениями автора, а не проверкой текущего кода; чекбоксы task.md могут отставать от отчётов. Код TypeScript/Prisma не индексировался: текущий движок работает с Markdown. Не включены остальные месяцы, сырые логи и инструкции агентов. Копия vault не обновляется автоматически.

Проверено: полный прогон 13 запросов; ручной CLI-запрос с --domain project-x; хеши всех 19 источников, точность копирования references; ESLint и Prettier для скрипта. Код поискового движка не изменялся.
