---
name: issues
description: 'Создаёт GitHub Issues и milestones из файла плана. Использовать, когда есть готовый план с фазами и нужно создать бэклог на GitHub.'
---

# Поведение скилла

Создаёт GitHub Issues и milestones из файла плана. Использовать, когда есть готовый план с фазами и нужно создать бэклог на GitHub.

# Порядок действий:

1. Прочитать файл плана (путь передаётся через arguments).
2. Для каждой фазы создать milestone с помощью GitHub CLI:

`gh api repos/{owner}/{repo}/milestones --field title="..."`

3. Для каждой задачи в фазе создать Issue:

`gh issue create ...`

# Формат Issue:

Title — заголовок задачи (текст из плана, без маркеров списка);
Body — описание задачи;
Issue привязывается к соответствующему milestone.
