# Работа Knowledge Router по логам 1–3 ноября 2026

Разобраны фактические ответы из трёх локальных Flow Forge логов `20261101…f11-d1.log`, `20261102…f11-d2.log`, `20261103…f11-d3.log`. Это весь найденный ноябрьский набор на 3 ноября, а не итог месяца. Повторный поиск на текущем индексе не подменял записанные ответы. Код и vault не изменялись.

## Вывод

Технически роутер отработал устойчиво. Конкретные запросы про database, API и cache invalidation дали полезное руководство. Основная слабость — выбор навыка по совпадающим общим словам и смешение React Router query params с React Query. Confidence не гарантирует правильность.

## Наблюдаемые показатели

| Дата     | Поисковых вызовов | Exit 0 | Непустая выдача | Пустая выдача | Ошибка |
| -------- | ----------------: | -----: | --------------: | ------------: | -----: |
| 1 ноября |                 4 |      4 |               3 |             1 |      0 |
| 2 ноября |                 3 |      3 |               3 |             0 |      0 |
| 3 ноября |                 6 |      5 |               4 |             1 |      1 |
| Всего    |                13 |     12 |              10 |             2 |      1 |

- Все 13 запросов различаются. Вспомогательное чтение launcher на 2 ноября, строка 308, исключено из поисковых вызовов.
- Вызовы занимали 388–908 мс, медиана 497 мс. Это время bash tool, включая launcher/запуск процесса, а не изолированная скорость алгоритма.
- Из 9 непустых автоматических маршрутов моя оценка: 5 явно подходящих, 4 с проблемой основного намерения. Ещё один непустой маршрут задан через `--skill auth`. Два отказа оценены отдельно: правильность отказа не подтверждена полной разметкой vault.
- Среди 5 автоматических маршрутов с confidence ≥ 0.5 один явный промах: React Router → React Query (0.593). Это 1 из 5 на маленькой выборке, не оценка общей точности.
- Все ответы использовали snapshot v2 от `2026-11-01T02:00:21.235Z`. Хеши всех 17 различных возвращённых документов совпадают с текущими файлами. Полная актуальность индекса по невозвращённым документам не проверялась.
- Все вызовы использовали один навык по умолчанию; `--max-skills 2` не применялся. Единственный `--path` указывал на `backend/database/SKILL.md` из vault, а не на файл целевого проекта.

## Каждая выдача

Релевантность ниже — ручная оценка агента по тексту запроса, записанной выдаче и области ответственности навыков; пользователь её не подтверждал.

### 1. 20261101 · concept-plan

Источник: [20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:8](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:8).

Запрос: `search feature privacy access control data exposure courses mentors`.

Результат: `нет`, confidence `0`, exit `0`. Пустая выдача. Разумный отказ от продуктовых правил, но полнота общих правил privacy/access control не доказана.

### 2. 20261101 · concept-plan

Источник: [20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:11](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:11).

Запрос: `PostgreSQL full-text search indexed backend`.

Результат: `backend/database`, confidence `0.53`, exit `0`. Подходящий backend/database. Только SKILL.md: специальных разделов про full-text search не получено.

- `backend/database/SKILL.md`

### 3. 20261101 · concept-plan

Источник: [20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:14](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:14).

Запрос: `contracts and validation schema compatibility shared principles`.

Результат: `common/engineering`, confidence `0.455`, exit `0`. Подходящий common/engineering и contracts-and-validation.md. Два раздела одного документа.

- `common/engineering/SKILL.md`
- `common/engineering/references/contracts-and-validation.md` — Contracts and Validation
- `common/engineering/references/contracts-and-validation.md` — Contracts and Validation > When to use

### 4. 20261101 · grounded-hard

Источник: [20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:147](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261101_030001_920045a5c41642ec99b9f60fe18ec4dc_f11-d1.log:147).

Запрос: `postgresql search indexing trigram migration constraint`.

Результат: `backend/database`, confidence `0.541`, exit `0`. Подходящий backend/database; indexing и migrations. Специфических рекомендаций pg_trgm в выдаче нет.

