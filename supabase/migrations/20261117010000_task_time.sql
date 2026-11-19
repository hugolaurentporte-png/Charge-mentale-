-- Heure facultative sur une tâche (seulement si elle a un jour).
alter table public.tasks add column due_time time;
alter table public.tasks add constraint tasks_time_needs_day check (due_time is null or due_date is not null);
