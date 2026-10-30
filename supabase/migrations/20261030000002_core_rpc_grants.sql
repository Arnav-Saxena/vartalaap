revoke all on function public.search_profiles(text) from anon, public;
grant execute on function public.search_profiles(text) to authenticated;
revoke all on function public.get_or_create_direct_conversation(uuid) from anon, public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
revoke all on function public.handle_new_auth_user() from anon, authenticated, public;