- `backend/database/SKILL.md`
- `backend/database/references/indexing.md` — Indexing > Anti-patterns
- `backend/database/references/migrations.md` — Migrations > When to use
- `backend/database/references/migrations.md` — Migrations > Rules

### 5. 20261102 · concept-plan

Источник: [20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:9](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:9).

Запрос: `global search catalog filters sorting URL state search semantics domain rules`.

Результат: `frontend/react-query`, confidence `0.281`, exit `0`. Слабая выдача: react-query по state/rules/domain; mutations и invalidation не отвечают на продуктовые semantics и URL state. Агент исключил её из concept plan.

- `frontend/react-query/SKILL.md`
- `frontend/react-query/references/mutations.md` — useMutation for Modifying Data > Rules
- `frontend/react-query/references/custom-hooks.md` — Custom Hooks Pattern > Rules
- `frontend/react-query/references/cache-invalidation.md` — Cache Invalidation > Rules

### 6. 20261102 · grounded-hard

Источник: [20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:164](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:164).

Запрос: `URL-backed search filter state query params react router`.

Результат: `frontend/react-query`, confidence `0.593`, exit `0`. Основной промах: URL/query params/React Router → react-query; frontend/routing только альтернатива. Confidence 0.593. Смежная польза для query keys есть, основной вопрос не покрыт.

- `frontend/react-query/SKILL.md`
- `frontend/react-query/references/query-options.md` — Query Options > When to use
- `frontend/react-query/references/query-options.md` — Query Options > Anti-patterns
- `frontend/react-query/references/query-options.md` — Query Options > Examples > Bad example

### 7. 20261102 · grounded-hard

Источник: [20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:167](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261102_030001_47fbf26b4dfc4546a2fb04d5327c47c2_f11-d2.log:167).

Запрос: `filtering sorting pagination API query validation backend`.

Результат: `backend/api`, confidence `0.549`, exit `0`. Подходящий backend/api и query-parameters.md: validation, defaults/coercion, pagination.

- `backend/api/SKILL.md`
- `backend/api/references/query-parameters.md` — Query Parameters > When to use
- `backend/api/references/query-parameters.md` — Query Parameters > Rules
- `backend/api/references/query-parameters.md` — Query Parameters > Anti-patterns

### 8. 20261103 · concept-plan

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:17](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:17).

Запрос: `mentor discovery featured content admin-managed sections access boundary privacy roles`.

Результат: `frontend/error-handling`, confidence `0.192`, exit `0`. Промах: access boundary/privacy/roles → error-handling/error-boundaries по boundary. Агент признал нерелевантность для concept plan.

- `frontend/error-handling/SKILL.md`
- `frontend/error-handling/references/error-boundaries.md` — Error Boundaries > When to use
- `frontend/error-handling/references/error-boundaries.md` — Error Boundaries > Rules
- `frontend/error-handling/references/error-boundaries.md` — Error Boundaries > Examples > Good example

### 9. 20261103 · concept-plan

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:21](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:21).

Запрос: `admin role authorization who can manage featured mentors content moderation permissions`.

Результат: `нет`, confidence `—`, exit `1`. Ошибка вызова: auth не является доменом. Роутер корректно вернул Unknown domain: auth, exit 1.

### 10. 20261103 · concept-plan

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:24](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:24).

Запрос: `admin role authorization manage featured content permissions mentor visibility privacy`.

Результат: `frontend/auth`, confidence `1`, exit `0`. Принудительный frontend/auth: Clerk/useAuth вместо серверных admin permissions. Confidence 1 задан явно, не является свидетельством релевантности.

- `frontend/auth/SKILL.md`

### 11. 20261103 · grounded-hard

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:129](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:129).

Запрос: `admin role authorization guard protected endpoints`.

Результат: `frontend/routing`, confidence `0.19`, exit `0`. Промах по основному намерению: authorization/protected endpoints → frontend/routing. backend/security только альтернатива. Агент применил результат к admin UI, но серверная авторизация выдачей не покрыта.

