drop policy if exists "Authors delete their own messages" on public.messages;
create policy "Authors delete their own messages"
  on public.messages for delete to authenticated
  using (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and ((select auth.uid()) = c.user_a or (select auth.uid()) = c.user_b)
    )
  );

grant delete on public.messages to authenticated;
