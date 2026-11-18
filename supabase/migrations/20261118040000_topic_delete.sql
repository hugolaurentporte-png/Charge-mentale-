-- Un sujet « crèche de la semaine » peut aussi être supprimé depuis sa carte
-- (les récupérations déjà saisies restent dans le planning).
alter policy topics_delete on public.topics
  using (couple_id = public.my_couple_id() and kind in ('general', 'pickup_week')
         and (not is_private or created_by = (select auth.uid())));