- `frontend/routing/SKILL.md`
- `frontend/routing/references/route-guards.md` — Route Guards > Notes > Public vs Protected Routes
- `frontend/routing/references/route-guards.md` — Route Guards > When to use
- `frontend/routing/references/route-guards.md` — Route Guards > Examples > Good example

### 12. 20261103 · grounded-hard

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:132](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:132).

Запрос: `public user profile fields privacy exposure`.

Результат: `нет`, confidence `0`, exit `0`. Пустая выдача. Продуктовые whitelist-поля нельзя вывести из общего coding vault; агент опёрся на mentorSearchSelect/D3 в репозитории. Возможный пробел общих privacy-правил требует отдельной разметки.

### 13. 20261103 · grounded-hard

Источник: [20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:137](/home/pentagon-admin/Documents/apps/flow-forge-tui/runs/20261103_030009_85d9d8770aed46b38a57f5edc276d31a_f11-d3.log:137).

Запрос: `react-query mutations query invalidation cache`.

Результат: `frontend/react-query`, confidence `0.666`, exit `0`. Подходящий frontend/react-query и cache-invalidation.md. Три секции одного документа; mutations.md не попал в выдачу.

- `frontend/react-query/SKILL.md`
- `frontend/react-query/references/cache-invalidation.md` — Cache Invalidation > When to use
- `frontend/react-query/references/cache-invalidation.md` — Cache Invalidation > Rules
- `frontend/react-query/references/cache-invalidation.md` — Cache Invalidation > Examples > Bad example

## Почему возникают промахи

1. В URL-запросе explanation содержит react-query title, react/query/state и metadata query options. Нормализация разбивает дефисные имена, а title scoring учитывает совпавшие react и query; различие между URL query и server-state query не моделируется. Нужный routing есть среди альтернатив, но стандартная выдача ограничена references основного навыка.
2. Общие boundary и guard дают положительный маршрут без достаточного совпадения с намерением. Низкий confidence 0.192/0.190 не превращает выдачу в отказ. В текущем коде confidence вычисляется после выбора кандидата и не служит порогом для автоматического отказа.
3. Общие rules/state/domain также наполняют бюджет reference-разделами. В запросе 2 ноября из concept-plan пришли mutations/custom-hooks/cache-invalidation Rules; это шум для запрошенной продуктовой семантики.
4. Принудительный выбор auth исправил синтаксис команды, но переключил задачу в frontend Clerk. backend/security по текущему SKILL.md прямо покрывает authentication/authorization guards. Разница domain/skill и принудительный confidence 1 требуют внимания со стороны вызывающего агента.

## Влияние на работу агента

1 ноября агент явно применил ограничения на исключение sensitive fields, контракты, Prisma-first и миграции. 2 ноября он отбросил React Query для concept plan, но на grounded-этапе принял смежные query-key/validation рекомендации, не получив нужных routing-разделов. 3 ноября он отбросил Error Boundaries на concept-этапе, применил frontend route guards к admin UI и восполнил privacy-поля из репозитория. Логи показывают частичную компенсацию промахов агентом, но сами по себе не доказывают корректность всей реализации.

## Следующие улучшения

1. Добавить наблюдаемые запросы URL-backed search и protected endpoints в регрессионный eval, с проверкой нужных документов, а не только primary skill.
2. Уточнить метаданные React Router для URL state/search params и backend/security для admin/RBAC/endpoint authorization; проверить, что это не создаёт новых ложных маршрутов.
3. Проверить отказ при слабых совпадениях только по boundary/rules/state. Один глобальный порог confidence проблему не решает: ошибочный URL-маршрут имеет 0.593.
4. В инструкции вызывающего агента закрепить различие `--domain backend --skill security` и frontend auth, использование путей целевого проекта и чтение альтернатив при несовпадении области задачи.
5. Отдельно разметить privacy/product negatives и нужные reference-секции. До этого не считать 12 успешных команд из 13 метрикой качества поиска.
