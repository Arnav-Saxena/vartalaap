type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Profile = {
  id: string;
  display_name: string;
  email: string;
  avatar_seed: string;
  avatar_style: string;
  avatar_path: string | null;
  created_at: string;
};

export type DirectConversation = {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
};

export type DirectMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export type AiProfile = {
  user_id: string;
  companion_name: string;
  personality: string;
  instructions: string;
  preferences: string;
  updated_at: string;
};

export type AiMessage = {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AiMemory = {
  id: string;
  user_id: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
};

export type Mandali = {
  id: string;
  name: string;
  description: string;
  icon: string;
  visibility: "private" | "discoverable";
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type MandaliMember = {
  mandali_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
};

export type MandaliMessage = {
  id: string;
  mandali_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MandaliInvite = {
  id: string;
  mandali_id: string;
  code: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type MandaliGame = {
  id: string;
  mandali_id: string;
  created_by: string;
  player_x: string;
  player_o: string | null;
  board: Array<"x" | "o" | null>;
  status: "waiting" | "playing" | "won" | "draw";
  next_turn: string | null;
  winner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      direct_conversations: Table<DirectConversation>;
      messages: Table<DirectMessage>;
      ai_profiles: Table<AiProfile>;
      ai_messages: Table<AiMessage>;
      ai_memories: Table<AiMemory>;
      mandalis: Table<Mandali>;
      mandali_members: Table<MandaliMember>;
      mandali_messages: Table<MandaliMessage>;
      mandali_invites: Table<MandaliInvite>;
      mandali_games: Table<MandaliGame>;
    };
    Views: Record<string, never>;
    Functions: {
      search_profiles: {
        Args: { p_query: string };
        Returns: Profile[];
      };
      get_or_create_direct_conversation: {
        Args: { p_other_user_id: string };
        Returns: string;
      };
      create_mandali: {
        Args: { p_name: string; p_description: string; p_icon: string; p_visibility: "private" | "discoverable" };
        Returns: string;
      };
      join_mandali: { Args: { p_mandali_id: string }; Returns: undefined };
      leave_mandali: { Args: { p_mandali_id: string }; Returns: undefined };
      create_mandali_invite: { Args: { p_mandali_id: string }; Returns: string };
      join_mandali_by_invite: { Args: { p_code: string }; Returns: string };
      remove_mandali_member: { Args: { p_mandali_id: string; p_user_id: string }; Returns: undefined };
      update_mandali: {
        Args: {
          p_mandali_id: string;
          p_name: string;
          p_description: string;
          p_icon: string;
          p_visibility: "private" | "discoverable";
        };
        Returns: undefined;
      };
      transfer_mandali_ownership: { Args: { p_mandali_id: string; p_user_id: string }; Returns: undefined };
      delete_mandali: { Args: { p_mandali_id: string }; Returns: undefined };
      is_mandali_member: { Args: { p_mandali_id: string }; Returns: boolean };
      shares_mandali_with: { Args: { p_user_id: string }; Returns: boolean };
      create_mandali_ttt_game: { Args: { p_mandali_id: string }; Returns: string };
      join_mandali_ttt_game: { Args: { p_game_id: string }; Returns: string };
      play_mandali_ttt_move: { Args: { p_game_id: string; p_cell: number }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
